import { closeDatabase } from "@tell-aviv/database";
import { purgeExpiredSchoolTrash } from "../packages/platform/src/classes/lifecycle";
import { processStorageCleanup } from "../packages/platform/src/account";
// Schedule this trusted server-side worker; it is not an HTTP endpoint.
try {
  console.log({
    schoolTrash: await purgeExpiredSchoolTrash({ limit: 500 }),
    storage: await processStorageCleanup(500),
  });
} finally {
  await closeDatabase();
}
