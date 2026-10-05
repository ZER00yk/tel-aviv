import { constants, existsSync } from "node:fs";
import {
  mkdir,
  writeFile,
  readFile,
  rename,
  lstat,
  readdir,
  rm,
  open,
} from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  getStorageProvider,
  storageKeyIsValid,
  type StorageProvider,
} from "../../packages/storage/src/index";
import type { TransactionSql } from "postgres";
const run = promisify(execFile);
export interface BackupManifest {
  version: 2;
  managedBy: "tell-aviv-backup-v2";
  createdAt: string;
  databaseChecksum: string;
  databaseBytes: number;
  storageProvider: string;
  uploadsCopied: boolean;
  uploads: { key: string; size: number; sha256: string }[];
  complete: true;
  snapshotConsistency: string;
}
export async function checksumFile(path: string) {
  const hash = createHash("sha256");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile())
      throw Error("Checksum input must be a regular file");
    const stream = file.createReadStream({ autoClose: false });
    try {
      for await (const chunk of stream) hash.update(chunk);
    } finally {
      stream.destroy();
    }
    return hash.digest("hex");
  } finally {
    await file.close();
  }
}
export function pgEnvironment(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    ...(url.searchParams.get("sslmode")
      ? { PGSSLMODE: url.searchParams.get("sslmode")! }
      : {}),
  };
}
export function pgBinary(name: string, override?: string) {
  const local = resolve(
    ".local/services/bin-root/usr/lib/postgresql/17/bin",
    name,
  );
  return override ?? (existsSync(local) ? local : name);
}
export async function withUploadSnapshot<T>(
  work: (tx: TransactionSql) => Promise<T>,
) {
  const { db } = await import("@tell-aviv/database");
  return db.begin(async (guard) => {
    await guard`select pg_advisory_xact_lock(hashtextextended('backup-upload-bytes:v2',719025))`;
    return db.begin("isolation level repeatable read read only", (tx) =>
      work(tx),
    );
  }) as Promise<T>;
}
/** SQL uses an exported snapshot; immutable upload keys are copied from that same snapshot. */
export async function createBackup(
  options: { root?: string; provider?: StorageProvider; now?: Date } = {},
) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw Error("DATABASE_URL is required");
  const root = resolve(
    options.root ?? process.env.BACKUP_PATH ?? "/workspace/tell-aviv-backups",
  );
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw Error("Invalid backup date");
  const name = `tell-aviv-${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const temporary = join(root, `.in-progress-${name}`),
    directory = join(root, name);
  await mkdir(temporary, { mode: 0o700 });
  const provider = options.provider ?? getStorageProvider();
  try {
    // Establish the snapshot only after physical deletion is excluded. A waiting
    // repeatable-read transaction would otherwise retain a pre-lock snapshot.
    const uploads = await withUploadSnapshot(async (tx) => {
      const [snapshot] = await tx`select pg_export_snapshot() as id`;
      const keys =
        await tx`with files as (select data->>'key' as key,case when data->>'size'~'^[0-9]{1,16}$' then (data->>'size')::bigint else null end as expected from school_resources where kind='file' union all select storage_key::text,bytes from chat_attachments) select key,max(expected) as expected from files group by key order by key`;
      if (keys.some((row) => !storageKeyIsValid(String(row.key))))
        throw Error("Backup stopped: invalid referenced upload key");
      await run(
        pgBinary("pg_dump", process.env.PG_DUMP_BIN),
        [
          "--format=custom",
          "--no-owner",
          "--no-acl",
          `--snapshot=${snapshot.id}`,
          "--file",
          join(temporary, "database.dump"),
        ],
        {
          env: pgEnvironment(databaseUrl),
          timeout: 30 * 60000,
          maxBuffer: 1024 * 1024,
        },
      );
      await mkdir(join(temporary, "uploads"), { mode: 0o700 });
      const entries: BackupManifest["uploads"] = [];
      for (const row of keys) {
        const key = String(row.key),
          bytes = await provider.read(key);
        if (bytes.byteLength === 0)
          throw Error("Backup stopped: referenced upload is empty");
        if (row.expected !== null && Number(row.expected) !== bytes.byteLength)
          throw Error(
            "Backup stopped: referenced upload size does not match metadata",
          );
        await writeFile(join(temporary, "uploads", key), bytes, {
          mode: 0o600,
          flag: "wx",
        });
        entries.push({
          key,
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
      return entries;
    });
    const manifest: BackupManifest = {
      version: 2,
      managedBy: "tell-aviv-backup-v2",
      createdAt: now.toISOString(),
      databaseChecksum: await checksumFile(join(temporary, "database.dump")),
      databaseBytes: (await lstat(join(temporary, "database.dump"))).size,
      storageProvider: process.env.STORAGE_PROVIDER ?? "local",
      uploadsCopied: true,
      uploads,
      complete: true,
      snapshotConsistency:
        "exported PostgreSQL snapshot; immutable referenced uploads; missing bytes abort completion",
    };
    await writeFile(
      join(temporary, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      { mode: 0o600, flag: "wx" },
    );
    await rename(temporary, directory);
    return { directory, manifest };
  } catch (error) {
    await writeFile(
      join(temporary, "failed.json"),
      JSON.stringify({
        version: 1,
        failedAt: new Date().toISOString(),
        reason: "Backup did not complete. Inspect protected worker logs.",
      }),
      { mode: 0o600 },
    ).catch(() => undefined);
    throw error;
  }
}
export async function verifyBackup(directory: string) {
  const path = resolve(directory),
    info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw Error("Backup directory must be a regular directory");
  for (const name of ["manifest.json", "database.dump"]) {
    const file = await lstat(join(path, name));
    if (!file.isFile() || file.isSymbolicLink())
      throw Error("Backup metadata must be regular files");
  }
  const manifest = JSON.parse(
    await readFile(join(path, "manifest.json"), "utf8"),
  ) as
    | BackupManifest
    | { version: 1; databaseChecksum: string; uploadsCopied: boolean };
  if (
    ![1, 2].includes(manifest.version) ||
    !/^[0-9a-f]{64}$/.test(manifest.databaseChecksum) ||
    (await checksumFile(join(path, "database.dump"))) !==
      manifest.databaseChecksum
  )
    throw Error("Backup database checksum verification failed");
  if (manifest.version === 2) {
    if (
      manifest.managedBy !== "tell-aviv-backup-v2" ||
      manifest.complete !== true ||
      manifest.uploadsCopied !== true ||
      !Array.isArray(manifest.uploads) ||
      !Number.isSafeInteger(manifest.databaseBytes) ||
      manifest.databaseBytes !==
        (await lstat(join(path, "database.dump"))).size ||
      !Number.isFinite(new Date(manifest.createdAt).getTime())
    )
      throw Error("Backup manifest is invalid");
    const uploadDirectory = await lstat(join(path, "uploads"));
    if (!uploadDirectory.isDirectory() || uploadDirectory.isSymbolicLink())
      throw Error("Backup uploads must be a regular directory");
    const seen = new Set<string>();
    for (const object of manifest.uploads) {
      if (
        !storageKeyIsValid(object.key) ||
        seen.has(object.key) ||
        !Number.isSafeInteger(object.size) ||
        object.size <= 0 ||
        !/^[0-9a-f]{64}$/.test(object.sha256)
      )
        throw Error("Backup upload manifest is invalid");
      seen.add(object.key);
      const file = join(path, "uploads", object.key),
        stat = await lstat(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size !== object.size ||
        (await checksumFile(file)) !== object.sha256
      )
        throw Error("Backup upload checksum verification failed");
    }
    const actualUploads = await readdir(join(path, "uploads"));
    if (
      actualUploads.length !== seen.size ||
      actualUploads.some((key) => !seen.has(key))
    )
      throw Error("Backup contains uploads outside its verified manifest");
    const actualFiles = await readdir(path);
    if (
      actualFiles.length !== 3 ||
      actualFiles.some(
        (name) => !["manifest.json", "database.dump", "uploads"].includes(name),
      )
    )
      throw Error("Backup contains files outside its verified manifest");
  }
  return manifest;
}
/** Delete only completed, verified snapshots created by this implementation; dry run is default. */
export async function pruneBackups(
  options: {
    root?: string;
    retainDays?: number;
    minKeep?: number;
    apply?: boolean;
    now?: Date;
  } = {},
) {
  const root = resolve(
    options.root ?? process.env.BACKUP_PATH ?? "/workspace/tell-aviv-backups",
  );
  const retainDays = options.retainDays ?? 14,
    minKeep = options.minKeep ?? 7,
    now = options.now ?? new Date();
  if (
    !Number.isInteger(retainDays) ||
    retainDays < 1 ||
    !Number.isInteger(minKeep) ||
    minKeep < 2 ||
    !Number.isFinite(now.getTime())
  )
    throw Error("Invalid backup retention policy");
  const snapshots: { name: string; createdAt: number }[] = [];
  let rejected = 0;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { removed: 0, candidates: [], retained: 0, rejected: 0 };
    throw error;
  }
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !/^tell-aviv-\d{4}-\d{2}-\d{2}T[0-9TZ-]+-[0-9a-f]{8}$/.test(entry.name)
    )
      continue;
    try {
      const manifest = await verifyBackup(join(root, entry.name));
      if (
        manifest.version === 2 &&
        manifest.managedBy === "tell-aviv-backup-v2"
      )
        snapshots.push({
          name: entry.name,
          createdAt: new Date(manifest.createdAt).getTime(),
        });
    } catch {
      rejected++;
    }
  }
  snapshots.sort((a, b) => b.createdAt - a.createdAt);
  const candidates = snapshots
    .filter(
      (snapshot, index) =>
        index >= minKeep &&
        snapshot.createdAt < now.getTime() - retainDays * 86400000,
    )
    .map((item) => item.name);
  if (options.apply)
    for (const name of candidates) {
      if (basename(name) !== name) throw Error("Invalid snapshot name");
      await rm(join(root, name), { recursive: true, force: false });
    }
  return {
    removed: options.apply ? candidates.length : 0,
    candidates,
    retained: snapshots.length - (options.apply ? candidates.length : 0),
    rejected,
  };
}
