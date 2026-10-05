import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@tell-aviv/database";
import {
  authRateScopeHash,
  consumeAuthRateLimit,
  enforceAuthIdentityRate,
  enforceAuthTransportRate,
  normalizeAuthRateIdentity,
  pruneAuthRateWindows,
  trustedAuthSource,
} from "../packages/auth/src/rateLimit";

const proxySecret = "native-auth-test-proxy-secret-at-least-32-bytes";
const origin = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
const request = (headers: Record<string, string> = {}, method = "POST") =>
  new Request(`${origin}/api/auth/login`, { method, headers });

describe("anonymous authentication source attestation", () => {
  beforeEach(() => {
    process.env.AUTH_TRUSTED_PROXY_SECRET = proxySecret;
  });
  const priorSecret = process.env.AUTH_TRUSTED_PROXY_SECRET;
  afterEach(() => {
    if (priorSecret === undefined) delete process.env.AUTH_TRUSTED_PROXY_SECRET;
    else process.env.AUTH_TRUSTED_PROXY_SECRET = priorSecret;
  });
  it("ignores spoofed forwarding and client identity without proof", () => {
    expect(
      trustedAuthSource(
        request({
          "x-forwarded-for": "203.0.113.20",
          forwarded: "for=203.0.113.21;proto=https",
          "x-real-ip": "203.0.113.22",
          "x-tell-aviv-client-ip": "203.0.113.23",
        }),
      ),
    ).toBeUndefined();
    expect(
      trustedAuthSource(
        request({
          "x-tell-aviv-proxy-secret": "forged-secret",
          "x-tell-aviv-client-ip": "203.0.113.23",
        }),
      ),
    ).toBeUndefined();
    delete process.env.AUTH_TRUSTED_PROXY_SECRET;
    expect(
      trustedAuthSource(
        request({
          "x-tell-aviv-proxy-secret": proxySecret,
          "x-tell-aviv-client-ip": "203.0.113.23",
        }),
      ),
    ).toBeUndefined();
  });
  it("accepts only the independently attested single source despite forged forwarding", () => {
    expect(
      trustedAuthSource(
        request({
          "x-tell-aviv-proxy-secret": proxySecret,
          "x-tell-aviv-client-ip": "198.51.100.4",
          "x-forwarded-for": "203.0.113.20, 203.0.113.21",
          forwarded: "for=203.0.113.22",
        }),
      ),
    ).toBe("198.51.100.4");
  });
  it.each([
    "198.51.100.4, 198.51.100.5",
    "unknown",
    "198.51.100.004",
    "[2001:db8::1]",
    "2001:db8::1%eth0",
    "198.51.100.4:443",
    "198.51.100.4 198.51.100.5",
    "https://198.51.100.4",
  ])("rejects invalid or multiple attested addresses: %s", (ip) => {
    expect(
      trustedAuthSource(
        request({
          "x-tell-aviv-proxy-secret": proxySecret,
          "x-tell-aviv-client-ip": ip,
        }),
      ),
    ).toBeUndefined();
  });
  it("canonicalizes expanded IPv6 and IPv4-mapped addresses into shared sources", () => {
    const trusted = (ip: string) =>
      trustedAuthSource(
        request({
          "x-tell-aviv-proxy-secret": proxySecret,
          "x-tell-aviv-client-ip": ip,
        }),
      );
    expect(trusted("2001:0DB8:0000:0000:0000:0000:0000:0001")).toBe(
      trusted("2001:db8::1"),
    );
    expect(trusted("::ffff:192.0.2.1")).toBe(trusted("192.0.2.1"));
    expect(trusted("::FFFF:C000:0201")).toBe("192.0.2.1");
  });
  it("fails closed for short proxy configuration and ambiguous attestation headers", () => {
    process.env.AUTH_TRUSTED_PROXY_SECRET = "too-short";
    expect(
      trustedAuthSource(
        request({
          "x-tell-aviv-proxy-secret": "too-short",
          "x-tell-aviv-client-ip": "198.51.100.4",
        }),
      ),
    ).toBeUndefined();
    process.env.AUTH_TRUSTED_PROXY_SECRET = proxySecret;
    expect(
      trustedAuthSource(
        request({
          "x-tell-aviv-proxy-secret": `${proxySecret}, ${proxySecret}`,
          "x-tell-aviv-client-ip": "198.51.100.4",
        }),
      ),
    ).toBeUndefined();
  });
  it("normalizes the same account across case/whitespace while keeping scope types separate", () => {
    expect(normalizeAuthRateIdentity(" Player_ONE ")).toBe("player_one");
    expect(normalizeAuthRateIdentity("e\u0301")).toBe("é");
    expect(() => normalizeAuthRateIdentity(" ")).toThrow();
    expect(() => normalizeAuthRateIdentity("x".repeat(321))).toThrow();
    const hash = authRateScopeHash("identity", "player_one");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("player_one");
    expect(hash).not.toBe(authRateScopeHash("source", "player_one"));
  });
  it("permits isolated server-side test quotas while ignoring test namespaces in production", () => {
    const priorMode = process.env.NODE_ENV;
    const priorNamespace = process.env.AUTH_RATE_NAMESPACE;
    const environment: Record<string, string | undefined> = process.env;
    try {
      delete process.env.AUTH_RATE_NAMESPACE;
      const defaultHash = authRateScopeHash("global", "native");
      environment.NODE_ENV = "test";
      process.env.AUTH_RATE_NAMESPACE = "isolated-fixture";
      expect(authRateScopeHash("global", "native")).not.toBe(defaultHash);
      environment.NODE_ENV = "production";
      expect(authRateScopeHash("global", "native")).toBe(defaultHash);
      environment.NODE_ENV = "test";
      process.env.AUTH_RATE_NAMESPACE = "invalid namespace";
      expect(() => authRateScopeHash("global", "native")).toThrow("namespace");
    } finally {
      environment.NODE_ENV = priorMode;
      if (priorNamespace === undefined) delete process.env.AUTH_RATE_NAMESPACE;
      else process.env.AUTH_RATE_NAMESPACE = priorNamespace;
    }
  });
});

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "durable anonymous authentication quotas",
  () => {
    const ownHashes = new Set<string>();
    let globalHash: string;
    let previousSecret: string | undefined;
    let previousNamespace: string | undefined;
    const scope = (identity: string = randomUUID()) => {
      const hash = authRateScopeHash("identity", identity);
      ownHashes.add(hash);
      return hash;
    };
    beforeEach(async () => {
      previousSecret = process.env.AUTH_TRUSTED_PROXY_SECRET;
      previousNamespace = process.env.AUTH_RATE_NAMESPACE;
      process.env.AUTH_TRUSTED_PROXY_SECRET = proxySecret;
      process.env.AUTH_RATE_NAMESPACE = `security-rate-${randomUUID()}`;
      globalHash = authRateScopeHash("global", "native");
      ownHashes.add(globalHash);
    });
    afterEach(async () => {
      if (ownHashes.size)
        await db`DELETE FROM auth_request_windows WHERE scope_hash IN ${db([...ownHashes])}`;
      ownHashes.clear();
      if (previousSecret === undefined)
        delete process.env.AUTH_TRUSTED_PROXY_SECRET;
      else process.env.AUTH_TRUSTED_PROXY_SECRET = previousSecret;
      if (previousNamespace === undefined)
        delete process.env.AUTH_RATE_NAMESPACE;
      else process.env.AUTH_RATE_NAMESPACE = previousNamespace;
    });
    it("admits exactly the concurrent quota and preserves a saturated window until expiry", async () => {
      const hash = scope();
      const results = await Promise.allSettled(
        Array.from({ length: 40 }, () =>
          consumeAuthRateLimit(hash, "auth:test_concurrent", 7, 60),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(7);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(33);
      for (const result of results)
        if (result.status === "rejected")
          expect(result.reason).toMatchObject({ status: 429 });
      const [before] =
        await db`SELECT count,window_start,expires_at FROM auth_request_windows WHERE scope_hash=${hash}`;
      await expect(
        consumeAuthRateLimit(hash, "auth:test_concurrent", 7, 60),
      ).rejects.toMatchObject({ status: 429 });
      expect(
        (
          await db`SELECT count,window_start,expires_at FROM auth_request_windows WHERE scope_hash=${hash}`
        )[0],
      ).toEqual(before);
      await db`UPDATE auth_request_windows SET window_start=clock_timestamp()-interval '61 seconds' WHERE scope_hash=${hash}`;
      await consumeAuthRateLimit(hash, "auth:test_concurrent", 7, 60);
      expect(
        (
          await db`SELECT count FROM auth_request_windows WHERE scope_hash=${hash}`
        )[0].count,
      ).toBe(1);
    });
    it("uses one normalized missing-account quota across failed work without storing usernames", async () => {
      const username = `absent_${randomUUID().slice(0, 8)}`;
      const hash = scope(username);
      for (let i = 0; i < 8; i++) {
        await enforceAuthIdentityRate(
          "login",
          i % 2 ? ` ${username.toUpperCase()} ` : username,
        );
        await expect(
          db.begin(async () => {
            throw new Error("credential verification failed");
          }),
        ).rejects.toThrow("credential verification failed");
      }
      await expect(
        enforceAuthIdentityRate("login", username),
      ).rejects.toMatchObject({ status: 429 });
      const [row] =
        await db`SELECT * FROM auth_request_windows WHERE scope_hash=${hash}`;
      expect(row.count).toBe(8);
      expect(JSON.stringify(row)).not.toContain(username);
      await enforceAuthIdentityRate("forgot-password", username);
      expect(
        await db`SELECT bucket FROM auth_request_windows WHERE scope_hash=${hash} ORDER BY bucket`,
      ).toEqual([{ bucket: "auth:forgot-password" }, { bucket: "auth:login" }]);
    });
    it("counts the attested source across changing forwarded headers while retaining global accounting", async () => {
      const ip = `2001:db8:${randomUUID().slice(0, 4)}::1`;
      const sourceHash = authRateScopeHash(
        "source",
        trustedAuthSource(
          request({
            "x-tell-aviv-proxy-secret": proxySecret,
            "x-tell-aviv-client-ip": ip,
          }),
        )!,
      );
      ownHashes.add(sourceHash);
      const results = await Promise.allSettled(
        Array.from({ length: 35 }, (_, i) =>
          enforceAuthTransportRate(
            request({
              "x-tell-aviv-proxy-secret": proxySecret,
              "x-tell-aviv-client-ip": ip,
              "x-forwarded-for": `198.51.100.${i + 1}`,
            }),
            i % 2 ? "login" : "register",
          ),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(30);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(5);
      expect(
        (
          await db`SELECT count FROM auth_request_windows WHERE scope_hash=${sourceHash}`
        )[0].count,
      ).toBe(30);
      expect(
        (
          await db`SELECT count FROM auth_request_windows WHERE scope_hash=${globalHash}`
        )[0].count,
      ).toBe(35);
    });
    it("keeps anonymous global protection when callers forge all source headers", async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 125 }, (_, i) =>
          enforceAuthTransportRate(
            request({
              "x-tell-aviv-proxy-secret": "forged",
              "x-tell-aviv-client-ip": `198.51.100.${i + 1}`,
              "x-forwarded-for": `203.0.113.${i + 1}`,
            }),
            i % 2 ? "login" : "forgot-password",
          ),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(120);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(5);
      expect(
        (
          await db`SELECT count FROM auth_request_windows WHERE scope_hash=${globalHash}`
        )[0].count,
      ).toBe(120);
      for (let i = 0; i < 125; i++)
        expect(
          await db`SELECT scope_hash FROM auth_request_windows WHERE scope_hash=${authRateScopeHash("source", `198.51.100.${i + 1}`)}`,
        ).toHaveLength(0);
    });
    it("skips development fixtures/status but covers hierarchical recovery mutations", async () => {
      await enforceAuthTransportRate(request(), "dev");
      await enforceAuthTransportRate(request({}, "GET"), "login");
      await enforceAuthTransportRate(request(), "constructor");
      expect(
        await db`SELECT count FROM auth_request_windows WHERE scope_hash=${globalHash}`,
      ).toHaveLength(0);
      await enforceAuthTransportRate(request(), "recovery-codes/reset");
      await enforceAuthTransportRate(request(), "password/bootstrap");
      expect(
        (
          await db`SELECT count FROM auth_request_windows WHERE scope_hash=${globalHash}`
        )[0].count,
      ).toBe(2);
    });
    it("bounds cleanup and preserves live request windows", async () => {
      const hashes = Array.from({ length: 502 }, () => scope());
      await db`INSERT INTO auth_request_windows ${db(
        hashes.map((scope_hash) => ({
          scope_hash,
          bucket: "auth:expired_test",
          window_start: new Date(Date.now() - 10_000),
          expires_at: new Date(Date.now() - 5000),
          count: 1,
        })),
      )}`;
      const live = scope();
      await consumeAuthRateLimit(live, "auth:live_test", 8, 60);
      expect(await pruneAuthRateWindows()).toBe(500);
      expect(
        await db`SELECT scope_hash FROM auth_request_windows WHERE scope_hash IN ${db(hashes)}`,
      ).toHaveLength(2);
      expect(
        (
          await db`SELECT count FROM auth_request_windows WHERE scope_hash=${live}`
        )[0].count,
      ).toBe(1);
    });
  },
);
