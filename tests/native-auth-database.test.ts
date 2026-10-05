import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@tell-aviv/database";
import {
  getSession,
  handleAuth,
  hashToken,
  requireRecentAuthentication,
} from "@tell-aviv/auth";
import { ApiError, type User } from "@tell-aviv/shared";
import { POST } from "../apps/web/app/api/[...path]/route";
import {
  setEmailTransportForTests,
  recoveryResponseMilliseconds,
  type RecoveryEmail,
  type VerificationEmail,
} from "../packages/auth/src/email";

const origin = "http://localhost:3000",
  password = "  Correct account passphrase 47!  ",
  nextPassword = "Replacement password 84!";
const userIds: string[] = [];
const request = (cookie?: string, agent = "Native core fixture") =>
  new Request(`${origin}/api/auth`, {
    headers: { origin, "user-agent": agent, ...(cookie ? { cookie } : {}) },
  });
const call = (
  action: string,
  input: Record<string, unknown> = {},
  cookie?: string,
  method = "POST",
) => handleAuth(["auth", ...action.split("/")], method, request(cookie), input);
const cookieFor = (response: Response) =>
  response.headers.get("set-cookie")!.split(";")[0];
async function create(extra: Record<string, unknown> = {}) {
  const username = `native_${randomUUID().slice(0, 8)}`;
  const response = (await call("register", {
    username,
    password,
    passwordConfirmation: password,
    ...extra,
  }))!;
  const user = ((await response.json()) as { data: User }).data;
  userIds.push(user.id);
  return { username, user, cookie: cookieFor(response), response };
}
async function expectStatus(
  promise: Promise<unknown>,
  status: number,
  message?: string,
) {
  try {
    await promise;
    throw new Error("Expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    if (message) expect((error as ApiError).message).toBe(message);
  }
}
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "native account credentials and recovery",
  () => {
    afterEach(async () => {
      setEmailTransportForTests(undefined);
      for (const id of userIds.splice(0))
        await db`DELETE FROM users WHERE id=${id}`;
    });
    it("canonicalizes usernames, keeps UUID identity, preserves password whitespace, and stores only Argon2id", async () => {
      const original = `NATIVE_${randomUUID().slice(0, 8)}`;
      const account = await create({
        username: `  ${original}  `,
        email: " Private@Example.test ",
      });
      expect(account.user.username).toBe(original.toLowerCase());
      expect(account.user).not.toHaveProperty("email");
      const [credential] =
        await db`SELECT password_hash FROM user_credentials WHERE user_id=${account.user.id}`;
      expect(credential.password_hash).toMatch(
        /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/,
      );
      expect(credential.password_hash).not.toContain(password);
      await expectStatus(
        call("login", { username: original, password: password.trim() }),
        401,
      );
      const login = (await call("login", { username: original, password }))!;
      expect((await getSession(request(cookieFor(login))))?.id).toBe(
        account.user.id,
      );
      const security = await (await call(
        "security",
        {},
        account.cookie,
        "GET",
      ))!.json();
      expect(security.data.email).toBe("private@example.test");
      expect(security.data.emailVerified).toBe(false);
      expect(account.response.headers.get("set-cookie")).toContain(
        "HttpOnly; SameSite=Lax",
      );
    });
    it("admits exactly one simultaneous registration of a canonical username", async () => {
      const username = `race_${randomUUID().slice(0, 8)}`;
      const results = await Promise.allSettled([
        call("register", {
          username,
          password,
          passwordConfirmation: password,
        }),
        call("register", {
          username: username.toUpperCase(),
          password,
          passwordConfirmation: password,
        }),
      ]);
      const rows =
        await db`SELECT id FROM users WHERE lower(username)=${username}`;
      rows.forEach((row) => userIds.push(row.id));
      expect(rows).toHaveLength(1);
      expect(
        results.filter((item) => item.status === "fulfilled"),
      ).toHaveLength(1);
      const rejection = results.find(
        (item) => item.status === "rejected",
      ) as PromiseRejectedResult;
      expect(rejection.reason.status).toBe(409);
      expect(rejection.reason.message).toBe("Username is already taken");
    });
    it("rejects invalid fields and mismatched confirmation without creating users", async () => {
      for (const input of [
        { username: "xx", password, passwordConfirmation: password },
        {
          username: "not a username",
          password,
          passwordConfirmation: password,
        },
        { username: "a".repeat(101), password, passwordConfirmation: password },
        {
          username: "valid_name",
          password: "short",
          passwordConfirmation: "short",
        },
        {
          username: "valid_name",
          password: "x".repeat(129),
          passwordConfirmation: "x".repeat(129),
        },
        {
          username: "valid_name",
          password,
          passwordConfirmation: nextPassword,
        },
        {
          username: "valid_name",
          password,
          passwordConfirmation: password,
          email: "invalid",
        },
        {
          username: "valid_name",
          password,
          passwordConfirmation: password,
          role: "owner",
        },
      ])
        await expect(call("register", input)).rejects.toThrow();
    });
    it("uses identical public errors for wrong, missing, disabled and deleted users", async () => {
      const account = await create();
      await expectStatus(
        call("login", {
          username: account.username,
          password: "Incorrect password 33!",
        }),
        401,
        "Username or password is incorrect",
      );
      await expectStatus(
        call("login", {
          username: `missing_${randomUUID().slice(0, 8)}`,
          password,
        }),
        401,
        "Username or password is incorrect",
      );
      await db`UPDATE users SET disabled=true WHERE id=${account.user.id}`;
      await expectStatus(
        call("login", { username: account.username, password }),
        401,
        "Username or password is incorrect",
      );
      expect(await getSession(request(account.cookie))).toBeNull();
      await db`DELETE FROM users WHERE id=${account.user.id}`;
      await expectStatus(
        call("login", { username: account.username, password }),
        401,
        "Username or password is incorrect",
      );
    });
    it("rejects ambiguous, malformed, expired and revoked session cookies", async () => {
      const account = await create();
      expect(
        await getSession(request(`${account.cookie}; ${account.cookie}`)),
      ).toBeNull();
      expect(await getSession(request("ta_session=%invalid"))).toBeNull();
      expect(
        await getSession(request("ta_session=" + "a".repeat(129))),
      ).toBeNull();
      await db`UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=${account.user.id}`;
      expect(await getSession(request(account.cookie))).toBeNull();
      const login = (await call("login", {
        username: account.username,
        password,
      }))!;
      const cookie = cookieFor(login);
      expect(await getSession(request(cookie))).not.toBeNull();
      await call("logout", {}, cookie);
      expect(await getSession(request(cookie))).toBeNull();
    });
    it("rotates presented sessions on login and supports revoking one or all other devices", async () => {
      const account = await create();
      const replaced = (await call(
        "login",
        { username: account.username, password },
        account.cookie,
      ))!;
      const current = cookieFor(replaced);
      expect(current).not.toBe(account.cookie);
      expect(await getSession(request(account.cookie))).toBeNull();
      const second = cookieFor(
        (await call("login", { username: account.username, password }))!,
      );
      const third = cookieFor(
        (await call("login", { username: account.username, password }))!,
      );
      const sessions = (
        await (await call("sessions", {}, current, "GET"))!.json()
      ).data as { id: string; current: boolean }[];
      expect(sessions).toHaveLength(3);
      expect(sessions.filter((session) => session.current)).toHaveLength(1);
      const other = sessions.find((session) => !session.current)!;
      await call("sessions/revoke", { sessionId: other.id }, current);
      expect(
        [
          await getSession(request(second)),
          await getSession(request(third)),
        ].filter(Boolean),
      ).toHaveLength(1);
      await call("logout-others", {}, current);
      expect(await getSession(request(second))).toBeNull();
      expect(await getSession(request(third))).toBeNull();
      expect(await getSession(request(current))).not.toBeNull();
      await call("logout-all", {}, current);
      expect(await getSession(request(current))).toBeNull();
    });
    it("cannot revoke another account's session", async () => {
      const first = await create(),
        second = await create();
      const [{ id }] =
        await db`SELECT id FROM sessions WHERE user_id=${second.user.id}`;
      await expectStatus(
        call("sessions/revoke", { sessionId: id }, first.cookie),
        404,
      );
      expect(await getSession(request(second.cookie))).not.toBeNull();
    });
    it("requires recent credential proof, changes passwords, revokes other sessions and invalidates recovery", async () => {
      const account = await create();
      const second = cookieFor(
        (await call("login", { username: account.username, password }))!,
      );
      await call("recovery-codes/regenerate", { password }, account.cookie);
      await db`UPDATE sessions SET authenticated_at=now()-interval '11 minutes' WHERE user_id=${account.user.id}`;
      await expectStatus(
        call(
          "password",
          {
            currentPassword: password,
            newPassword: nextPassword,
            passwordConfirmation: nextPassword,
          },
          account.cookie,
        ),
        403,
        "Reauthenticate to continue",
      );
      await expectStatus(
        call("reauthenticate", { password: nextPassword }, account.cookie),
        401,
      );
      await call("reauthenticate", { password }, account.cookie);
      await call(
        "password",
        {
          currentPassword: password,
          newPassword: nextPassword,
          passwordConfirmation: nextPassword,
        },
        account.cookie,
      );
      expect(await getSession(request(second))).toBeNull();
      expect(await getSession(request(account.cookie))).not.toBeNull();
      await expectStatus(
        call("login", { username: account.username, password }),
        401,
      );
      expect(
        (await call("login", {
          username: account.username,
          password: nextPassword,
        }))!.status,
      ).toBe(200);
      expect(
        (
          await db`SELECT id FROM account_recovery_codes WHERE user_id=${account.user.id}`
        ).length,
      ).toBe(0);
    });
    it("retained other sessions lose recent-auth proof after a password change", async () => {
      const account = await create(),
        other = cookieFor(
          (await call("login", { username: account.username, password }))!,
        );
      await call(
        "password",
        {
          currentPassword: password,
          newPassword: nextPassword,
          passwordConfirmation: nextPassword,
          revokeOtherSessions: false,
        },
        account.cookie,
      );
      expect(await getSession(request(other))).not.toBeNull();
      await expectStatus(
        requireRecentAuthentication(request(other), account.user.id),
        403,
      );
      await call("reauthenticate", { password: nextPassword }, other);
      expect(
        await requireRecentAuthentication(request(other), account.user.id),
      ).toBeTypeOf("string");
    });
    it("serializes concurrent password changes and accepts only one old-password proof", async () => {
      const account = await create();
      const passwords = [nextPassword, "Concurrent replacement password 99!"];
      const results = await Promise.allSettled(
        passwords.map((newPassword) =>
          call(
            "password",
            {
              currentPassword: password,
              newPassword,
              passwordConfirmation: newPassword,
            },
            account.cookie,
          ),
        ),
      );
      expect(
        results.filter((item) => item.status === "fulfilled"),
      ).toHaveLength(1);
      const winner = results.findIndex((item) => item.status === "fulfilled");
      expect(
        (await call("login", {
          username: account.username,
          password: passwords[winner],
        }))!.status,
      ).toBe(200);
      await expectStatus(
        call("login", {
          username: account.username,
          password: passwords[1 - winner],
        }),
        401,
      );
    });
    it("bootstraps an existing development UUID with an individual password and closes dev bypass", async () => {
      const username = `bootstrap_${randomUUID().slice(0, 8)}`;
      const development = (await call("dev", { username }))!;
      const user = ((await development.json()) as { data: User }).data;
      userIds.push(user.id);
      const cookie = cookieFor(development);
      const [before] = await db`SELECT id FROM users WHERE id=${user.id}`;
      const bootstrapped = await call(
        "password/bootstrap",
        { newPassword: nextPassword, passwordConfirmation: nextPassword },
        cookie,
      );
      expect(await getSession(request(cookie))).toBeNull();
      const nativeCookie = cookieFor(bootstrapped!);
      expect(before.id).toBe((await getSession(request(nativeCookie)))?.id);
      await expectStatus(call("dev", { username }), 403);
      await expectStatus(
        call(
          "password/bootstrap",
          { newPassword: nextPassword, passwordConfirmation: nextPassword },
          nativeCookie,
        ),
        403,
      );
      const login = (await call("login", {
        username,
        password: nextPassword,
      }))!;
      expect((await getSession(request(cookieFor(login))))?.id).toBe(user.id);
    });
    it("generates digested recovery codes only after recent auth, regenerates and consumes once", async () => {
      const account = await create();
      const first = (
        await (await call(
          "recovery-codes/regenerate",
          { password },
          account.cookie,
        ))!.json()
      ).data.codes as string[];
      const stored =
        await db`SELECT code_hash FROM account_recovery_codes WHERE user_id=${account.user.id}`;
      expect(first).toHaveLength(8);
      expect(stored).toHaveLength(8);
      expect(
        stored.every(
          (row) =>
            /^[0-9a-f]{64}$/.test(row.code_hash) &&
            !first.includes(row.code_hash),
        ),
      ).toBe(true);
      const second = (
        await (await call(
          "recovery-codes/regenerate",
          { password },
          account.cookie,
        ))!.json()
      ).data.codes as string[];
      await expectStatus(
        call("recovery-codes/reset", {
          username: account.username,
          code: first[0],
          newPassword: nextPassword,
          passwordConfirmation: nextPassword,
        }),
        400,
      );
      await call("recovery-codes/reset", {
        username: account.username,
        code: second[0],
        newPassword: nextPassword,
        passwordConfirmation: nextPassword,
      });
      expect(await getSession(request(account.cookie))).toBeNull();
      await expectStatus(
        call("recovery-codes/reset", {
          username: account.username,
          code: second[0],
          newPassword: password,
          passwordConfirmation: password,
        }),
        400,
      );
      expect(
        (
          await db`SELECT id FROM account_recovery_codes WHERE user_id=${account.user.id}`
        ).length,
      ).toBe(0);
    });
    it("never sends a recovery token to an unverified email and returns the same neutral response", async () => {
      const sent: RecoveryEmail[] = [];
      setEmailTransportForTests({
        sendPasswordReset: async (message) => {
          sent.push(message);
        },
        sendEmailVerification: async () => {},
      });
      const account = await create({ email: "private@example.test" });
      const responses = await Promise.all([
        call("forgot-password", { username: account.username }),
        call("forgot-password", {
          username: `unknown_${randomUUID().slice(0, 8)}`,
        }),
      ]);
      expect(await responses[0]!.json()).toEqual(await responses[1]!.json());
      expect(sent).toHaveLength(0);
      expect(
        (
          await db`SELECT token_hash FROM password_reset_tokens WHERE user_id=${account.user.id}`
        ).length,
      ).toBe(0);
    });
    it("verifies a private email once and delivers only a digested version-pinned reset token", async () => {
      const verification: VerificationEmail[] = [],
        resets: RecoveryEmail[] = [];
      setEmailTransportForTests({
        sendPasswordReset: async (message) => {
          resets.push(message);
        },
        sendEmailVerification: async (message) => {
          verification.push(message);
        },
      });
      const account = await create({ email: "private@example.test" });
      await call("email/send-verification", {}, account.cookie);
      const token = new URLSearchParams(
        new URL(verification[0].verificationUrl).hash.slice(1),
      ).get("verifyEmailToken")!;
      const [record] =
        await db`SELECT token_hash,email FROM email_verification_tokens WHERE user_id=${account.user.id}`;
      expect(record.token_hash).toBe(hashToken(token));
      expect(record.email).toBe("private@example.test");
      await call("email/verify", { token });
      await expectStatus(call("email/verify", { token }), 400);
      await call("forgot-password", { username: account.username });
      const resetToken = new URLSearchParams(
        new URL(resets[0].resetUrl).hash.slice(1),
      ).get("resetToken")!;
      const [reset] =
        await db`SELECT token_hash,credential_version FROM password_reset_tokens WHERE user_id=${account.user.id}`;
      expect(reset.token_hash).toBe(hashToken(resetToken));
      expect(Number(reset.credential_version)).toBe(1);
      await call("reset-password", {
        token: resetToken,
        newPassword: nextPassword,
        passwordConfirmation: nextPassword,
      });
      expect(await getSession(request(account.cookie))).toBeNull();
      await expectStatus(
        call("reset-password", {
          token: resetToken,
          newPassword: password,
          passwordConfirmation: password,
        }),
        400,
      );
      expect(
        (await call("login", {
          username: account.username,
          password: nextPassword,
        }))!.status,
      ).toBe(200);
    });
    it("expires, replaces and consumes a reset credential exactly once under concurrency", async () => {
      const resets: RecoveryEmail[] = [];
      setEmailTransportForTests({
        sendPasswordReset: async (message) => {
          resets.push(message);
        },
        sendEmailVerification: async () => {},
      });
      const account = await create({ email: "verified@example.test" });
      await db`UPDATE users SET email_verified_at=now() WHERE id=${account.user.id}`;
      await call("forgot-password", { username: account.username });
      const first = new URLSearchParams(
        new URL(resets[0].resetUrl).hash.slice(1),
      ).get("resetToken")!;
      await call("forgot-password", { username: account.username });
      const second = new URLSearchParams(
        new URL(resets[1].resetUrl).hash.slice(1),
      ).get("resetToken")!;
      await expectStatus(
        call("reset-password", {
          token: first,
          newPassword: nextPassword,
          passwordConfirmation: nextPassword,
        }),
        400,
      );
      await db`UPDATE password_reset_tokens SET expires_at=now()-interval '1 second' WHERE user_id=${account.user.id}`;
      await expectStatus(
        call("reset-password", {
          token: second,
          newPassword: nextPassword,
          passwordConfirmation: nextPassword,
        }),
        400,
      );
      await call("forgot-password", { username: account.username });
      const third = new URLSearchParams(
        new URL(resets[2].resetUrl).hash.slice(1),
      ).get("resetToken")!;
      const results = await Promise.allSettled([
        call("reset-password", {
          token: third,
          newPassword: nextPassword,
          passwordConfirmation: nextPassword,
        }),
        call("reset-password", {
          token: third,
          newPassword: password,
          passwordConfirmation: password,
        }),
      ]);
      expect(
        results.filter((item) => item.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        (
          await db`SELECT token_hash FROM password_reset_tokens WHERE user_id=${account.user.id}`
        ).length,
      ).toBe(0);
    }, 15_000);
    it("email changes require recent auth, invalidate recovery and remove verification", async () => {
      const account = await create({ email: "before@example.test" });
      await db`UPDATE users SET email_verified_at=now() WHERE id=${account.user.id}`;
      await call("recovery-codes/regenerate", { password }, account.cookie);
      await call("email", { email: "after@example.test" }, account.cookie);
      const [user] =
        await db`SELECT email,email_verified_at FROM users WHERE id=${account.user.id}`;
      expect(user.email).toBe("after@example.test");
      expect(user.email_verified_at).toBeNull();
      expect(
        (
          await db`SELECT id FROM account_recovery_codes WHERE user_id=${account.user.id}`
        ).length,
      ).toBe(0);
      await db`UPDATE sessions SET authenticated_at=now()-interval '11 minutes' WHERE user_id=${account.user.id}`;
      await expectStatus(call("email", { email: null }, account.cookie), 403);
    });
    it("blocks expired/deleted/disabled or wrong-owner recent authentication and reports only private metadata", async () => {
      const account = await create(),
        other = await create();
      await expectStatus(
        requireRecentAuthentication(request(account.cookie), other.user.id),
        401,
      );
      const security = (
        await (await call("security", {}, account.cookie, "GET"))!.json()
      ).data;
      expect(security.recentlyAuthenticated).toBe(true);
      expect(
        security.events.some(
          (event: { kind: string }) => event.kind === "registered",
        ),
      ).toBe(true);
      expect(JSON.stringify(security)).not.toContain("password_hash");
      expect(JSON.stringify(security)).not.toContain(
        account.cookie.slice("ta_session=".length),
      );
      await db`UPDATE users SET disabled=true WHERE id=${account.user.id}`;
      await expectStatus(
        requireRecentAuthentication(request(account.cookie), account.user.id),
        401,
      );
      await db`DELETE FROM users WHERE id=${other.user.id}`;
      await expectStatus(
        requireRecentAuthentication(request(other.cookie), other.user.id),
        401,
      );
    });
    it("rejects sensitive changes and actual HTTP account deletion until current password reauthentication", async () => {
      const account = await create({ email: "private@example.test" });
      await db`UPDATE sessions SET authenticated_at=now()-interval '11 minutes' WHERE user_id=${account.user.id}`;
      await expectStatus(
        call(
          "username",
          { username: `rename_${randomUUID().slice(0, 8)}` },
          account.cookie,
        ),
        403,
      );
      await expectStatus(
        call("recovery-codes/regenerate", { password }, account.cookie),
        403,
      );
      await expectStatus(call("logout-others", {}, account.cookie), 403);
      const remove = () =>
        POST(
          new Request(`${origin}/api/account/delete`, {
            method: "POST",
            headers: {
              origin,
              "content-type": "application/json",
              cookie: account.cookie,
            },
            body: JSON.stringify({
              confirmation: `DELETE ${account.username}`,
            }),
          }),
          { params: Promise.resolve({ path: ["account", "delete"] }) },
        );
      const rejected = await remove();
      expect(rejected.status).toBe(403);
      expect(await rejected.json()).toMatchObject({
        error: "Reauthenticate to continue",
      });
      expect(
        await db`SELECT id,username FROM users WHERE id=${account.user.id}`,
      ).toEqual([{ id: account.user.id, username: account.username }]);
      expect(await getSession(request(account.cookie))).not.toBeNull();
      await expectStatus(
        call("reauthenticate", { password: nextPassword }, account.cookie),
        401,
      );
      expect((await remove()).status).toBe(403);
      await call("reauthenticate", { password }, account.cookie);
      expect((await remove()).status).toBe(200);
      expect(await getSession(request(account.cookie))).toBeNull();
      expect(
        await db`SELECT user_id FROM user_credentials WHERE user_id=${account.user.id}`,
      ).toHaveLength(0);
    });
    it("a failed email provider keeps public reset behavior neutral and records no secrets", async () => {
      setEmailTransportForTests({
        sendPasswordReset: async () => {
          throw new Error("Fixture provider unavailable");
        },
        sendEmailVerification: async () => {},
      });
      const account = await create({ email: "verified@example.test" });
      await db`UPDATE users SET email_verified_at=now() WHERE id=${account.user.id}`;
      const response = await call("forgot-password", {
        username: account.username,
      });
      expect(await response!.json()).toEqual({ data: { ok: true } });
      const events =
        await db`SELECT kind FROM account_security_events WHERE user_id=${account.user.id}`;
      expect(
        events.some((row) => row.kind === "recovery_delivery_failed"),
      ).toBe(true);
    });
    it("gates unknown and verified-account recovery responses while a stalled provider has a bounded deadline", async () => {
      let releaseDelivery!: () => void;
      const stalled = new Promise<void>((resolve) => {
        releaseDelivery = resolve;
      });
      let sent = 0;
      setEmailTransportForTests({
        sendPasswordReset: async () => {
          sent++;
          await stalled;
        },
        sendEmailVerification: async () => {},
      });
      const account = await create({ email: "verified@example.test" });
      await db`UPDATE users SET email_verified_at=now() WHERE id=${account.user.id}`;
      const started = performance.now();
      try {
        const responses = await Promise.all([
          call("forgot-password", { username: account.username }),
          call("forgot-password", {
            username: `absent_${randomUUID().slice(0, 8)}`,
          }),
        ]);
        // Neither response waits for the unresolved delivery fixture, and both
        // include the same response floor rather than exposing an instant miss.
        expect(performance.now() - started).toBeGreaterThanOrEqual(
          recoveryResponseMilliseconds - 20,
        );
        expect(sent).toBe(1);
        expect(await responses[0]!.json()).toEqual({ data: { ok: true } });
        expect(await responses[1]!.json()).toEqual({ data: { ok: true } });
        expect(
          await db`SELECT kind FROM account_security_events WHERE user_id=${account.user.id} AND kind='recovery_delivery_failed'`,
        ).toHaveLength(1);
      } finally {
        releaseDelivery();
      }
    });
    it("admits exactly one concurrent use of a recovery code and invalidates the complete old set", async () => {
      const account = await create();
      const codes = (
        await (await call(
          "recovery-codes/regenerate",
          { password },
          account.cookie,
        ))!.json()
      ).data.codes as string[];
      const replacements = [nextPassword, "Other concurrent password 76!"];
      const results = await Promise.allSettled(
        replacements.map((newPassword) =>
          call("recovery-codes/reset", {
            username: account.username,
            code: codes[0],
            newPassword,
            passwordConfirmation: newPassword,
          }),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find(
        (result) => result.status === "rejected",
      ) as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ status: 400 });
      expect(await getSession(request(account.cookie))).toBeNull();
      expect(
        await db`SELECT id FROM account_recovery_codes WHERE user_id=${account.user.id}`,
      ).toHaveLength(0);
      const winner = results.findIndex(
        (result) => result.status === "fulfilled",
      );
      expect(
        (await call("login", {
          username: account.username,
          password: replacements[winner],
        }))!.status,
      ).toBe(200);
    });
    it("consumes email verification once under concurrent requests", async () => {
      let verification!: VerificationEmail;
      setEmailTransportForTests({
        sendPasswordReset: async () => {},
        sendEmailVerification: async (message) => {
          verification = message;
        },
      });
      const account = await create({ email: "private@example.test" });
      await call("email/send-verification", {}, account.cookie);
      const token = new URLSearchParams(
        new URL(verification.verificationUrl).hash.slice(1),
      ).get("verifyEmailToken")!;
      const results = await Promise.allSettled([
        call("email/verify", { token }),
        call("email/verify", { token }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find(
        (result) => result.status === "rejected",
      ) as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ status: 400 });
      expect(
        await db`SELECT token_hash FROM email_verification_tokens WHERE user_id=${account.user.id}`,
      ).toHaveLength(0);
    });
    it("rejects expired, replaced and changed-email verification credentials", async () => {
      const messages: VerificationEmail[] = [];
      setEmailTransportForTests({
        sendPasswordReset: async () => {},
        sendEmailVerification: async (message) => {
          messages.push(message);
        },
      });
      const account = await create({ email: "private@example.test" });
      const tokenAt = (index: number) =>
        new URLSearchParams(
          new URL(messages[index].verificationUrl).hash.slice(1),
        ).get("verifyEmailToken")!;
      await call("email/send-verification", {}, account.cookie);
      await call("email/send-verification", {}, account.cookie);
      await expectStatus(call("email/verify", { token: tokenAt(0) }), 400);
      await db`UPDATE email_verification_tokens SET expires_at=now()-interval '1 second' WHERE user_id=${account.user.id}`;
      await expectStatus(call("email/verify", { token: tokenAt(1) }), 400);
      await call("email/send-verification", {}, account.cookie);
      await call(
        "email",
        { email: "replacement@example.test" },
        account.cookie,
      );
      await expectStatus(call("email/verify", { token: tokenAt(2) }), 400);
      const [row] =
        await db`SELECT email,email_verified_at FROM users WHERE id=${account.user.id}`;
      expect(row.email).toBe("replacement@example.test");
      expect(row.email_verified_at).toBeNull();
    });
    it("keeps recovery errors neutral for disabled and deleted accounts and cannot change their password", async () => {
      let verification!: VerificationEmail;
      let reset!: RecoveryEmail;
      setEmailTransportForTests({
        sendPasswordReset: async (message) => {
          reset = message;
        },
        sendEmailVerification: async (message) => {
          verification = message;
        },
      });
      const account = await create({ email: "private@example.test" });
      await call("email/send-verification", {}, account.cookie);
      const verifyToken = new URLSearchParams(
        new URL(verification.verificationUrl).hash.slice(1),
      ).get("verifyEmailToken")!;
      const codes = (
        await (await call(
          "recovery-codes/regenerate",
          { password },
          account.cookie,
        ))!.json()
      ).data.codes as string[];
      await db`UPDATE users SET email_verified_at=now() WHERE id=${account.user.id}`;
      await call("forgot-password", { username: account.username });
      const resetToken = new URLSearchParams(
        new URL(reset.resetUrl).hash.slice(1),
      ).get("resetToken")!;
      await db`UPDATE users SET disabled=true WHERE id=${account.user.id}`;
      const attempt = async () => {
        await expectStatus(
          call("reset-password", {
            token: resetToken,
            newPassword: nextPassword,
            passwordConfirmation: nextPassword,
          }),
          400,
          "Invalid or expired recovery credential",
        );
        await expectStatus(
          call("recovery-codes/reset", {
            username: account.username,
            code: codes[0],
            newPassword: nextPassword,
            passwordConfirmation: nextPassword,
          }),
          400,
          "Invalid or expired recovery credential",
        );
        await expectStatus(
          call("email/verify", { token: verifyToken }),
          400,
          "Invalid or expired verification link",
        );
      };
      await attempt();
      const [credential] =
        await db`SELECT version FROM user_credentials WHERE user_id=${account.user.id}`;
      expect(Number(credential.version)).toBe(1);
      await db`DELETE FROM users WHERE id=${account.user.id}`;
      await attempt();
    }, 15_000);
    it("unknown Google OAuth endpoints no longer initiate provider authentication", async () => {
      await expectStatus(call("google", {}, undefined, "GET"), 401);
      const status = (
        await (await call("status", {}, undefined, "GET"))!.json()
      ).data;
      expect(status.nativeAuthentication).toBe(true);
      expect(status).not.toHaveProperty("googleConfigured");
    });
  },
);
