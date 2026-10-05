import { closeDatabase } from "@tell-aviv/database";
import {
  reconcileStorage,
  storageOperationsHealth,
} from "../packages/platform/src/storageReconciliation";
const apply = process.argv.includes("--apply");
try {
  console.log({
    reconciliation: await reconcileStorage({
      apply,
      persist: apply,
      limit: 100,
    }),
    health: await storageOperationsHealth(),
  });
} finally {
  await closeDatabase();
}
