import { resolve, sep } from "node:path";
import { createBackup, verifyBackup } from "./backup";
import {
  encryptBackup,
  FilesystemBackupDestination,
  readBackupEncryptionKey,
} from "./envelope";
import { recordBackupStatus } from "../../packages/platform/src/backupStatus";

/** Configuration is operator-only; no application request can select keys or destinations. */
export async function createProtectedBackup(
  options: Parameters<typeof createBackup>[0] = {},
) {
  const keyFile = process.env.BACKUP_ENCRYPTION_KEY_FILE,
    destinationRoot = process.env.BACKUP_DESTINATION_PATH,
    local = resolve(
      options.root ?? process.env.BACKUP_PATH ?? "/workspace/tell-aviv-backups",
    );
  if (destinationRoot && !keyFile)
    throw Error("Backup destination requires encrypted backups");
  if (destinationRoot) {
    const destination = resolve(destinationRoot);
    if (
      destination === local ||
      destination.startsWith(local + sep) ||
      local.startsWith(destination + sep)
    )
      throw Error(
        "Backup destination must be outside the local snapshot directory tree",
      );
  }
  // Fail malformed configuration before producing another private snapshot.
  const key = keyFile
    ? await readBackupEncryptionKey(keyFile, [
        process.cwd(),
        local,
        ...(destinationRoot ? [destinationRoot] : []),
      ])
    : null;
  try {
    const backup = await createBackup(options),
      at = new Date().toISOString();
    await verifyBackup(backup.directory);
    await recordBackupStatus("snapshot", {
      at,
      databaseBytes: backup.manifest.databaseBytes,
      uploads: backup.manifest.uploads.length,
      verified: true,
      format: "v2",
    });
    if (!key) return backup;
    const encrypted = await encryptBackup(backup.directory, {
      key,
      root: resolve(backup.directory, "..", "encrypted"),
    });
    await recordBackupStatus("encrypted", {
      at: new Date().toISOString(),
      bytes: encrypted.bytes,
      sha256: encrypted.sha256,
      algorithm: encrypted.algorithm,
    });
    if (destinationRoot) {
      const destination = resolve(destinationRoot);
      const transferred = await new FilesystemBackupDestination(
        destination,
      ).put(encrypted.key, encrypted.path, encrypted.sha256);
      await recordBackupStatus("destination", {
        at: new Date().toISOString(),
        bytes: transferred.bytes,
        sha256: transferred.sha256,
        kind: "filesystem",
        verified: true,
      });
    }
    return { ...backup, encrypted };
  } finally {
    key?.fill(0);
  }
}
