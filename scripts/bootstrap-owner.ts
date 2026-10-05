import { db, closeDatabase } from "@tell-aviv/database";
import { bootstrapOwner } from "../packages/platform/src/ownerBootstrap";
const args = process.argv.slice(2);
try {
  if (!process.env.DATABASE_URL)
    throw Error("Set DATABASE_URL securely before owner bootstrap");
  if (
    !args[0] ||
    (args.length !== 1 && (args.length !== 3 || args[1] !== "--confirm"))
  )
    throw Error(
      'Usage: bootstrap-owner.ts <existing-account-uuid> [--confirm "BOOTSTRAP OWNER <same-uuid>"]; omission previews only',
    );
  const result = await db.begin((sql) => bootstrapOwner(sql, args[0], args[2]));
  console.log(JSON.stringify(result));
} finally {
  await closeDatabase();
}
