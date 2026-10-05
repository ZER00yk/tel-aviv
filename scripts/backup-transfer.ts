import { FilesystemBackupDestination } from "./ops/envelope";
const [operation, key, path, checksum] = process.argv.slice(2),
  root = process.env.BACKUP_DESTINATION_PATH;
if (!["put", "get"].includes(operation) || !key || !path || !checksum || !root)
  throw Error(
    "Use backup-transfer.ts put|get <envelope-filename> <local-file> <sha256> with BACKUP_DESTINATION_PATH set to a separately administered mounted volume.",
  );
const destination = new FilesystemBackupDestination(root);
if (operation === "put")
  console.log({
    verified: true,
    ...(await destination.put(key, path, checksum)),
  });
else {
  await destination.retrieve(key, path, checksum);
  console.log({ retrieved: true, verified: true });
}
