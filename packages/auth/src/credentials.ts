import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { db, mapUser } from "@tell-aviv/database";
import { fail, usernamePattern, type User } from "@tell-aviv/shared";
import { z } from "zod";
import {
  hashPassword,
  passwordChangeSchema,
  passwordSchema,
  verifyPassword,
} from "./password";
import { authConfig } from "./config";
import {
  addSession,
  authenticatedResponse,
  cookieHeader,
  getSession,
  hashToken,
  requireRecentAuthentication,
  sessionToken,
  type AuthSql,
} from "./session";
import {
  emailDeliveryConfigured,
  sendPasswordReset,
  sendEmailVerification as deliverVerification,
  recoveryResponseMilliseconds,
} from "./email";
import { enforceAuthIdentityRate } from "./rateLimit";

const username = z
  .string()
  .max(100)
  .transform((value) => value.trim().toLowerCase())
  .pipe(
    z
      .string()
      .regex(usernamePattern, "Use 3–24 letters, numbers or underscores"),
  );
const email = z
  .string()
  .trim()
  .max(254)
  .email("Use a valid email address")
  .transform((value) => value.toLowerCase());
const passwordProof = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 512);
const identityInput = z
  .object({
    username: z
      .string()
      .min(1)
      .max(100)
      .transform((value) => value.trim().toLowerCase()),
  })
  .strict();
const registration = z
  .object({
    username,
    password: passwordSchema,
    passwordConfirmation: z.string().max(128),
    email: email.optional(),
  })
  .strict()
  .refine((value) => value.password === value.passwordConfirmation, {
    message: "Passwords do not match",
    path: ["passwordConfirmation"],
  });
const passwordInput = z
  .object({
    currentPassword: passwordProof,
    newPassword: passwordSchema,
    passwordConfirmation: z.string().max(128),
    revokeOtherSessions: z.boolean().default(true),
  })
  .strict()
  .refine((value) => value.newPassword === value.passwordConfirmation, {
    message: "Passwords do not match",
    path: ["passwordConfirmation"],
  });
const resetInput = z
  .object({
    token: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{43}$/, "Invalid or expired recovery link"),
    newPassword: passwordSchema,
    passwordConfirmation: z.string().max(128),
  })
  .strict()
  .refine((value) => value.newPassword === value.passwordConfirmation, {
    message: "Passwords do not match",
    path: ["passwordConfirmation"],
  });
const invalidLogin = () => fail(401, "Username or password is incorrect");
const invalidRecovery = () =>
  fail(400, "Invalid or expired recovery credential");

export async function securityEvent(
  sql: AuthSql,
  userId: string,
  kind: string,
) {
  await sql`INSERT INTO account_security_events(id,user_id,kind) VALUES(${randomUUID()},${userId},${kind})`;
  await sql`DELETE FROM account_security_events WHERE user_id=${userId} AND id NOT IN (SELECT id FROM account_security_events WHERE user_id=${userId} ORDER BY created_at DESC,id DESC LIMIT 100)`;
}
async function currentUser(request: Request) {
  const user = await getSession(request);
  if (!user) fail(401, "Sign in required");
  return user;
}
async function credentialProof(userId: string, password: string) {
  const [credential] =
    await db`SELECT c.password_hash,c.version FROM user_credentials c JOIN users u ON u.id=c.user_id WHERE c.user_id=${userId} AND u.disabled=false`;
  const valid = await verifyPassword(password, credential?.password_hash);
  if (!valid || !credential) fail(401, "Password is incorrect");
  return credential;
}
async function lockCredential(
  sql: AuthSql,
  userId: string,
  expectedHash?: string,
  unavailable: () => never = () => fail(401, "Sign in required"),
) {
  const [user] = await sql`SELECT * FROM users WHERE id=${userId} FOR UPDATE`;
  if (!user || user.disabled) unavailable();
  const [credential] =
    await sql`SELECT password_hash,version FROM user_credentials WHERE user_id=${userId} FOR UPDATE`;
  if (expectedHash && credential?.password_hash !== expectedHash)
    fail(409, "Password changed; try again");
  return { user, credential };
}
async function lockSession(sql: AuthSql, userId: string, request: Request) {
  const [session] =
    await sql`SELECT id,authentication_method FROM sessions WHERE user_id=${userId} AND token_hash=${hashToken(sessionToken(request))} AND expires_at>now() FOR UPDATE`;
  if (!session) fail(401, "Sign in required");
  return session;
}
async function invalidateRecovery(sql: AuthSql, userId: string) {
  await sql`DELETE FROM password_reset_tokens WHERE user_id=${userId}`;
  await sql`DELETE FROM account_recovery_codes WHERE user_id=${userId}`;
  await sql`DELETE FROM email_verification_tokens WHERE user_id=${userId}`;
}
async function replacePassword(
  sql: AuthSql,
  userId: string,
  passwordHash: string,
) {
  const [credential] =
    await sql`UPDATE user_credentials SET password_hash=${passwordHash},version=version+1,changed_at=now() WHERE user_id=${userId} RETURNING version`;
  if (!credential) invalidRecovery();
  await invalidateRecovery(sql, userId);
  return Number(credential.version);
}

export async function register(
  request: Request,
  input: Record<string, unknown>,
) {
  const value = registration.parse(input);
  await enforceAuthIdentityRate("register", value.username);
  const passwordHash = await hashPassword(value.password);
  const result = await db.begin(async (sql) => {
    const id = randomUUID();
    let row;
    try {
      [row] =
        await sql`INSERT INTO users(id,username,display_name,email,settings) VALUES(${id},${value.username},${value.username},${value.email ?? null},${sql.json({ onboardingComplete: true })}) RETURNING *`;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      )
        fail(409, "Username is already taken");
      throw error;
    }
    await sql`INSERT INTO user_credentials(user_id,password_hash) VALUES(${id},${passwordHash})`;
    await securityEvent(sql, id, "registered");
    return {
      user: mapUser(row),
      token: await addSession(sql, id, request, "password", 1),
    };
  });
  return authenticatedResponse(result.user, result.token);
}
export async function login(request: Request, input: Record<string, unknown>) {
  const value = z
    .object({
      username: z
        .string()
        .min(1)
        .max(100)
        .transform((name) => name.trim().toLowerCase()),
      password: passwordProof,
    })
    .strict()
    .parse(input);
  await enforceAuthIdentityRate("login", value.username);
  const [candidate] =
    await db`SELECT u.id,u.disabled,c.password_hash,c.version FROM users u LEFT JOIN user_credentials c ON c.user_id=u.id WHERE lower(u.username)=${value.username}`;
  if (
    !(await verifyPassword(value.password, candidate?.password_hash)) ||
    !candidate ||
    candidate.disabled
  )
    invalidLogin();
  const result = await db.begin(async (sql) => {
    const { user, credential } = await lockCredential(
      sql,
      candidate.id,
      undefined,
      invalidLogin,
    );
    if (!credential || credential.password_hash !== candidate.password_hash)
      invalidLogin();
    await securityEvent(sql, user.id, "login");
    return {
      user: mapUser(user),
      token: await addSession(
        sql,
        user.id,
        request,
        "password",
        Number(credential.version),
      ),
    };
  });
  return authenticatedResponse(result.user, result.token);
}
export async function reauthenticate(
  request: Request,
  input: Record<string, unknown>,
) {
  const { password } = z
      .object({ password: passwordProof })
      .strict()
      .parse(input),
    user = await currentUser(request);
  await enforceAuthIdentityRate("reauthenticate", user.id);
  const proof = await credentialProof(user.id, password);
  await db.begin(async (sql) => {
    const { credential } = await lockCredential(
      sql,
      user.id,
      proof.password_hash,
    );
    const session = await lockSession(sql, user.id, request);
    await sql`UPDATE sessions SET authentication_method='password',authenticated_at=now(),credential_version=${Number(credential.version)} WHERE id=${session.id}`;
    await securityEvent(sql, user.id, "reauthenticated");
  });
  return { ok: true };
}
export async function changePassword(
  request: Request,
  input: Record<string, unknown>,
) {
  const value = passwordInput.parse(input),
    user = await currentUser(request);
  await enforceAuthIdentityRate("password", user.id);
  const proof = await credentialProof(user.id, value.currentPassword),
    passwordHash = await hashPassword(value.newPassword);
  await db.begin(async (sql) => {
    await lockCredential(sql, user.id, proof.password_hash);
    const sessionId = await requireRecentAuthentication(request, user.id, sql);
    const version = await replacePassword(sql, user.id, passwordHash);
    if (value.revokeOtherSessions)
      await sql`DELETE FROM sessions WHERE user_id=${user.id} AND id<>${sessionId}`;
    else
      await sql`UPDATE sessions SET authenticated_at=NULL,credential_version=NULL WHERE user_id=${user.id} AND id<>${sessionId}`;
    await sql`UPDATE sessions SET authentication_method='password',authenticated_at=now(),credential_version=${version} WHERE id=${sessionId}`;
    await securityEvent(sql, user.id, "password_changed");
  });
  return { ok: true, otherSessionsRevoked: value.revokeOtherSessions };
}
export async function bootstrapPassword(
  request: Request,
  input: Record<string, unknown>,
) {
  if (!authConfig().developmentLogin)
    fail(404, "Development password bootstrap is disabled");
  const value = passwordChangeSchema.parse(input),
    user = await currentUser(request);
  await enforceAuthIdentityRate("password-bootstrap", user.id);
  const passwordHash = await hashPassword(value.newPassword);
  const token = await db.begin(async (sql) => {
    const { credential } = await lockCredential(sql, user.id);
    const session = await lockSession(sql, user.id, request);
    if (credential || session.authentication_method !== "development")
      fail(403, "Development bootstrap is unavailable for this account");
    await sql`INSERT INTO user_credentials(user_id,password_hash) VALUES(${user.id},${passwordHash})`;
    await sql`DELETE FROM sessions WHERE user_id=${user.id}`;
    await securityEvent(sql, user.id, "development_bootstrap");
    return addSession(sql, user.id, request, "password", 1);
  });
  return Response.json(
    { data: { ok: true } },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": cookieHeader(token, authConfig().sessionSeconds),
      },
    },
  );
}
export async function requestPasswordReset(input: Record<string, unknown>) {
  const value = identityInput.parse(input);
  await enforceAuthIdentityRate("forgot-password", value.username);
  const responseStarted = performance.now();
  const pending = await db.begin(async (sql) => {
    const [user] =
      await sql`SELECT u.id,u.email,u.email_verified_at,u.disabled,c.version FROM users u LEFT JOIN user_credentials c ON c.user_id=u.id WHERE lower(u.username)=${value.username} FOR UPDATE OF u`;
    if (
      !user ||
      user.disabled ||
      !user.version ||
      !user.email ||
      !user.email_verified_at ||
      !emailDeliveryConfigured()
    )
      return null;
    const token = randomBytes(32).toString("base64url");
    await sql`DELETE FROM password_reset_tokens WHERE user_id=${user.id}`;
    const [row] =
      await sql`INSERT INTO password_reset_tokens(token_hash,user_id,credential_version,expires_at) VALUES(${hashToken(token)},${user.id},${Number(user.version)},now()+interval '20 minutes') RETURNING expires_at`;
    await securityEvent(sql, user.id, "recovery_requested");
    const url = new URL("/", authConfig().appUrl);
    url.hash = new URLSearchParams({ resetToken: token }).toString();
    return {
      userId: user.id,
      message: {
        to: user.email as string,
        resetUrl: url.toString(),
        expiresAt: new Date(row.expires_at).toISOString(),
      },
    };
  });
  if (pending) {
    try {
      await sendPasswordReset(pending.message);
    } catch {
      // Delivery failure is private operational evidence; public recovery remains enumeration-neutral.
      await db.begin(async (sql) => {
        const [user] =
          await sql`SELECT id FROM users WHERE id=${pending.userId} FOR UPDATE`;
        if (user)
          await securityEvent(sql, pending.userId, "recovery_delivery_failed");
      });
    }
  }
  await delay(
    Math.max(
      0,
      recoveryResponseMilliseconds - (performance.now() - responseStarted),
    ),
  );
  return { ok: true };
}
export async function resetPassword(
  request: Request,
  input: Record<string, unknown>,
) {
  const value = resetInput.parse(input);
  const [pending] =
    await db`SELECT user_id FROM password_reset_tokens WHERE token_hash=${hashToken(value.token)} AND expires_at>now()`;
  await enforceAuthIdentityRate(
    "reset-password",
    pending?.user_id ?? hashToken(value.token),
  );
  const passwordHash = await hashPassword(value.newPassword);
  if (!pending) invalidRecovery();
  await db.begin(async (sql) => {
    const { credential } = await lockCredential(
      sql,
      pending.user_id,
      undefined,
      invalidRecovery,
    );
    const [token] =
      await sql`SELECT credential_version FROM password_reset_tokens WHERE token_hash=${hashToken(value.token)} AND user_id=${pending.user_id} AND expires_at>now() FOR UPDATE`;
    if (
      !token ||
      !credential ||
      Number(token.credential_version) !== Number(credential.version)
    )
      invalidRecovery();
    await replacePassword(sql, pending.user_id, passwordHash);
    await sql`DELETE FROM sessions WHERE user_id=${pending.user_id}`;
    await securityEvent(sql, pending.user_id, "password_reset");
  });
  return { ok: true };
}
const normalizeRecoveryCode = (code: string) =>
  code.replace(/-/g, "").toLowerCase();
const recoveryDigest = (userId: string, code: string) =>
  hashToken(`tell-aviv:recovery-code:${userId}:${normalizeRecoveryCode(code)}`);
export async function generateRecoveryCodes(
  request: Request,
  input: Record<string, unknown>,
) {
  const { password } = z
      .object({ password: passwordProof })
      .strict()
      .parse(input),
    user = await currentUser(request);
  await enforceAuthIdentityRate("recovery-codes-regenerate", user.id);
  const proof = await credentialProof(user.id, password);
  const codes = Array.from({ length: 8 }, () =>
    randomBytes(16).toString("hex").match(/.{8}/g)!.join("-"),
  );
  await db.begin(async (sql) => {
    const { credential } = await lockCredential(
      sql,
      user.id,
      proof.password_hash,
    );
    await requireRecentAuthentication(request, user.id, sql);
    await sql`DELETE FROM account_recovery_codes WHERE user_id=${user.id}`;
    for (const code of codes)
      await sql`INSERT INTO account_recovery_codes(id,user_id,code_hash,credential_version) VALUES(${randomUUID()},${user.id},${recoveryDigest(user.id, code)},${Number(credential.version)})`;
    await securityEvent(sql, user.id, "recovery_codes_generated");
  });
  return { codes };
}
export async function resetWithRecoveryCode(input: Record<string, unknown>) {
  const value = z
    .object({
      username: z
        .string()
        .min(1)
        .max(100)
        .transform((name) => name.trim().toLowerCase()),
      code: z.string().max(64),
      newPassword: passwordSchema,
      passwordConfirmation: z.string().max(128),
    })
    .strict()
    .refine((item) => item.newPassword === item.passwordConfirmation, {
      message: "Passwords do not match",
      path: ["passwordConfirmation"],
    })
    .parse(input);
  await enforceAuthIdentityRate("recovery-codes-reset", value.username);
  const passwordHash = await hashPassword(value.newPassword);
  const [candidate] =
    await db`SELECT id FROM users WHERE lower(username)=${value.username} AND disabled=false`;
  if (!candidate) invalidRecovery();
  await db.begin(async (sql) => {
    const { credential } = await lockCredential(
      sql,
      candidate.id,
      undefined,
      invalidRecovery,
    );
    const [code] =
      await sql`SELECT id,credential_version FROM account_recovery_codes WHERE user_id=${candidate.id} AND code_hash=${recoveryDigest(candidate.id, value.code)} FOR UPDATE`;
    if (
      !code ||
      !credential ||
      Number(code.credential_version) !== Number(credential.version)
    )
      invalidRecovery();
    await replacePassword(sql, candidate.id, passwordHash);
    await sql`DELETE FROM sessions WHERE user_id=${candidate.id}`;
    await securityEvent(sql, candidate.id, "recovery_code_used");
  });
  return { ok: true };
}
export async function securitySummary(request: Request, user: User) {
  const [row] =
    await db`SELECT c.user_id,c.version,u.email,u.email_verified_at,s.authentication_method,s.credential_version,
    (s.authenticated_at>now()-interval '10 minutes') AS recent
    FROM users u JOIN sessions s ON s.user_id=u.id LEFT JOIN user_credentials c ON c.user_id=u.id
    WHERE u.id=${user.id} AND s.token_hash=${hashToken(sessionToken(request))} AND s.expires_at>now() AND u.disabled=false`;
  if (!row) fail(401, "Sign in required");
  const [{ count }] =
    await db`SELECT count(*)::int AS count FROM account_recovery_codes WHERE user_id=${user.id}`;
  return {
    credentialConfigured: Boolean(row.user_id),
    email: row.email ?? null,
    emailVerified: Boolean(row.email_verified_at),
    emailDeliveryConfigured: emailDeliveryConfigured(),
    developmentBootstrap:
      authConfig().developmentLogin &&
      !row.user_id &&
      row.authentication_method === "development",
    recentlyAuthenticated: Boolean(
      row.recent &&
      (row.authentication_method === "password"
        ? Number(row.version) === Number(row.credential_version)
        : authConfig().developmentLogin &&
          !row.user_id &&
          row.authentication_method === "development"),
    ),
    recoveryCodesRemaining: count,
    events:
      await db`SELECT id,kind,created_at FROM account_security_events WHERE user_id=${user.id} ORDER BY created_at DESC,id DESC LIMIT 25`,
  };
}
export async function changeEmail(
  request: Request,
  input: Record<string, unknown>,
) {
  const value = z.object({ email: email.nullable() }).strict().parse(input),
    user = await currentUser(request);
  await enforceAuthIdentityRate("email", user.id);
  await db.begin(async (sql) => {
    await requireRecentAuthentication(request, user.id, sql);
    await sql`UPDATE users SET email=${value.email},email_verified_at=NULL,updated_at=now() WHERE id=${user.id}`;
    await invalidateRecovery(sql, user.id);
    await securityEvent(sql, user.id, "email_changed");
  });
  return { ok: true };
}
export async function sendEmailVerification(
  request: Request,
  input: Record<string, unknown>,
) {
  z.object({}).strict().parse(input);
  const user = await currentUser(request);
  await enforceAuthIdentityRate("email/send-verification", user.id);
  if (!emailDeliveryConfigured())
    fail(503, "Email delivery is not configured; use recovery codes");
  const message = await db.begin(async (sql) => {
    await requireRecentAuthentication(request, user.id, sql);
    const [current] =
      await sql`SELECT u.email,u.email_verified_at,c.version FROM users u JOIN user_credentials c ON c.user_id=u.id WHERE u.id=${user.id}`;
    if (!current?.email) fail(400, "Add a private email address first");
    if (current.email_verified_at) fail(409, "Email is already verified");
    const token = randomBytes(32).toString("base64url");
    await sql`DELETE FROM email_verification_tokens WHERE user_id=${user.id}`;
    const [row] =
      await sql`INSERT INTO email_verification_tokens(token_hash,user_id,email,credential_version,expires_at) VALUES(${hashToken(token)},${user.id},${current.email},${Number(current.version)},now()+interval '20 minutes') RETURNING expires_at`;
    const url = new URL("/", authConfig().appUrl);
    url.hash = new URLSearchParams({ verifyEmailToken: token }).toString();
    return {
      to: current.email as string,
      verificationUrl: url.toString(),
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  });
  try {
    await deliverVerification(message);
  } catch {
    fail(503, "Email delivery failed; try again later");
  }
  return { ok: true };
}
export async function verifyEmail(input: Record<string, unknown>) {
  const { token } = z
    .object({
      token: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{43}$/, "Invalid or expired verification link"),
    })
    .strict()
    .parse(input);
  const digest = hashToken(token);
  const [candidate] =
    await db`SELECT user_id FROM email_verification_tokens WHERE token_hash=${digest} AND expires_at>now()`;
  await enforceAuthIdentityRate("email/verify", candidate?.user_id ?? digest);
  if (!candidate) fail(400, "Invalid or expired verification link");
  await db.begin(async (sql) => {
    const { user, credential } = await lockCredential(
      sql,
      candidate.user_id,
      undefined,
      () => fail(400, "Invalid or expired verification link"),
    );
    const [record] =
      await sql`SELECT email,credential_version FROM email_verification_tokens WHERE token_hash=${digest} AND user_id=${candidate.user_id} AND expires_at>now() FOR UPDATE`;
    if (
      !record ||
      !credential ||
      record.email !== user.email ||
      Number(record.credential_version) !== Number(credential.version)
    )
      fail(400, "Invalid or expired verification link");
    await sql`UPDATE users SET email_verified_at=now(),updated_at=now() WHERE id=${user.id}`;
    await sql`DELETE FROM email_verification_tokens WHERE user_id=${user.id}`;
    await securityEvent(sql, user.id, "email_verified");
  });
  return { ok: true };
}
