import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db, mapUser } from "@tell-aviv/database";
import { fail, type User } from "@tell-aviv/shared";
import { authConfig } from "./config";
import type { TransactionSql } from "postgres";

export type AuthSql = typeof db | TransactionSql;
export const cookieName = "ta_session";
export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function sessionToken(request: Request) {
  const values =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((value) => value.trim())
      .filter((value) => value.startsWith(`${cookieName}=`)) ?? [];
  // Ambiguous and malformed cookie values must never select a different session.
  if (values.length !== 1) return "";
  const token = values[0].slice(cookieName.length + 1);
  return /^[a-zA-Z0-9_-]{43}$/.test(token) ? token : "";
}
export function cookieHeader(value: string, seconds: number) {
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${authConfig().production ? "; Secure" : ""}`;
}
export async function getSession(request: Request): Promise<User | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const [row] =
    await db`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=${hashToken(token)} AND s.expires_at>now() AND u.disabled=false`;
  return row ? mapUser(row) : null;
}
export async function addSession(
  sql: AuthSql,
  userId: string,
  request: Request,
  method: "development" | "password",
  credentialVersion?: number,
) {
  const token = randomBytes(32).toString("base64url");
  await sql`INSERT INTO sessions (id,token_hash,user_id,user_agent,expires_at,authentication_method,authenticated_at,credential_version) VALUES (${randomUUID()},${hashToken(token)},${userId},${(request.headers.get("user-agent") ?? "").slice(0, 300)},now()+interval '30 days',${method},now(),${credentialVersion ?? null})`;
  // Replace the presented session on login: a caller cannot fix a browser's identity to an old token.
  const previous = sessionToken(request);
  if (previous)
    await sql`DELETE FROM sessions WHERE token_hash=${hashToken(previous)}`;
  return token;
}
export function authenticatedResponse(user: User, token: string) {
  return Response.json(
    { data: user },
    {
      headers: {
        "Set-Cookie": cookieHeader(token, authConfig().sessionSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}
/** Pass the caller's transaction to hold the user/session locks through its sensitive mutation. */
export async function requireRecentAuthentication(
  request: Request,
  userId: string,
  sql: AuthSql = db,
) {
  const token = sessionToken(request);
  if (!token) fail(401, "Sign in required");
  const [user] =
    await sql`SELECT id,disabled FROM users WHERE id=${userId} FOR UPDATE`;
  if (!user || user.disabled) fail(401, "Sign in required");
  const [session] =
    await sql`SELECT s.id,s.authentication_method,s.authenticated_at,s.credential_version,c.version,
    (s.authenticated_at>now()-interval '10 minutes') AS recent
    FROM sessions s LEFT JOIN user_credentials c ON c.user_id=s.user_id
    WHERE s.token_hash=${hashToken(token)} AND s.user_id=${userId} AND s.expires_at>now() FOR UPDATE OF s`;
  if (!session) fail(401, "Sign in required");
  const native =
    session.authentication_method === "password" &&
    Number(session.credential_version) === Number(session.version);
  const development =
    session.authentication_method === "development" &&
    authConfig().developmentLogin &&
    !session.version;
  if (!session.recent || (!native && !development))
    fail(403, "Reauthenticate to continue");
  return session.id as string;
}
