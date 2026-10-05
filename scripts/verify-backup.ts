import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { rm, lstat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import {
  verifyBackup,
  checksumFile,
  pgBinary,
  pgEnvironment,
} from "./ops/backup";
import { recordBackupStatus } from "../packages/platform/src/backupStatus";
import { closeDatabase } from "@tell-aviv/database";
const run = promisify(execFile),
  directory = process.argv[2];
if (!directory) throw Error("Supply an existing backup directory");
const manifest = await verifyBackup(directory);
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
const original = new URL(process.env.DATABASE_URL),
  target = new URL(original);
const name = `tellaviv_restore_${randomBytes(5).toString("hex")}`;
target.pathname = `/${name}`;
const env = pgEnvironment(original.toString());
const uploads = resolve("/tmp", name);
await run(pgBinary("createdb", process.env.CREATEDB_BIN), [name], { env });
const sql = postgres(target.toString());
try {
  await run(
    resolve("node_modules/.bin/tsx"),
    ["scripts/restore.ts", directory, "--confirm-restore"],
    {
      env: {
        ...env,
        RESTORE_DATABASE_URL: target.toString(),
        RESTORE_UPLOAD_PATH: uploads,
      },
    },
  );
  const [tables] =
    await sql`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'`;
  const [users] = await sql`SELECT count(*)::int AS count FROM users`;
  const [migrations] =
    await sql`SELECT count(*)::int AS count FROM schema_migrations`;
  if (tables.count < 30 || users.count < 1 || migrations.count < 6)
    throw Error("Restored fixture data is incomplete");
  if (manifest.version === 2) {
    for (const object of manifest.uploads) {
      const file = join(uploads, object.key),
        stat = await lstat(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size !== object.size ||
        (await checksumFile(file)) !== object.sha256
      )
        throw Error("Restored upload bytes do not match the verified snapshot");
    }
  }
  await recordBackupStatus("restoreDrill", {
    at: new Date().toISOString(),
    tables: tables.count,
    accounts: users.count,
    migrations: migrations.count,
    uploads: manifest.version === 2 ? manifest.uploads.length : 0,
    verified: true,
  });
  console.log(
    `PASS: isolated restore verified ${tables.count} tables, ${users.count} accounts and ${migrations.count} migrations${manifest.version === 2 ? `, plus ${manifest.uploads.length} restored upload checksums` : ""}.`,
  );
} finally {
  await sql.end();
  await run(pgBinary("dropdb", process.env.DROPDB_BIN), [name], { env });
  await rm(uploads, { recursive: true, force: true });
  await closeDatabase();
}
