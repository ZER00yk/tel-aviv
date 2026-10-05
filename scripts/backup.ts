import { closeDatabase } from "@tell-aviv/database";
import { createProtectedBackup } from "./ops/protectedBackup";
try {
  const backup = await createProtectedBackup();
  console.log(`Backup created: ${backup.directory}`);
  console.log({
    version: backup.manifest.version,
    uploads: backup.manifest.uploads.length,
    databaseBytes: backup.manifest.databaseBytes,
  });
} finally {
  await closeDatabase();
}
