import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  verifyBackup,
  pruneBackups,
  type BackupManifest,
} from "../scripts/ops/backup";
const roots: string[] = [];
const checksum = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function root() {
  const value = await mkdtemp(join(tmpdir(), "ta-backup-ops-"));
  roots.push(value);
  return value;
}
async function snapshot(parent: string, day: string) {
  const path = join(
      parent,
      `tell-aviv-${day.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
    ),
    key = randomUUID();
  await mkdir(join(path, "uploads"), { recursive: true, mode: 0o700 });
  await writeFile(join(path, "database.dump"), "fixture SQL dump");
  await writeFile(join(path, "uploads", key), "private uploaded bytes");
  const manifest: BackupManifest = {
    version: 2,
    managedBy: "tell-aviv-backup-v2",
    complete: true,
    createdAt: day,
    databaseChecksum: checksum("fixture SQL dump"),
    databaseBytes: 16,
    storageProvider: "local",
    uploadsCopied: true,
    uploads: [{ key, size: 22, sha256: checksum("private uploaded bytes") }],
    snapshotConsistency: "fixture",
  };
  await writeFile(join(path, "manifest.json"), JSON.stringify(manifest));
  return { path, key, manifest };
}
describe("backup checksums and owned snapshot retention", () => {
  it("verifies each binary checksum, rejects tampering and keeps old v1 database verification compatible", async () => {
    const parent = await root(),
      backup = await snapshot(parent, "2026-09-01T00:00:00.000Z");
    expect((await verifyBackup(backup.path)).version).toBe(2);
    await writeFile(
      join(backup.path, "uploads", backup.key),
      "tampered uploaded data!",
    );
    await expect(verifyBackup(backup.path)).rejects.toThrow("upload checksum");
    const legacy = join(parent, "legacy");
    await mkdir(legacy);
    await writeFile(join(legacy, "database.dump"), "old");
    await writeFile(
      join(legacy, "manifest.json"),
      JSON.stringify({
        version: 1,
        databaseChecksum: checksum("old"),
        uploadsCopied: false,
      }),
    );
    expect((await verifyBackup(legacy)).version).toBe(1);
    await writeFile(join(legacy, "database.dump"), "corrupt");
    await expect(verifyBackup(legacy)).rejects.toThrow("database checksum");
  });
  it("does not follow symlinked binaries or allow upload-key traversal", async () => {
    const parent = await root(),
      backup = await snapshot(parent, "2026-09-02T00:00:00.000Z");
    await rm(join(backup.path, "uploads", backup.key));
    await writeFile(join(parent, "external"), "private uploaded bytes");
    await symlink(
      join(parent, "external"),
      join(backup.path, "uploads", backup.key),
    );
    await expect(verifyBackup(backup.path)).rejects.toThrow("upload checksum");
    backup.manifest.uploads[0].key = "../external";
    await writeFile(
      join(backup.path, "manifest.json"),
      JSON.stringify(backup.manifest),
    );
    await expect(verifyBackup(backup.path)).rejects.toThrow(
      "manifest is invalid",
    );
  });
  it("retains a minimum of verified completed snapshots and never sweeps unknown, incomplete or corrupted directories", async () => {
    const parent = await root();
    const oldest = await snapshot(parent, "2026-09-01T00:00:00.000Z"),
      second = await snapshot(parent, "2026-09-02T00:00:00.000Z"),
      newer = await snapshot(parent, "2026-09-03T00:00:00.000Z"),
      newest = await snapshot(parent, "2026-09-04T00:00:00.000Z");
    const corrupt = await snapshot(parent, "2026-09-05T00:00:00.000Z");
    await writeFile(join(corrupt.path, "database.dump"), "broken");
    await mkdir(join(parent, "unknown-personal-data"));
    await mkdir(join(parent, ".in-progress-failed-backup"));
    const dry = await pruneBackups({
      root: parent,
      retainDays: 14,
      minKeep: 2,
      now: new Date("2026-10-03T00:00:00Z"),
    });
    expect(dry.candidates).toHaveLength(2);
    expect(dry.removed).toBe(0);
    expect(dry.rejected).toBe(1);
    const applied = await pruneBackups({
      root: parent,
      retainDays: 14,
      minKeep: 2,
      apply: true,
      now: new Date("2026-10-03T00:00:00Z"),
    });
    expect(applied.removed).toBe(2);
    await expect(
      readFile(join(oldest.path, "manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(second.path, "manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect((await verifyBackup(newer.path)).version).toBe(2);
    expect((await verifyBackup(newest.path)).version).toBe(2);
    expect(await readFile(join(corrupt.path, "database.dump"), "utf8")).toBe(
      "broken",
    );
  });
});
