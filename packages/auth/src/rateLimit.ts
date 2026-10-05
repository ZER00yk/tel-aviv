import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { db } from "@tell-aviv/database";
import { fail } from "@tell-aviv/shared";

interface AuthRateBudget {
  max: number;
  seconds: number;
}

const identityBudgets: Record<string, AuthRateBudget> = {
  login: { max: 8, seconds: 900 },
  register: { max: 3, seconds: 3600 },
  "forgot-password": { max: 5, seconds: 3600 },
  "reset-password": { max: 5, seconds: 900 },
  "recovery-codes-reset": { max: 5, seconds: 900 },
  reauthenticate: { max: 8, seconds: 900 },
  password: { max: 5, seconds: 900 },
  "recovery-codes-regenerate": { max: 3, seconds: 3600 },
  email: { max: 3, seconds: 3600 },
  "email-send-verification": { max: 3, seconds: 3600 },
  "email-verify": { max: 8, seconds: 900 },
  "sessions-revoke": { max: 5, seconds: 900 },
  "logout-others": { max: 5, seconds: 900 },
  "password-bootstrap": { max: 3, seconds: 3600 },
};

function canonicalAction(action: string) {
  const aliases: Record<string, string> = {
    "recovery-codes/reset": "recovery-codes-reset",
    "recovery-codes/regenerate": "recovery-codes-regenerate",
    "email/send-verification": "email-send-verification",
    "email/verify": "email-verify",
    "sessions/revoke": "sessions-revoke",
    "password/bootstrap": "password-bootstrap",
  };
  return Object.hasOwn(aliases, action) ? aliases[action] : action;
}

function identityBudget(action: string) {
  return Object.hasOwn(identityBudgets, action)
    ? identityBudgets[action]
    : undefined;
}

/** Only a proxy that overwrites both attestation headers can vouch for a source.
 * Request has no verified peer address. Forwarded/X-Forwarded-For are deliberately
 * ignored, including when they accompany a valid attestation.
 */
export function trustedAuthSource(request: Request): string | undefined {
  const secret = process.env.AUTH_TRUSTED_PROXY_SECRET;
  const supplied = request.headers.get("x-tell-aviv-proxy-secret");
  if (
    !secret ||
    Buffer.byteLength(secret) < 32 ||
    Buffer.byteLength(secret) > 256 ||
    !supplied ||
    Buffer.byteLength(supplied) > 512
  )
    return;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(secret), digest(supplied))) return;
  const value = request.headers.get("x-tell-aviv-client-ip");
  if (!value || value.length > 45 || /[\s,%[\]\/\\]/.test(value)) return;
  const version = isIP(value);
  if (version === 4) return value;
  if (version !== 6) return;
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  // A socket may report IPv4 as an IPv4-mapped IPv6 address. Keep one budget.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (mapped) {
    const high = parseInt(mapped[1], 16),
      low = parseInt(mapped[2], 16);
    return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
  }
  return normalized;
}

/** Login identifiers already pass the native credential schema before use.
 * UUID identifiers for authenticated changes use the same bounded key handling.
 */
export function normalizeAuthRateIdentity(identity: string): string {
  const normalized = identity.normalize("NFC").trim().toLowerCase();
  if (!normalized || Buffer.byteLength(normalized) > 320)
    fail(400, "Invalid account identifier");
  return normalized;
}

export function authRateScopeHash(
  kind: "global" | "source" | "identity",
  value: string,
) {
  // Vitest can exercise the real global boundary without changing a running
  // developer server's quotas. Production ignores this test-only setting.
  let namespace = "";
  if (
    process.env.NODE_ENV === "test" &&
    process.env.AUTH_RATE_NAMESPACE !== undefined
  ) {
    if (!/^[a-z0-9_-]{1,64}$/.test(process.env.AUTH_RATE_NAMESPACE))
      throw new Error("Invalid authentication test rate namespace");
    namespace = `test:${process.env.AUTH_RATE_NAMESPACE}:`;
  }
  return createHash("sha256")
    .update(`tell-aviv-auth-rate-v1:${namespace}${kind}:`)
    .update(value)
    .digest("hex");
}

/** Independent autocommit statement: failed credential verification and rolled
 * back account work still consume quota. A denied attempt neither grows the
 * saturated counter nor moves its expiration. No account FK or raw identifiers.
 */
export async function consumeAuthRateLimit(
  scopeHash: string,
  bucket: string,
  max: number,
  seconds: number,
): Promise<number> {
  if (
    !/^[0-9a-f]{64}$/.test(scopeHash) ||
    !/^[a-zA-Z0-9:_-]{1,80}$/.test(bucket) ||
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 10000 ||
    !Number.isSafeInteger(seconds) ||
    seconds < 1 ||
    seconds > 3600
  )
    throw new Error("Invalid internal authentication rate bucket");
  const accepted = await db`
    WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS observed_at)
    INSERT INTO auth_request_windows(scope_hash,bucket,window_start,expires_at,count)
    SELECT ${scopeHash},${bucket},observed_at,
      observed_at+make_interval(secs=>${seconds + 3600}),1 FROM moment
    ON CONFLICT(scope_hash,bucket) DO UPDATE SET
      window_start=CASE WHEN auth_request_windows.window_start <= (SELECT observed_at FROM moment)-make_interval(secs=>${seconds})
        THEN (SELECT observed_at FROM moment) ELSE auth_request_windows.window_start END,
      expires_at=CASE WHEN auth_request_windows.window_start <= (SELECT observed_at FROM moment)-make_interval(secs=>${seconds})
        THEN (SELECT observed_at FROM moment)+make_interval(secs=>${seconds + 3600}) ELSE auth_request_windows.expires_at END,
      count=CASE WHEN auth_request_windows.window_start <= (SELECT observed_at FROM moment)-make_interval(secs=>${seconds})
        THEN 1 ELSE auth_request_windows.count+1 END
    WHERE auth_request_windows.window_start <= (SELECT observed_at FROM moment)-make_interval(secs=>${seconds})
      OR auth_request_windows.count < ${max}
    RETURNING count`;
  if (!accepted.length)
    fail(
      429,
      "Too many sign-in requests. Try again after this request window expires.",
    );
  return Number(accepted[0].count);
}

/** At most 500 expired rows per new global window; no scan of live identities.
 * The shared 120/minute transport budget permits at most 240 new source/identity
 * rows per minute, while retention is at most two hours from window creation.
 */
export async function pruneAuthRateWindows() {
  const deleted = await db`
    DELETE FROM auth_request_windows WHERE expires_at<clock_timestamp() AND (scope_hash,bucket) IN (
      SELECT scope_hash,bucket FROM auth_request_windows
      WHERE expires_at<clock_timestamp()
      ORDER BY expires_at LIMIT 500
    ) RETURNING scope_hash`;
  return deleted.length;
}

/** Invoke before reading JSON, validating schemas or computing password hashes.
 * With no authenticated proxy proof this still enforces the global quota;
 * normalized account budgets are enforced independently after schema validation.
 * Development fixture login and read-only status keep their separate paths.
 */
export async function enforceAuthTransportRate(
  request: Request,
  action: string,
) {
  if (request.method !== "POST" || !identityBudget(canonicalAction(action)))
    return;
  const count = await consumeAuthRateLimit(
    authRateScopeHash("global", "native"),
    "auth:transport",
    120,
    60,
  );
  if (count === 1) await pruneAuthRateWindows();
  const source = trustedAuthSource(request);
  if (source)
    await consumeAuthRateLimit(
      authRateScopeHash("source", source),
      "auth:transport",
      30,
      60,
    );
}

/** Invoke before credential verification and outside account transactions.
 * Missing accounts consume the identical normalized identity budget.
 */
export async function enforceAuthIdentityRate(
  action: string,
  identity: string,
) {
  const canonical = canonicalAction(action);
  const budget = identityBudget(canonical);
  if (!budget) throw new Error("Unknown native authentication rate action");
  await consumeAuthRateLimit(
    authRateScopeHash("identity", normalizeAuthRateIdentity(identity)),
    `auth:${canonical}`,
    budget.max,
    budget.seconds,
  );
}
