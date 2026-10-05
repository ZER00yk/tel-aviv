import type { Sql } from "postgres";
import { db } from "@tell-aviv/database";

export interface BackupStatusData {
  snapshot?: {
    at: string;
    databaseBytes: number;
    uploads: number;
    verified: true;
    format: "v2";
  };
  encrypted?: {
    at: string;
    bytes: number;
    sha256: string;
    algorithm: "AES-256-GCM";
  };
  destination?: {
    at: string;
    bytes: number;
    sha256: string;
    kind: "filesystem";
    verified: true;
  };
  restoreDrill?: {
    at: string;
    tables: number;
    accounts: number;
    migrations: number;
    uploads: number;
    verified: true;
  };
  retention?: {
    at: string;
    retainDays: number;
    minKeep: number;
    retained: number;
    candidates: number;
    removed: number;
    rejected: number;
  };
}
const date = (value: unknown): string | null =>
  typeof value === "string" && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toISOString()
    : null;
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
const hash = (value: unknown): string | null =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Strict public projection prevents paths, keys or arbitrary worker details escaping into admin JSON. */
export function projectBackupStatus(input: unknown, now = new Date()) {
  const data = record(input),
    snapshot = record(data.snapshot),
    encrypted = record(data.encrypted),
    destination = record(data.destination),
    restored = record(data.restoreDrill),
    retention = record(data.retention);
  const at = date(snapshot.at);
  return {
    latestBackup:
      at &&
      snapshot.verified === true &&
      snapshot.format === "v2" &&
      count(snapshot.databaseBytes) !== null &&
      count(snapshot.uploads) !== null
        ? {
            at,
            ageSeconds: Math.max(
              0,
              Math.floor((now.getTime() - new Date(at).getTime()) / 1000),
            ),
            databaseBytes: count(snapshot.databaseBytes)!,
            uploads: count(snapshot.uploads)!,
            verified: true,
          }
        : null,
    encryption:
      date(encrypted.at) &&
      encrypted.algorithm === "AES-256-GCM" &&
      count(encrypted.bytes) !== null &&
      hash(encrypted.sha256)
        ? {
            at: date(encrypted.at)!,
            bytes: count(encrypted.bytes)!,
            sha256: hash(encrypted.sha256)!,
            algorithm: "AES-256-GCM",
          }
        : null,
    destination:
      date(destination.at) &&
      destination.kind === "filesystem" &&
      destination.verified === true &&
      count(destination.bytes) !== null &&
      hash(destination.sha256)
        ? {
            at: date(destination.at)!,
            bytes: count(destination.bytes)!,
            sha256: hash(destination.sha256)!,
            kind: "filesystem",
            verified: true,
          }
        : null,
    lastRestoreDrill:
      date(restored.at) &&
      restored.verified === true &&
      [
        restored.tables,
        restored.accounts,
        restored.migrations,
        restored.uploads,
      ].every((value) => count(value) !== null)
        ? {
            at: date(restored.at)!,
            tables: count(restored.tables)!,
            accounts: count(restored.accounts)!,
            migrations: count(restored.migrations)!,
            uploads: count(restored.uploads)!,
            verified: true,
          }
        : null,
    retention:
      date(retention.at) &&
      count(retention.retainDays) !== null &&
      Number(retention.retainDays) >= 1 &&
      count(retention.minKeep) !== null &&
      Number(retention.minKeep) >= 2 &&
      [
        retention.retained,
        retention.candidates,
        retention.removed,
        retention.rejected,
      ].every((value) => count(value) !== null)
        ? {
            at: date(retention.at)!,
            retainDays: count(retention.retainDays)!,
            minKeep: count(retention.minKeep)!,
            retained: count(retention.retained)!,
            candidates: count(retention.candidates)!,
            removed: count(retention.removed)!,
            rejected: count(retention.rejected)!,
          }
        : null,
  };
}
export async function recordBackupStatus<K extends keyof BackupStatusData>(
  kind: K,
  value: NonNullable<BackupStatusData[K]>,
  sql: Sql = db,
  name = "backup-status:v1",
) {
  // A complete strict projection must accept the value before it reaches persistence.
  const projected = projectBackupStatus({ [kind]: value });
  const projectedKey = {
    snapshot: "latestBackup",
    encrypted: "encryption",
    destination: "destination",
    restoreDrill: "lastRestoreDrill",
    retention: "retention",
  }[kind] as keyof typeof projected;
  if (!projected[projectedKey]) throw Error("Invalid backup status metadata");
  const safe =
    kind === "snapshot"
      ? {
          at: date(value.at)!,
          databaseBytes: count(
            (value as BackupStatusData["snapshot"])!.databaseBytes,
          )!,
          uploads: count((value as BackupStatusData["snapshot"])!.uploads)!,
          verified: true,
          format: "v2",
        }
      : projected[projectedKey];
  await sql`INSERT INTO operation_state(name,data) VALUES(${name},${sql.json({ [kind]: safe })}) ON CONFLICT(name) DO UPDATE SET data=operation_state.data||excluded.data,updated_at=now()`;
}
export async function backupOperationsStatus() {
  const [row] =
    await db`SELECT data FROM operation_state WHERE name='backup-status:v1'`;
  return projectBackupStatus(row?.data);
}
