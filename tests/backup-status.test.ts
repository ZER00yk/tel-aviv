import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@tell-aviv/database";
import {
  projectBackupStatus,
  recordBackupStatus,
} from "../packages/platform/src/backupStatus";
const at = "2026-10-03T20:00:00.000Z",
  sha256 = "a".repeat(64);
describe("safe backup operator metadata", () => {
  it("projects only verified bounded metadata and computes backup age without exposing paths or secrets", () => {
    const result = projectBackupStatus(
      {
        snapshot: {
          at,
          databaseBytes: 99,
          uploads: 2,
          verified: true,
          format: "v2",
          path: "/private/backup",
          token: "secret-token",
        },
        encrypted: {
          at,
          bytes: 150,
          sha256,
          algorithm: "AES-256-GCM",
          key: "secret-key",
        },
        destination: {
          at,
          bytes: 150,
          sha256,
          kind: "filesystem",
          verified: true,
          path: "/private/destination",
        },
        restoreDrill: {
          at,
          tables: 100,
          accounts: 3,
          migrations: 40,
          uploads: 2,
          verified: true,
          databaseUrl: "private-credentials",
        },
        arbitrary: "secret",
      },
      new Date("2026-10-03T21:00:00Z"),
    );
    expect(result.latestBackup?.ageSeconds).toBe(3600);
    expect(result.lastRestoreDrill?.uploads).toBe(2);
    for (const forbidden of [
      "/private",
      "secret",
      "credentials",
      "databaseUrl",
      "token",
    ])
      expect(JSON.stringify(result)).not.toContain(forbidden);
    expect(
      projectBackupStatus({
        snapshot: {
          at,
          databaseBytes: 2,
          uploads: 0,
          format: "v2",
          verified: false,
        },
        encrypted: { at, bytes: -1, sha256, algorithm: "AES-256-GCM" },
      }).latestBackup,
    ).toBeNull();
    expect(
      projectBackupStatus({
        encrypted: { at, bytes: -1, sha256, algorithm: "AES-256-GCM" },
        destination: { at, bytes: 1, sha256, kind: "unknown", verified: true },
        restoreDrill: {
          at,
          tables: 2,
          accounts: 1,
          migrations: Infinity,
          uploads: 0,
          verified: true,
        },
      }),
    ).toMatchObject({
      encryption: null,
      destination: null,
      lastRestoreDrill: null,
    });
    expect(projectBackupStatus(undefined).latestBackup).toBeNull();
  });
});
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "durable backup status receipts",
  () => {
    const name = `backup-status-fixture:${randomUUID()}`;
    afterAll(async () => {
      await db`DELETE FROM operation_state WHERE name=${name}`;
    });
    it("atomically merges concurrent receipts and stores no extra supplied details", async () => {
      await Promise.all([
        recordBackupStatus(
          "snapshot",
          {
            at,
            databaseBytes: 50,
            uploads: 2,
            verified: true,
            format: "v2",
            ...{ path: "/private", secret: "never stored" },
          },
          db,
          name,
        ),
        recordBackupStatus(
          "encrypted",
          {
            at,
            bytes: 100,
            sha256,
            algorithm: "AES-256-GCM",
            ...{ key: "never stored" },
          },
          db,
          name,
        ),
        recordBackupStatus(
          "restoreDrill",
          {
            at,
            tables: 100,
            accounts: 3,
            migrations: 40,
            uploads: 2,
            verified: true,
          },
          db,
          name,
        ),
      ]);
      const [row] =
        await db`SELECT data FROM operation_state WHERE name=${name}`;
      expect(Object.keys(row.data).sort()).toEqual([
        "encrypted",
        "restoreDrill",
        "snapshot",
      ]);
      expect(projectBackupStatus(row.data).latestBackup?.uploads).toBe(2);
      expect(JSON.stringify(row.data)).not.toContain("never stored");
      expect(JSON.stringify(row.data)).not.toContain("/private");
      await expect(
        recordBackupStatus(
          "encrypted",
          { at, bytes: -1, sha256, algorithm: "AES-256-GCM" },
          db,
          name,
        ),
      ).rejects.toThrow("Invalid backup status");
    });
  },
);
