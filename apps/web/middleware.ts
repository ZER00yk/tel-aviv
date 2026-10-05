import { NextRequest, NextResponse } from "next/server";
import { securityHeaders } from "../../packages/platform/src/securityHeaders";

export function middleware(request: NextRequest) {
  const nonce = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
  );
  const headers = securityHeaders(nonce, {
    production: process.env.NODE_ENV === "production",
    appUrl: process.env.APP_URL ?? request.nextUrl.origin,
    realtimeUrl:
      process.env.NEXT_PUBLIC_REALTIME_URL ??
      (process.env.NODE_ENV === "production"
        ? process.env.APP_URL
        : "http://localhost:3001"),
  });
  const forwarded = new Headers(request.headers);
  forwarded.set("x-nonce", nonce);
  forwarded.set("Content-Security-Policy", headers["Content-Security-Policy"]);
  const response = NextResponse.next({ request: { headers: forwarded } });
  for (const [name, value] of Object.entries(headers))
    response.headers.set(name, value);
  // Nonces must not be reused through a shared HTML cache.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
