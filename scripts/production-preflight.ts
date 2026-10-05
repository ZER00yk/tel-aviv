import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/** Validate deployment settings without logging secrets or connecting to services. */
export function productionPreflight(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== "production" || env.DEV_AUTH !== "false")
    throw new Error(
      "Deployment requires NODE_ENV=production and DEV_AUTH=false",
    );
  let origin: URL;
  try {
    origin = new URL(env.APP_URL ?? "");
  } catch {
    throw new Error("APP_URL must be an absolute HTTPS origin");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("APP_URL must be an absolute HTTPS origin");
  if (!env.DATABASE_URL || !env.REDIS_URL)
    throw new Error("DATABASE_URL and REDIS_URL are required");
  const proxySecret = env.AUTH_TRUSTED_PROXY_SECRET ?? "";
  if (proxySecret.length < 32 || proxySecret.length > 256)
    throw new Error("Proxy proof secret must contain 32–256 characters");
  const metricsSecret = env.METRICS_SCRAPE_TOKEN ?? "";
  if (
    metricsSecret &&
    (metricsSecret.length < 32 ||
      metricsSecret.length > 256 ||
      metricsSecret === proxySecret)
  )
    throw new Error("Metrics token must be a separate 32–256 character secret");
  const memory = Number(env.AUTH_ARGON_MEMORY_KIB ?? 65536);
  const time = Number(env.AUTH_ARGON_TIME_COST ?? 3);
  const parallelism = Number(env.AUTH_ARGON_PARALLELISM ?? 1);
  if (
    !Number.isInteger(memory) ||
    memory < 65536 ||
    memory > 262144 ||
    !Number.isInteger(time) ||
    time < 3 ||
    time > 10 ||
    !Number.isInteger(parallelism) ||
    parallelism < 1 ||
    parallelism > 4
  )
    throw new Error("Argon2 settings fall outside supported secure bounds");
  const emailSettings = [env.EMAIL_PROVIDER, env.EMAIL_API_KEY, env.EMAIL_FROM];
  if (emailSettings.some(Boolean) && !emailSettings.every(Boolean))
    throw new Error(
      "Configure all three email settings or leave all three empty",
    );
  if (env.EMAIL_PROVIDER && env.EMAIL_PROVIDER !== "resend")
    throw new Error("The configured email provider is unsupported");
  return {
    origin: origin.origin,
    emailConfigured: emailSettings.every(Boolean),
  };
}

async function main() {
  const configuration = productionPreflight(process.env);
  if (process.argv.includes("--database-state")) {
    const sql = postgres(process.env.DATABASE_URL!, {
      max: 1,
      connect_timeout: 10,
    });
    try {
      const [row] =
        await sql`SELECT to_regclass('public.users') IS NOT NULL AS populated`;
      console.log(row.populated ? "existing" : "fresh");
    } finally {
      await sql.end();
    }
  } else {
    console.log(JSON.stringify({ ok: true, ...configuration }));
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error: unknown) => {
    // Configuration messages never contain values. Database errors stay private.
    console.error(
      error instanceof Error && !process.argv.includes("--database-state")
        ? error.message
        : "Production database preflight failed",
    );
    process.exitCode = 1;
  });
