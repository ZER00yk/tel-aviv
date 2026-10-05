import { test, expect, captureBrowserErrors } from "./fixtures";

test("session gate, game catalog and persistent sign-in work in the browser", async ({
  page,
  accounts,
}) => {
  const errors = captureBrowserErrors(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Your people are/ }),
  ).toBeVisible();
  const username = `browser_${Date.now().toString(36)}`;
  await page.getByLabel("Development username").fill(username);
  await page.getByRole("button", { name: "Development sign-in" }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await accounts.registerCurrent();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: /^Games/ })
    .click();
  await expect(
    page.getByRole("link", { name: "Signal Foundry", exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator("article.game-card")).toHaveCount(10);
  await page.goto("/classes");
  await expect(
    page.getByRole("heading", { name: /Classes|school|Your private/i }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await page.goto("/games");
  await expect(page.locator("article.game-card")).toHaveCount(10);
  await page.screenshot({
    path: "test-results/platform-catalog.png",
    fullPage: true,
  });
});

test("game catalog fits a phone viewport and mobile navigation opens", async ({
  page,
  accounts,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  await page.goto("/games");
  await expect(page.locator("article.game-card")).toHaveCount(10);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Classes", exact: true }),
  ).toBeInViewport();
  await page
    .getByRole("button", { name: "Close navigation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Close navigation", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
