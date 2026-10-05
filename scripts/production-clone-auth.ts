import postgres from "postgres";

// This tool is deliberately separate from upgrades to an existing production
// installation. It invalidates credentials tied to a newly restored deployment
// copy, preserving account UUIDs, passwords, ownership and application data.
if (
  !process.argv.includes("--confirm-new-deployment-copy") ||
  process.env.DEPLOY_ISOLATED_COPY !== "true" ||
  process.env.NODE_ENV !== "production" ||
  process.env.DEV_AUTH !== "false" ||
  !process.env.DATABASE_URL
)
  throw new Error(
    "Require an isolated production copy and --confirm-new-deployment-copy",
  );

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(7182026)`;
    await tx`DELETE FROM sessions`;
    await tx`DELETE FROM password_reset_tokens`;
    await tx`DELETE FROM email_verification_tokens`;
    await tx`DELETE FROM account_recovery_codes`;
  });
  console.log(
    "Restored copy: old sessions, reset/verification links and recovery codes invalidated; accounts and passwords preserved.",
  );
} finally {
  await sql.end();
}
