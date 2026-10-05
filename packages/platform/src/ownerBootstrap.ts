import type { TransactionSql } from "postgres";
import { z } from "zod";
import { fail } from "@tell-aviv/shared";
/** Host-only operator tooling. No HTTP handler calls this function. */
export async function bootstrapOwner(
  sql: TransactionSql,
  userId: string,
  confirmation?: string,
) {
  const id = z.string().uuid().parse(userId);
  await sql`SELECT pg_advisory_xact_lock(hashtextextended('tell-aviv:first-native-owner:v1',0))`;
  const [target] =
    await sql`SELECT u.id,u.username,u.role,u.disabled,EXISTS(SELECT 1 FROM user_credentials c WHERE c.user_id=u.id AND c.password_hash LIKE '$argon2id$%') AS native
    FROM users u WHERE u.id=${id} FOR UPDATE OF u`;
  if (!target) fail(404, "Account not found");
  if (target.disabled || !target.native)
    fail(400, "Choose an active native-password account");
  const owners = await sql`SELECT id FROM users WHERE role='owner' ORDER BY id`;
  if (owners.some((owner) => owner.id !== id))
    fail(409, "An owner already exists; bootstrap cannot replace an owner");
  if (target.role === "owner")
    return {
      accountId: id,
      username: target.username as string,
      owner: true,
      changed: false,
      dryRun: confirmation === undefined,
    };
  if (confirmation === undefined)
    return {
      accountId: id,
      username: target.username as string,
      owner: false,
      changed: false,
      dryRun: true,
      confirmation: `BOOTSTRAP OWNER ${id}`,
    };
  if (confirmation !== `BOOTSTRAP OWNER ${id}`)
    fail(400, "Use the exact UUID bootstrap confirmation");
  await sql`UPDATE users SET role='owner' WHERE id=${id}`;
  await sql`INSERT INTO admin_audit_log(actor_id,actor_username,target_id,target_username,action,details)
    VALUES(${id},${target.username},${id},${target.username},'owner.bootstrap',${sql.json({ source: "host operator", previousRole: target.role as string })})`;
  return {
    accountId: id,
    username: target.username as string,
    owner: true,
    changed: true,
    dryRun: false,
  };
}
