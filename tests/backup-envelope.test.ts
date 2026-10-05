import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  chmod,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { type BackupManifest, verifyBackup } from "../scripts/ops/backup";
import {
  decryptBackup,
  encryptBackup,
  FilesystemBackupDestination,
  readBackupEncryptionKey,
} from "../scripts/ops/envelope";
const roots: string[] = [],
  key = Buffer.alloc(32, 0x42);
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ta-encrypted-fixture-"));
  roots.push(root);
  const snapshot = join(root, "snapshot"),
    uploadKey = randomUUID(),
    database = Buffer.from("fixture PostgreSQL custom dump bytes\0"),
    upload = Buffer.alloc(170_017, 0x7c);
  upload[0] = 0;
  upload[upload.length - 1] = 0xff;
  await mkdir(join(snapshot, "uploads"), { recursive: true, mode: 0o700 });
  await writeFile(join(snapshot, "database.dump"), database, { mode: 0o600 });
  await writeFile(join(snapshot, "uploads", uploadKey), upload, {
    mode: 0o600,
  });
  const manifest: BackupManifest = {
    version: 2,
    managedBy: "tell-aviv-backup-v2",
    createdAt: "2026-10-03T20:00:00.000Z",
    databaseChecksum: sha(database),
    databaseBytes: database.length,
    storageProvider: "local",
    uploadsCopied: true,
    uploads: [{ key: uploadKey, size: upload.length, sha256: sha(upload) }],
    complete: true,
    snapshotConsistency: "isolated fixture",
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
  await writeFile(join(snapshot, "manifest.json"), manifestBytes);
  return {
    root,
    snapshot,
    uploadKey,
    database,
    upload,
    manifest,
    manifestBytes,
  };
}
describe("authenticated encrypted backup envelopes", () => {
  it("round-trips exact binary/manifest bytes and independently randomized ciphertext while preserving the plaintext snapshot", async () => {
    const f = await fixture(),
      first = await encryptBackup(f.snapshot, {
        key,
        root: join(f.root, "encrypted"),
      }),
      second = await encryptBackup(f.snapshot, {
        key,
        root: join(f.root, "encrypted"),
      });
    expect(first.algorithm).toBe("AES-256-GCM");
    expect(first.sha256).not.toBe(second.sha256);
    const encrypted = await readFile(first.path);
    expect(encrypted.includes(f.database)).toBe(false);
    expect(encrypted.includes(f.manifestBytes)).toBe(false);
    expect(encrypted.includes(key)).toBe(false);
    const decrypted = await decryptBackup(first.path, {
      key,
      root: join(f.root, "restore"),
    });
    expect(await readFile(join(decrypted.directory, "database.dump"))).toEqual(
      f.database,
    );
    expect(await readFile(join(decrypted.directory, "manifest.json"))).toEqual(
      f.manifestBytes,
    );
    expect(
      await readFile(join(decrypted.directory, "uploads", f.uploadKey)),
    ).toEqual(f.upload);
    expect(await verifyBackup(f.snapshot)).toEqual(f.manifest);
    expect(decrypted.manifest).toEqual(f.manifest);
    expect((await readdir(join(f.root, "restore"))).length).toBe(1);
  });
  it("rejects a wrong key, modified ciphertext/tag and a truncated envelope without publishing any plaintext or removing unrelated files", async () => {
    const f = await fixture(),
      envelope = await encryptBackup(f.snapshot, {
        key,
        root: join(f.root, "encrypted"),
      }),
      output = join(f.root, "restore");
    await mkdir(output);
    await writeFile(join(output, "keep-existing"), "untouched");
    await expect(
      decryptBackup(envelope.path, {
        key: Buffer.alloc(32, 0x43),
        root: output,
      }),
    ).rejects.toThrow("authentication failed");
    const bytes = await readFile(envelope.path);
    for (const offset of [bytes.length - 30, bytes.length - 1]) {
      const corrupt = Buffer.from(bytes);
      corrupt[offset] ^= 1;
      const path = join(f.root, `corrupt-${offset}`);
      await writeFile(path, corrupt);
      await expect(decryptBackup(path, { key, root: output })).rejects.toThrow(
        "authentication failed",
      );
    }
    const truncated = join(f.root, "truncated");
    await writeFile(truncated, bytes.subarray(0, 20));
    await expect(
      decryptBackup(truncated, { key, root: output }),
    ).rejects.toThrow();
    expect(await readdir(output)).toEqual(["keep-existing"]);
    expect(await readFile(join(output, "keep-existing"), "utf8")).toBe(
      "untouched",
    );
  });
  it("authenticates the format header, bounds input sizes and rejects missing or unlisted upload bytes", async () => {
    const f = await fixture(),
      envelope = await encryptBackup(f.snapshot, {
        key,
        root: join(f.root, "encrypted"),
      });
    const altered = await readFile(envelope.path);
    const offset = altered.indexOf(Buffer.from("2026"));
    expect(offset).toBeGreaterThan(0);
    altered[offset + 3] = 0x37;
    const changed = join(f.root, "changed-header");
    await writeFile(changed, altered);
    await expect(
      decryptBackup(changed, { key, root: join(f.root, "restore") }),
    ).rejects.toThrow("authentication failed");
    await expect(
      decryptBackup(envelope.path, {
        key,
        root: join(f.root, "restore"),
        maxBytes: 8,
      }),
    ).rejects.toThrow();
    await expect(
      encryptBackup(f.snapshot, {
        key,
        root: join(f.root, "encrypted"),
        maxBytes: 8,
      }),
    ).rejects.toThrow("byte limit");
    await writeFile(join(f.snapshot, "uploads", randomUUID()), "not listed");
    await expect(verifyBackup(f.snapshot)).rejects.toThrow(
      "outside its verified manifest",
    );
    await rm(join(f.snapshot, "uploads", f.uploadKey));
    await expect(
      encryptBackup(f.snapshot, { key, root: join(f.root, "encrypted") }),
    ).rejects.toThrow();
    expect(await readdir(join(f.root, "encrypted"))).toHaveLength(1);
  });
  it("accepts only private raw key files outside protected trees and refuses key/envelope symlinks", async () => {
    const f = await fixture(),
      path = join(f.root, "operator.key");
    await writeFile(path, key, { mode: 0o600 });
    expect(await readBackupEncryptionKey(path, [f.snapshot])).toEqual(key);
    await expect(readBackupEncryptionKey(path, [f.root])).rejects.toThrow(
      "outside source and backup",
    );
    await chmod(path, 0o644);
    await expect(readBackupEncryptionKey(path)).rejects.toThrow(
      "private regular",
    );
    await chmod(path, 0o600);
    const keyLink = join(f.root, "key-link");
    await symlink(path, keyLink);
    await expect(readBackupEncryptionKey(keyLink)).rejects.toThrow();
    await expect(
      encryptBackup(f.snapshot, {
        key: Buffer.alloc(31),
        root: join(f.root, "encrypted"),
      }),
    ).rejects.toThrow("32-byte");
    const envelope = await encryptBackup(f.snapshot, {
        key,
        root: join(f.root, "encrypted"),
      }),
      linked = join(f.root, "linked-envelope");
    await symlink(envelope.path, linked);
    await expect(
      decryptBackup(linked, { key, root: join(f.root, "restore") }),
    ).rejects.toThrow();
    expect(await readdir(join(f.root, "restore"))).toHaveLength(0);
  });
});
describe("encrypted backup destination abstraction", () => {
  it("fixture-tests upload/read-back checksums, exact bytes and immutable destination names", async () => {
    const f = await fixture(),
      envelope = await encryptBackup(f.snapshot, {
        key,
        root: join(f.root, "encrypted"),
      }),
      destination = new FilesystemBackupDestination(
        join(f.root, "separate-volume"),
      ),
      returned = await destination.put(
        envelope.key,
        envelope.path,
        envelope.sha256,
      );
    expect(returned).toEqual({
      bytes: envelope.bytes,
      sha256: envelope.sha256,
    });
    const retrieved = join(f.root, "retrieved.tae");
    await destination.retrieve(envelope.key, retrieved, envelope.sha256);
    expect(await readFile(retrieved)).toEqual(await readFile(envelope.path));
    await expect(
      destination.put(envelope.key, envelope.path, envelope.sha256),
    ).rejects.toMatchObject({ code: "EEXIST" });
    await expect(
      destination.retrieve(envelope.key, retrieved, envelope.sha256),
    ).rejects.toMatchObject({ code: "EEXIST" });
    const decrypted = await decryptBackup(retrieved, {
      key,
      root: join(f.root, "restored"),
    });
    expect(decrypted.manifest).toEqual(f.manifest);
  });
  it("rejects traversal, wrong transfer checksums, source/volume symlinks and never publishes failed transfers", async () => {
    const f = await fixture(),
      envelope = await encryptBackup(f.snapshot, {
        key,
        root: join(f.root, "encrypted"),
      }),
      volume = join(f.root, "volume"),
      destination = new FilesystemBackupDestination(volume);
    await expect(
      destination.put("../private", envelope.path, envelope.sha256),
    ).rejects.toThrow("destination key");
    await expect(
      destination.put(envelope.key, envelope.path, "0".repeat(64)),
    ).rejects.toThrow("checksum verification failed");
    expect(await readdir(volume)).toHaveLength(0);
    const link = join(f.root, "source-link");
    await symlink(envelope.path, link);
    await expect(
      destination.put(envelope.key, link, envelope.sha256),
    ).rejects.toThrow();
    expect(await readdir(volume)).toHaveLength(0);
    const volumeLink = join(f.root, "volume-link");
    await symlink(volume, volumeLink);
    await expect(
      new FilesystemBackupDestination(volumeLink).put(
        envelope.key,
        envelope.path,
        envelope.sha256,
      ),
    ).rejects.toThrow("regular directory");
  });
});
