import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
try {
  process.loadEnvFile(resolve(process.cwd(), ".env"));
} catch {
  /* runtime env also supported */
}
export async function migrate() {
  const { db } = await import("./index");
  await db`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
  const directory = fileURLToPath(new URL("../migrations/", import.meta.url));
  for (const name of (await readdir(directory))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    const source = await readFile(resolve(directory, name), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    await db.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(7182026)`;
      const [existing] =
        await tx`SELECT checksum FROM schema_migrations WHERE name=${name}`;
      if (existing) {
        if (existing.checksum !== checksum)
          throw new Error(`Applied migration changed: ${name}`);
        return;
      }
      await tx.unsafe(source);
      await tx`INSERT INTO schema_migrations (name,checksum) VALUES (${name},${checksum})`;
      console.log(`Applied ${name}`);
    });
  }
  return db;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  migrate()
    .then(async () => {
      const { closeDatabase } = await import("./index");
      await closeDatabase();
    })
    .catch(async (error) => {
      console.error(
        error instanceof Error ? error.message : "Migration failed",
      );
      process.exitCode = 1;
      const { closeDatabase } = await import("./index");
      await closeDatabase();
    });
}
