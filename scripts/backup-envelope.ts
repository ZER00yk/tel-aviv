import { resolve } from "node:path";
import {
  decryptBackup,
  encryptBackup,
  readBackupEncryptionKey,
} from "./ops/envelope";
const [operation, source, root] = process.argv.slice(2),
  keyFile = process.env.BACKUP_ENCRYPTION_KEY_FILE;
if (!["encrypt", "decrypt"].includes(operation) || !source || !root || !keyFile)
  throw Error(
    "Use backup-envelope.ts encrypt|decrypt <source> <new-output-root> with BACKUP_ENCRYPTION_KEY_FILE set to a private raw 32-byte key outside source and backup directories.",
  );
const key = await readBackupEncryptionKey(keyFile, [
  process.cwd(),
  resolve(root),
  operation === "encrypt" ? resolve(source) : resolve(source, ".."),
]);
try {
  const result =
    operation === "encrypt"
      ? await encryptBackup(source, { key, root })
      : await decryptBackup(source, { key, root });
  console.log(
    operation === "encrypt"
      ? { operation, ...result }
      : {
          operation,
          directory: "directory" in result ? result.directory : undefined,
          verified: true,
        },
  );
} finally {
  key.fill(0);
}
