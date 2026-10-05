import { closeDatabase } from "@tell-aviv/database";
import { processStorageCleanup } from "../packages/platform/src/account";
try {
  console.log(await processStorageCleanup(500));
} finally {
  await closeDatabase();
}
