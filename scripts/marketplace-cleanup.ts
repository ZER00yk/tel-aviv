import { closeDatabase } from "@tell-aviv/database";
import { expireCasinoOffers } from "../packages/platform/src/casinoMarketplace";
try {
  const expired = await expireCasinoOffers(100);
  process.stdout.write(`${JSON.stringify({ expired })}\n`);
} finally {
  await closeDatabase();
}
