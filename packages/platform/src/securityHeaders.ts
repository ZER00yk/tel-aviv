export type SecurityHeaderConfig = {
  production: boolean;
  appUrl: string;
  realtimeUrl?: string;
};

/** Only URL origins can enter source directives; never interpolate raw settings. */
function connectionSources(config: SecurityHeaderConfig): string[] {
  const sources = new Set<string>(["'self'"]);
  for (const value of [config.appUrl, config.realtimeUrl]) {
    if (!value) continue;
    const url = new URL(value);
    if (!["https:", "http:", "wss:", "ws:"].includes(url.protocol))
      throw new Error("Unsupported realtime origin");
    if (url.username || url.password)
      throw new Error("Realtime origins cannot contain credentials");
    if (config.production && ["http:", "ws:"].includes(url.protocol))
      throw new Error("Production realtime requires HTTPS or WSS");
    sources.add(url.origin);
    if (url.protocol === "https:" || url.protocol === "http:") {
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      sources.add(url.origin);
    }
  }
  return [...sources];
}

export function securityHeaders(nonce: string, config: SecurityHeaderConfig) {
  if (!/^[A-Za-z0-9+/=_-]{22,64}$/.test(nonce))
    throw new Error("Invalid CSP nonce");
  const directives = [
    "default-src 'self'",
    config.production
      ? `script-src 'nonce-${nonce}' 'strict-dynamic'`
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    // KaTeX, canvas layout and existing authored UI require inline styles.
    "style-src 'self' 'unsafe-inline'",
    // Remote avatars and configured GIF results remain image resources only.
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectionSources(config).join(" ")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(config.production ? ["upgrade-insecure-requests"] : []),
  ];
  return {
    "Content-Security-Policy": directives.join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(self), geolocation=(), display-capture=(), gamepad=(self)",
    ...(config.production
      ? { "Strict-Transport-Security": "max-age=31536000" }
      : {}),
  };
}
