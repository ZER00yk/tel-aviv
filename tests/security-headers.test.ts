import { describe, expect, it } from "vitest";
import { securityHeaders } from "../packages/platform/src/securityHeaders";

const nonce = "ABCDEFGHIJKLMNOPQRSTUV==";
describe("request CSP and browser security headers", () => {
  it("uses a nonce and strict dynamic scripts in HTTPS production", () => {
    const headers = securityHeaders(nonce, {
      production: true,
      appUrl: "https://tell.example",
      realtimeUrl: "https://live.example/socket.io",
    });
    expect(headers["Content-Security-Policy"]).toContain(
      `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    );
    expect(headers["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
    expect(headers["Content-Security-Policy"]).toContain("wss://live.example");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000");
    expect(headers["Permissions-Policy"]).toContain("microphone=(self)");
  });
  it("allows development HMR and local realtime without HSTS or forced TLS", () => {
    const headers = securityHeaders(nonce, {
      production: false,
      appUrl: "http://localhost:3000",
      realtimeUrl: "http://localhost:3001",
    });
    expect(headers["Content-Security-Policy"]).toContain("ws://localhost:3001");
    expect(headers["Content-Security-Policy"]).toContain("'unsafe-eval'");
    expect(headers["Content-Security-Policy"]).not.toContain("upgrade-insecure");
    expect(headers).not.toHaveProperty("Strict-Transport-Security");
  });
  it("rejects nonce injection, insecure production and credential origins", () => {
    const production = { production: true, appUrl: "https://tell.example" };
    expect(() => securityHeaders("bad'; unsafe", production)).toThrow("nonce");
    expect(() => securityHeaders(nonce, { ...production, realtimeUrl: "http://live.example" })).toThrow("HTTPS");
    expect(() => securityHeaders(nonce, { ...production, realtimeUrl: "https://user:secret@live.example" })).toThrow("credentials");
    expect(() => securityHeaders(nonce, { ...production, realtimeUrl: "javascript:alert(1)" })).toThrow("origin");
  });
});
