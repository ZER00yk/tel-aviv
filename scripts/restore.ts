import { cp, lstat, mkdtemp, readdir, rm, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifyBackup, pgEnvironment, pgBinary } from "./ops/backup";
const run = promisify(execFile),
  directory = process.argv[2];
if (!directory || !process.argv.includes("--confirm-restore"))
  throw Error(
    "Use restore.ts <backup-directory> --confirm-restore with RESTORE_DATABASE_URL pointing to an EMPTY database.",
  );
const target = process.env.RESTORE_DATABASE_URL;
if (!target)
  throw Error(
    "Explicit RESTORE_DATABASE_URL is required; the normal database will not be selected automatically.",
  );
const manifest = await verifyBackup(directory),
  env = pgEnvironment(target);
const uploadTarget = process.env.RESTORE_UPLOAD_PATH
  ? resolve(process.env.RESTORE_UPLOAD_PATH)
  : null;
if (manifest.uploadsCopied && !uploadTarget)
  throw Error(
    "Set a new RESTORE_UPLOAD_PATH before restoring database and binary files.",
  );
if (uploadTarget) {
  try {
    const stat = await lstat(uploadTarget);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await readdir(uploadTarget)).length
    )
      throw Error("Restore upload target must be an empty regular directory.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
const { stdout } = await run(
  pgBinary("psql", process.env.PSQL_BIN),
  [
    "--tuples-only",
    "--no-align",
    "--command",
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
  ],
  { env },
);
if (Number(stdout.trim()) !== 0)
  throw Error(
    "Restore target is not empty. Use a new database and switch configuration after verification.",
  );
// Verify all checksums and stage uploads before touching the new database.
let staged: string | null = null;
let stagingRoot: string | null = null;
if (manifest.uploadsCopied && uploadTarget) {
  stagingRoot = await mkdtemp(`${uploadTarget}.restoring-`);
  staged = join(stagingRoot, "uploads");
  try {
    await cp(join(resolve(directory), "uploads"), staged, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}
try {
  await run(
    pgBinary("pg_restore", process.env.PG_RESTORE_BIN),
    [
      "--single-transaction",
      "--exit-on-error",
      "--no-owner",
      "--no-acl",
      "--dbname",
      env.PGDATABASE,
      resolve(directory, "database.dump"),
    ],
    { env, timeout: 30 * 60000, maxBuffer: 1024 * 1024 },
  );
  if (staged && uploadTarget) {
    await rename(staged, uploadTarget);
  }
} catch (error) {
  throw error;
} finally {
  if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true });
}
console.log(
  "Restore completed. Verify data and protected file access before switching application configuration.",
);
