import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@tell-aviv/database";
import { GET, POST } from "../apps/web/app/api/[...path]/route";
import { hashToken } from "../packages/auth/src/session";
import {
  authRateScopeHash,
  normalizeAuthRateIdentity,
} from "../packages/auth/src/rateLimit";

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "native authentication protection through the actual API dispatcher",
  () => {
    const origin = new URL(process.env.APP_URL ?? "http://localhost:3000")
      .origin;
    const password = "native API fixture password 93!";
    const hashes = new Set<string>();
    const users = new Set<string>();
    let priorNamespace: string | undefined;
    let globalHash: string;
    const identity = (name: string) => {
      hashes.add(
        authRateScopeHash("identity", normalizeAuthRateIdentity(name)),
      );
      return name;
    };
    const mutation = (
      action: string,
      body: string,
      headers: Record<string, string> = {},
    ) =>
      POST(
        new Request(`${origin}/api/auth/${action}`, {
          method: "POST",
          headers: { origin, "content-type": "application/json", ...headers },
          body,
        }),
        { params: Promise.resolve({ path: ["auth", ...action.split("/")] }) },
      );
    const me = (cookie: string) =>
      GET(
        new Request(`${origin}/api/me`, {
          headers: { cookie },
        }),
        { params: Promise.resolve({ path: ["me"] }) },
      );
    const globalCount = async () =>
      Number(
        (
          await db`
      SELECT count FROM auth_request_windows WHERE scope_hash=${globalHash}
      AND bucket='auth:transport'`
        )[0]?.count ?? 0,
      );
    beforeEach(() => {
      priorNamespace = process.env.AUTH_RATE_NAMESPACE;
      process.env.AUTH_RATE_NAMESPACE = `security-api-${randomUUID()}`;
      globalHash = authRateScopeHash("global", "native");
      hashes.add(globalHash);
    });
    afterEach(async () => {
      if (users.size) await db`DELETE FROM users WHERE id IN ${db([...users])}`;
      if (hashes.size)
        await db`DELETE FROM auth_request_windows WHERE scope_hash IN ${db([...hashes])}`;
      hashes.clear();
      users.clear();
      if (priorNamespace === undefined) delete process.env.AUTH_RATE_NAMESPACE;
      else process.env.AUTH_RATE_NAMESPACE = priorNamespace;
    });
    it("rejects malformed JSON, object shape, MIME and oversized auth bodies before credential work while charging transport", async () => {
      for (const body of ["{", "[]", "null", '"string"']) {
        const response = await mutation("register", body);
        expect(response.status).toBe(400);
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
      expect(
        (await mutation("register", "{}", { "content-type": "text/plain" }))
          .status,
      ).toBe(415);
      expect(
        (await mutation("register", "{}", { "content-length": "16385" }))
          .status,
      ).toBe(413);
      expect(
        (
          await mutation(
            "login",
            JSON.stringify({ padding: "x".repeat(16_385) }),
          )
        ).status,
      ).toBe(413);
      expect(await globalCount()).toBe(7);
    });
    it("blocks absent, null and foreign origins and does not consume the password verifier budget", async () => {
      const username = identity(`csrf_${randomUUID().slice(0, 8)}`);
      const body = JSON.stringify({
        username,
        password,
        passwordConfirmation: password,
      });
      expect(
        (
          await mutation("register", body, {
            origin: "https://attacker.example",
          })
        ).status,
      ).toBe(403);
      expect(
        (await mutation("register", body, { origin: "null" })).status,
      ).toBe(403);
      const response = await POST(
        new Request(`${origin}/api/auth/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
        { params: Promise.resolve({ path: ["auth", "register"] }) },
      );
      expect(response.status).toBe(403);
      expect(await globalCount()).toBe(0);
      expect(
        await db`SELECT id FROM users WHERE username=${username}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT count FROM auth_request_windows WHERE scope_hash=${authRateScopeHash("identity", username)}`,
      ).toHaveLength(0);
    });
    it("returns a structured 429 before JSON parsing after a saturated anonymous budget regardless of forged identity headers", async () => {
      await db`INSERT INTO auth_request_windows(scope_hash,bucket,window_start,expires_at,count)
        VALUES(${globalHash},'auth:transport',clock_timestamp(),clock_timestamp()+interval '61 minutes',120)`;
      const response = await mutation("login", "{", {
        "x-forwarded-for": "198.51.100.9",
        "x-tell-aviv-client-ip": "203.0.113.9",
        "x-tell-aviv-proxy-secret": "forged",
        "x-tell-aviv-rate-namespace": randomUUID(),
      });
      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({
        code: "rate_limited",
        correlationId: expect.any(String),
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await globalCount()).toBe(120);
    });
    it("rotates a presented session at real login, rejects the old token and ambiguous cookies, and excludes credentials from the response", async () => {
      const username = identity(`fixation_${randomUUID().slice(0, 8)}`);
      const fixedToken = randomBytes(32).toString("base64url");
      const registered = await mutation(
        "register",
        JSON.stringify({ username, password, passwordConfirmation: password }),
        {
          cookie: `ta_session=${fixedToken}`,
        },
      );
      expect(registered.status).toBe(200);
      const { data: user } = await registered.json();
      users.add(user.id);
      identity(user.id);
      expect(user).not.toHaveProperty("password_hash");
      expect(user).not.toHaveProperty("passwordHash");
      expect(user).not.toHaveProperty("email");
      const firstCookie = registered.headers.get("set-cookie")!.split(";")[0];
      expect(firstCookie).not.toBe(`ta_session=${fixedToken}`);
      expect(registered.headers.get("set-cookie")).toContain(
        "HttpOnly; SameSite=Lax",
      );
      expect((await me(firstCookie)).status).toBe(200);
      const loggedIn = await mutation(
        "login",
        JSON.stringify({ username, password }),
        { cookie: firstCookie },
      );
      expect(loggedIn.status).toBe(200);
      const secondCookie = loggedIn.headers.get("set-cookie")!.split(";")[0];
      expect(secondCookie).not.toBe(firstCookie);
      expect((await me(firstCookie)).status).toBe(401);
      expect((await me(secondCookie)).status).toBe(200);
      expect((await me(`${secondCookie}; ${firstCookie}`)).status).toBe(401);
      expect((await me(`${secondCookie}; ta_session=%00`)).status).toBe(401);
      const stored =
        await db`SELECT token_hash FROM sessions WHERE user_id=${user.id}`;
      expect(stored).toEqual([
        { token_hash: hashToken(secondCookie.slice("ta_session=".length)) },
      ]);
      expect(JSON.stringify(stored)).not.toContain(
        secondCookie.slice("ta_session=".length),
      );
    });
    it("applies the same account quota to absent-user failures across casing and forged IP changes", async () => {
      const username = identity(`absent_api_${randomUUID().slice(0, 8)}`);
      for (let i = 0; i < 8; i++) {
        const response = await mutation(
          "login",
          JSON.stringify({
            username: i % 2 ? ` ${username.toUpperCase()} ` : username,
            password,
          }),
          { "x-forwarded-for": `198.51.100.${i + 1}` },
        );
        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({
          error: "Username or password is incorrect",
        });
      }
      const saturated = await mutation(
        "login",
        JSON.stringify({ username, password }),
        {
          "x-tell-aviv-client-ip": "203.0.113.25",
          "x-tell-aviv-proxy-secret": "forged",
        },
      );
      expect(saturated.status).toBe(429);
      const [row] =
        await db`SELECT count FROM auth_request_windows WHERE scope_hash=${authRateScopeHash("identity", username)} AND bucket='auth:login'`;
      expect(row.count).toBe(8);
      expect(await globalCount()).toBe(9);
      expect(
        await db`SELECT id FROM users WHERE username=${username}`,
      ).toHaveLength(0);
    });
  },
);
