import { afterEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  active: 0,
  maximum: 0,
  releases: [] as (() => void)[],
}));
// This is an auth-package dependency, not a root package dependency. Resolve
// from its owner so pnpm's strict workspace layout mocks the actual native binding.
vi.mock("../packages/auth/node_modules/@node-rs/argon2", () => ({
  Algorithm: { Argon2id: 2 },
  hash: vi.fn(
    () =>
      new Promise<string>((resolve) => {
        fixture.active++;
        fixture.maximum = Math.max(fixture.maximum, fixture.active);
        fixture.releases.push(() => {
          fixture.active--;
          resolve("fixture-encoded-hash");
        });
      }),
  ),
  verify: vi.fn(async () => true),
}));
import {
  hashPassword,
  passwordParameters,
  passwordSchema,
} from "../packages/auth/src/password";
import { authConfig } from "../packages/auth/src/config";
const snapshot = { ...process.env };
afterEach(() => {
  for (const key of [
    "AUTH_ARGON_MEMORY_KIB",
    "AUTH_ARGON_TIME_COST",
    "AUTH_ARGON_PARALLELISM",
    "NODE_ENV",
    "DEV_AUTH",
    "APP_URL",
    "DATABASE_URL",
  ]) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
});
describe("native password work and production safeguards", () => {
  it("rejects unsupported weak or unbounded hash configuration", () => {
    for (const key of [
      "AUTH_ARGON_MEMORY_KIB",
      "AUTH_ARGON_TIME_COST",
      "AUTH_ARGON_PARALLELISM",
    ])
      delete process.env[key];
    expect(passwordParameters()).toMatchObject({
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
      outputLen: 32,
      algorithm: 2,
    });
    for (const [key, value] of [
      ["AUTH_ARGON_MEMORY_KIB", "1"],
      ["AUTH_ARGON_MEMORY_KIB", "262145"],
      ["AUTH_ARGON_TIME_COST", "1"],
      ["AUTH_ARGON_TIME_COST", "11"],
      ["AUTH_ARGON_PARALLELISM", "0"],
      ["AUTH_ARGON_PARALLELISM", "5"],
    ]) {
      process.env[key] = value;
      expect(() => passwordParameters()).toThrow("secure range");
      delete process.env[key];
    }
  });
  it("preserves spaces and rejects excessively large password input", () => {
    expect(passwordSchema.parse("  Private passphrase 55!  ")).toBe(
      "  Private passphrase 55!  ",
    );
    expect(() => passwordSchema.parse("x".repeat(129))).toThrow();
    expect(() => passwordSchema.parse("short")).toThrow();
  });
  it("cannot turn on development authentication in a production process", () => {
    const environment: Record<string, string | undefined> = process.env;
    environment.NODE_ENV = "production";
    process.env.DEV_AUTH = "true";
    process.env.APP_URL = "https://example.test";
    process.env.DATABASE_URL = "postgres://localhost/native_guard_fixture";
    expect(authConfig().developmentLogin).toBe(false);
  });
  it("bounds simultaneous hash allocations to four and rejects work beyond its 32-slot queue", async () => {
    const results = Promise.allSettled(
      Array.from({ length: 40 }, () =>
        hashPassword("Concurrent private passphrase 99!"),
      ),
    );
    await Promise.resolve();
    expect(fixture.active).toBe(4);
    for (let batch = 0; batch < 9; batch++) {
      const releases = fixture.releases.splice(0);
      expect(releases).toHaveLength(4);
      releases.forEach((release) => release());
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const completed = await results;
    expect(fixture.maximum).toBe(4);
    expect(
      completed.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(36);
    const rejected = completed.filter(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult[];
    expect(rejected).toHaveLength(4);
    expect(rejected.every((result) => result.reason.status === 503)).toBe(true);
    expect(fixture.active).toBe(0);
  });
});
