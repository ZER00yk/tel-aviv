export function authConfig() {
  const production = process.env.NODE_ENV === "production";
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  if (
    production &&
    (!process.env.DATABASE_URL ||
      !process.env.APP_URL ||
      !appUrl.startsWith("https://"))
  )
    throw new Error("Production requires DATABASE_URL and an HTTPS APP_URL");
  return {
    production,
    appUrl,
    developmentLogin: !production && process.env.DEV_AUTH === "true",
    sessionSeconds: 30 * 86400,
    recentAuthenticationSeconds: 10 * 60,
  };
}
