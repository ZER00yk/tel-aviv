import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import type { Page } from "@playwright/test";
import { test, expect, captureBrowserErrors } from "./fixtures";

const originalPassword = "  Native account passphrase 47!  ";
const changedPassword = "A different long passphrase 82!";
const recoveredPassword = "Recovered account passphrase 93!";
const signedIn = (page: Page) =>
  page.getByRole("navigation", { name: "Main navigation" });
async function signIn(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Sign in to Tell Aviv", exact: true })
    .click();
}
async function createAccount(page: Page) {
  const username = `native_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page
    .getByLabel("Username", { exact: true })
    .fill(username.toUpperCase());
  await page
    .getByLabel("Private email (optional)")
    .fill(`${username}@example.invalid`);
  await page.getByLabel("New password", { exact: true }).fill(originalPassword);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(originalPassword);
  await page.getByRole("button", { name: "Create Tell Aviv account" }).click();
  await expect(signedIn(page)).toBeVisible();
  return username;
}
async function security(page: Page) {
  await page.goto("/settings");
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Security", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Account Security", exact: true }),
  ).toBeVisible();
}
async function logout(page: Page) {
  await security(page);
  await page
    .locator(".account-security")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  // Logout first removes the session, then navigates to the public page. The
  // temporary login form on /settings is replaced when that navigation commits.
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: /Your people are/ }),
  ).toBeVisible();
}

test("mobile native registration shows confirmation errors without sending credentials", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page
    .getByLabel("Username", { exact: true })
    .fill("confirmation_fixture");
  await page.getByLabel("New password", { exact: true }).fill(originalPassword);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(changedPassword);
  let registrations = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/auth/register")) registrations += 1;
  });
  await page
    .getByRole("button", { name: "Create Tell Aviv account", exact: true })
    .click();
  await expect(page.locator(".notice[role=alert]")).toHaveText(
    "The passwords do not match.",
  );
  expect(registrations).toBe(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await expect(page.getByRole("link", { name: /Google/i })).toHaveCount(0);
});

test("native account registration, password whitespace, persistent cookie and login work", async ({
  page,
  accounts,
}) => {
  const errors = captureBrowserErrors(page);
  const username = await createAccount(page);
  const account = await accounts.registerCurrent();
  expect(account.username).toBe(username);
  const cookie = (await page.context().cookies()).find(
    (entry) => entry.name === "ta_session",
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  await page.reload();
  await expect(signedIn(page)).toBeVisible();
  await logout(page);
  await signIn(page, username, originalPassword.trim());
  await expect(page.locator(".notice[role=alert]")).toBeVisible();
  await expect(signedIn(page)).toHaveCount(0);
  await signIn(page, username.toUpperCase(), originalPassword);
  await expect(signedIn(page)).toBeVisible();
  expect((await page.request.get("/api/me")).ok()).toBe(true);
  expect(errors).toEqual([]);
});

test("changing native password rejects old credentials and revokes a second browser session", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  const errors = captureBrowserErrors(page);
  const username = await createAccount(page);
  await accounts.registerCurrent();
  const context = await browser.newContext({ baseURL });
  try {
    const second = await context.newPage();
    await signIn(second, username, originalPassword);
    await expect(signedIn(second)).toBeVisible();
    await security(page);
    const form = page.getByRole("form", { name: "Change account password" });
    await form
      .getByLabel("Current password", { exact: true })
      .fill("Incorrect current passphrase!");
    await form
      .getByLabel("New password", { exact: true })
      .fill(changedPassword);
    await form
      .getByLabel("Confirm new password", { exact: true })
      .fill(changedPassword);
    await form
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(page.locator(".notice[role=alert]")).toBeVisible();
    expect((await second.request.get("/api/me")).ok()).toBe(true);
    await form
      .getByLabel("Current password", { exact: true })
      .fill(originalPassword);
    await form
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(
      page.getByText(
        "Password changed. Old passwords and recovery credentials no longer work.",
        { exact: true },
      ),
    ).toBeVisible();
    expect((await second.request.get("/api/me")).status()).toBe(401);
    await second.reload();
    await expect(
      second.getByRole("heading", { name: /Your people are/ }),
    ).toBeVisible();
    await logout(page);
    await signIn(page, username, originalPassword);
    await expect(page.locator(".notice[role=alert]")).toBeVisible();
    await signIn(page, username, changedPassword);
    await expect(signedIn(page)).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("private recovery codes reset a native password once and confirmed account deletion revokes it", async ({
  page,
  accounts,
}) => {
  const errors = captureBrowserErrors(page);
  const username = await createAccount(page);
  await accounts.registerCurrent();
  await security(page);
  await page
    .getByLabel("Password to generate recovery codes")
    .fill(originalPassword);
  await page
    .getByRole("button", { name: "Generate recovery codes", exact: true })
    .click();
  const codes = page.getByRole("region", { name: "New recovery codes" });
  await expect(codes).toBeVisible();
  const code = await codes.locator("code").first().innerText();
  expect(code.length).toBeGreaterThan(10);
  await codes.getByRole("button", { name: "I saved my codes" }).click();
  await expect(codes).toHaveCount(0);
  await logout(page);
  await page
    .getByRole("button", { name: "Forgot password?", exact: true })
    .click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByRole("button", { name: "Request reset link" }).click();
  await expect(
    page.getByText(
      /If this account has a verified private email address and email delivery is configured/,
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use recovery code", exact: true })
    .click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Recovery code", { exact: true }).fill(code);
  await page
    .getByLabel("New password", { exact: true })
    .fill(recoveredPassword);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(recoveredPassword);
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(
    page.getByText(
      "Your password has been reset. Sign in with your new password.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use recovery code", exact: true })
    .click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Recovery code", { exact: true }).fill(code);
  await page.getByLabel("New password", { exact: true }).fill(originalPassword);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(originalPassword);
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(page.locator(".notice[role=alert]")).toBeVisible();
  await signIn(page, username, recoveredPassword);
  await expect(signedIn(page)).toBeVisible();
  const oldSession = (await page.context().cookies()).find(
    (entry) => entry.name === "ta_session",
  )!;
  await page.goto("/settings");
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Account", exact: true })
    .click();
  await page
    .getByLabel(`Type DELETE ${username} to confirm`, { exact: true })
    .fill(`DELETE ${username}`);
  await page
    .getByLabel("Password to delete account", { exact: true })
    .fill(recoveredPassword);
  await page
    .getByRole("button", { name: "Permanently delete account" })
    .click();
  await expect(
    page.getByRole("heading", { name: /Your people are/ }),
  ).toBeVisible();
  expect(
    (
      await page.request.get("/api/me", {
        headers: { Cookie: `ta_session=${oldSession.value}` },
      })
    ).status(),
  ).toBe(401);
  await signIn(page, username, recoveredPassword);
  await expect(page.locator(".notice[role=alert]")).toBeVisible();
  expect(errors).toEqual([]);
});

test("existing development account keeps its identity through password bootstrap and device revocation", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  const errors = captureBrowserErrors(page);
  const account = await accounts.signIn(page, "bootstrap");
  const origin = new URL(baseURL || "http://localhost:3000").origin;
  const created = await page.request.post("/api/classes", {
    headers: { Origin: origin },
    data: { name: "Native migration preserved class" },
  });
  expect(created.ok()).toBe(true);
  const { data: schoolClass } = (await created.json()) as {
    data: { id: string };
  };
  await security(page);
  await page.getByLabel("New password", { exact: true }).fill(originalPassword);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(originalPassword);
  await page
    .getByRole("button", { name: "Set account password", exact: true })
    .click();
  await expect(
    page.getByText(
      "Your account now has a password. Use native sign-in from now on.",
    ),
  ).toBeVisible();
  expect(
    (
      await page.request.post("/api/auth/dev", {
        headers: { Origin: origin },
        data: { username: account.username },
      })
    ).status(),
  ).toBe(403);
  await logout(page);
  await signIn(page, account.username, originalPassword);
  await expect(signedIn(page)).toBeVisible();
  const { data } = (await (await page.request.get("/api/me")).json()) as {
    data: { id: string };
  };
  expect(data.id).toBe(account.id);
  expect((await page.request.get(`/api/classes/${schoolClass.id}`)).ok()).toBe(
    true,
  );
  const context = await browser.newContext({ baseURL });
  try {
    const second = await context.newPage();
    await signIn(second, account.username, originalPassword);
    await expect(signedIn(second)).toBeVisible();
    await security(page);
    await expect(
      page.getByRole("button", { name: /^Revoke session / }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: /^Revoke session / }).click();
    await expect(
      page.getByText("Session revoked.", { exact: true }),
    ).toBeVisible();
    expect((await second.request.get("/api/me")).status()).toBe(401);
    expect((await page.request.get("/api/me")).ok()).toBe(true);
    await expect(page.getByText(/session revoked ·/)).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("fixture-issued email verification and reset links require a browser action and clear token URLs", async ({
  page,
  accounts,
}) => {
  const errors = captureBrowserErrors(page);
  const username = await createAccount(page);
  const account = await accounts.registerCurrent();
  const sql = postgres(
    process.env.DATABASE_URL ||
      "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
    { max: 1 },
  );
  // This fixture inserts only digested random credentials for this owned account.
  // It exercises the real consume endpoints and browser UI, not live email delivery.
  const emailToken = randomBytes(32).toString("base64url"),
    resetToken = randomBytes(32).toString("base64url"),
    digest = (token: string) =>
      createHash("sha256").update(token).digest("hex");
  try {
    await sql`INSERT INTO email_verification_tokens(token_hash,user_id,email,credential_version,expires_at)
      SELECT ${digest(emailToken)},u.id,u.email,c.version,now()+interval '20 minutes'
      FROM users u JOIN user_credentials c ON c.user_id=u.id WHERE u.id=${account.id}`;
    await page.goto(`/#verifyEmailToken=${emailToken}`);
    await expect(
      page.getByRole("heading", {
        name: "Verify your private email",
        exact: true,
      }),
    ).toBeVisible();
    expect(page.url()).not.toContain(emailToken);
    expect(page.url()).not.toContain("verifyEmailToken");
    const [{ count }] =
      await sql`SELECT count(*)::int AS count FROM email_verification_tokens WHERE user_id=${account.id}`;
    expect(count).toBe(1);
    await page
      .getByRole("button", { name: "Verify email", exact: true })
      .click();
    await expect(
      page.getByText("Your private email address has been verified.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Return to Tell Aviv", exact: true })
      .click();
    await expect(signedIn(page)).toBeVisible();
    const { data: securityState } = (await (
      await page.request.get("/api/auth/security")
    ).json()) as { data: { emailVerified: boolean } };
    expect(securityState.emailVerified).toBe(true);
    await sql`INSERT INTO password_reset_tokens(token_hash,user_id,credential_version,expires_at)
      SELECT ${digest(resetToken)},user_id,version,now()+interval '20 minutes' FROM user_credentials WHERE user_id=${account.id}`;
    const oldCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === "ta_session",
    )!;
    await page.goto(`/#resetToken=${resetToken}`);
    await expect(
      page.getByRole("heading", { name: "Set a new password", exact: true }),
    ).toBeVisible();
    expect(page.url()).not.toContain(resetToken);
    expect(page.url()).not.toContain("resetToken");
    await page
      .getByLabel("New password", { exact: true })
      .fill(recoveredPassword);
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill(recoveredPassword);
    await page
      .getByRole("button", { name: "Reset password", exact: true })
      .click();
    await expect(
      page.getByText(
        "Your password has been reset. Sign in with your new password.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      (
        await page.request.get("/api/me", {
          headers: { Cookie: `ta_session=${oldCookie.value}` },
        })
      ).status(),
    ).toBe(401);
    await signIn(page, username, recoveredPassword);
    await expect(signedIn(page)).toBeVisible();
    await page.goto(`/#resetToken=${resetToken}`);
    await expect(
      page.getByRole("heading", { name: "Set a new password", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("New password", { exact: true })
      .fill(originalPassword);
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill(originalPassword);
    await page
      .getByRole("button", { name: "Reset password", exact: true })
      .click();
    await expect(page.locator(".notice[role=alert]")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await sql.end();
  }
});
