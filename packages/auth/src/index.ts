import { randomUUID } from "node:crypto";
import { db, mapUser } from "@tell-aviv/database";
import { fail, usernamePattern } from "@tell-aviv/shared";
import { z } from "zod";
import { authConfig } from "./config";
import {
  addSession,
  authenticatedResponse,
  cookieHeader,
  getSession,
  hashToken,
  requireRecentAuthentication,
  sessionToken,
} from "./session";
import {
  bootstrapPassword,
  changeEmail,
  changePassword,
  generateRecoveryCodes,
  login,
  reauthenticate,
  register,
  requestPasswordReset,
  resetPassword,
  resetWithRecoveryCode,
  securityEvent,
  securitySummary,
  sendEmailVerification,
  verifyEmail,
} from "./credentials";
import { emailDeliveryConfigured } from "./email";
import { enforceAuthIdentityRate } from "./rateLimit";

export {
  cookieName,
  getSession,
  hashToken,
  requireRecentAuthentication,
} from "./session";
const response = (data: unknown) =>
  Response.json({ data }, { headers: { "Cache-Control": "no-store" } });

export async function handleAuth(
  path: string[],
  method: string,
  request: Request,
  input: Record<string, unknown>,
): Promise<Response | undefined> {
  if (path[0] !== "auth") return;
  const action = path.slice(1).join("/"),
    cfg = authConfig();
  if (action === "status" && method === "GET")
    return response({
      nativeAuthentication: true,
      developmentLogin: cfg.developmentLogin,
      emailDeliveryConfigured: emailDeliveryConfigured(),
    });
  if (method === "POST") {
    if (action === "register") return register(request, input);
    if (action === "login") return login(request, input);
    if (action === "reauthenticate")
      return response(await reauthenticate(request, input));
    if (action === "password")
      return response(await changePassword(request, input));
    if (action === "password/bootstrap")
      return bootstrapPassword(request, input);
    if (action === "forgot-password")
      return response(await requestPasswordReset(input));
    if (action === "reset-password")
      return response(await resetPassword(request, input));
    if (action === "recovery-codes/regenerate")
      return response(await generateRecoveryCodes(request, input));
    if (action === "recovery-codes/reset")
      return response(await resetWithRecoveryCode(input));
    if (action === "email") return response(await changeEmail(request, input));
    if (action === "email/send-verification")
      return response(await sendEmailVerification(request, input));
    if (action === "email/verify") return response(await verifyEmail(input));
  }
  if (action === "dev" && method === "POST") {
    if (!cfg.developmentLogin) fail(404, "Development login is disabled");
    const { username } = z
      .object({ username: z.string().regex(usernamePattern) })
      .strict()
      .parse(input);
    const result = await db.begin(async (sql) => {
      const [row] =
        await sql`INSERT INTO users(id,username,display_name,role,settings) VALUES(${randomUUID()},${username},${username},${username === process.env.DEV_ADMIN_USERNAME ? "owner" : "user"},${sql.json({ onboardingComplete: true })}) ON CONFLICT (lower(username)) DO UPDATE SET updated_at=now() RETURNING *`;
      const [credential] =
        await sql`SELECT user_id FROM user_credentials WHERE user_id=${row.id}`;
      if (row.disabled || row.google_sub || credential)
        fail(403, "This account cannot use development login");
      return {
        user: mapUser(row),
        token: await addSession(sql, row.id, request, "development"),
      };
    });
    return authenticatedResponse(result.user, result.token);
  }
  if ((action === "logout" || action === "logout-all") && method === "POST") {
    const user = await getSession(request);
    if (user)
      await db.begin(async (sql) => {
        const [existing] =
          await sql`SELECT id FROM users WHERE id=${user.id} FOR UPDATE`;
        if (!existing) return;
        const [current] =
          await sql`SELECT id FROM sessions WHERE user_id=${user.id} AND token_hash=${hashToken(sessionToken(request))} AND expires_at>now() FOR UPDATE`;
        if (!current) return;
        if (action === "logout-all") {
          await sql`DELETE FROM sessions WHERE user_id=${user.id}`;
          await securityEvent(sql, user.id, "sessions_revoked");
        } else
          await sql`DELETE FROM sessions WHERE user_id=${user.id} AND token_hash=${hashToken(sessionToken(request))}`;
      });
    return Response.json(
      { data: { ok: true } },
      {
        headers: {
          "Set-Cookie": cookieHeader("", 0),
          "Cache-Control": "no-store",
        },
      },
    );
  }
  const user = await getSession(request);
  if (!user) fail(401, "Sign in required");
  if (action === "username" && method === "POST") {
    const { username } = z
      .object({
        username: z
          .string()
          .max(100)
          .transform((value) => value.trim().toLowerCase())
          .pipe(z.string().regex(usernamePattern)),
      })
      .strict()
      .parse(input);
    const row = await db.begin(async (sql) => {
      const [current] =
        await sql`SELECT username,disabled FROM users WHERE id=${user.id} FOR UPDATE`;
      if (!current || current.disabled) fail(401, "Sign in required");
      await requireRecentAuthentication(request, user.id, sql);
      if (current.username !== username)
        await sql`INSERT INTO username_history VALUES(${randomUUID()},${user.id},${current.username},now())`;
      const [updated] =
        await sql`UPDATE users SET username=${username},settings=jsonb_set(settings,'{onboardingComplete}','true'),updated_at=now() WHERE id=${user.id} RETURNING *`;
      return updated;
    });
    return response(mapUser(row));
  }
  if (action === "security" && method === "GET")
    return response(await securitySummary(request, user));
  if (action === "sessions" && method === "GET")
    return response(
      await db`SELECT id,user_agent,created_at,expires_at,(token_hash=${hashToken(sessionToken(request))}) AS current FROM sessions WHERE user_id=${user.id} AND expires_at>now() ORDER BY created_at DESC,id DESC`,
    );
  if (
    (action === "sessions/revoke" || action === "logout-others") &&
    method === "POST"
  ) {
    const sessionId =
      action === "sessions/revoke"
        ? z.object({ sessionId: z.string().uuid() }).strict().parse(input)
            .sessionId
        : undefined;
    await enforceAuthIdentityRate(action, user.id);
    await db.begin(async (sql) => {
      await requireRecentAuthentication(request, user.id, sql);
      if (sessionId) {
        const [removed] =
          await sql`DELETE FROM sessions WHERE id=${sessionId} AND user_id=${user.id} RETURNING id`;
        if (!removed) fail(404, "Session not found");
      } else
        await sql`DELETE FROM sessions WHERE user_id=${user.id} AND token_hash<>${hashToken(sessionToken(request))}`;
      await securityEvent(
        sql,
        user.id,
        sessionId ? "session_revoked" : "sessions_revoked",
      );
    });
    const self = sessionId && !(await getSession(request));
    return Response.json(
      { data: { ok: true } },
      {
        headers: {
          "Cache-Control": "no-store",
          ...(self ? { "Set-Cookie": cookieHeader("", 0) } : {}),
        },
      },
    );
  }
  fail(404, "Unknown authentication endpoint");
}
