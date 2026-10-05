import { describe, it, expect } from "vitest";
import { hashToken } from "../packages/auth/src/index";
import { authConfig } from "../packages/auth/src/config";
import { usernamePattern, levelForXp } from "@tell-aviv/shared";
describe("identity security", () => {
  it("stores only a digest of opaque session tokens", () => {
    expect(hashToken("session-a")).toHaveLength(64);
    expect(hashToken("session-a")).not.toBe(hashToken("session-b"));
  });
  it("validates public usernames and level progression", () => {
    expect(usernamePattern.test("player_1")).toBe(true);
    expect(usernamePattern.test("<script>")).toBe(false);
    expect(usernamePattern.test("xy")).toBe(false);
    expect(levelForXp(400)).toBe(3);
  });
  it("requires explicit development auth opt-in", () => {
    const previous = process.env.DEV_AUTH;
    process.env.DEV_AUTH = "false";
    expect(authConfig().developmentLogin).toBe(false);
    process.env.DEV_AUTH = "true";
    expect(authConfig().developmentLogin).toBe(true);
    if (previous === undefined) delete process.env.DEV_AUTH;
    else process.env.DEV_AUTH = previous;
  });
  it("rejects unsafe production auth configuration", () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      APP_URL: process.env.APP_URL,
      DATABASE_URL: process.env.DATABASE_URL,
    };
    const environment: Record<string, string | undefined> = process.env;
    environment.NODE_ENV = "production";
    process.env.APP_URL = "http://localhost:3000";
    process.env.DATABASE_URL = "postgres://localhost/test";
    expect(() => authConfig()).toThrow("HTTPS");
    process.env.APP_URL = "https://example.test";
    expect(authConfig().developmentLogin).toBe(false);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
});
