import postgres from "postgres";
import { test, expect, captureBrowserErrors } from "./fixtures";

test("cosmetics purchase and equip on the profile, and achievement showcase follows Activity privacy", async ({
  page,
  browser,
  baseURL,
  accounts,
}) => {
  const owner = await accounts.signIn(page, "inventory");
  const viewerContext = await browser.newContext({ baseURL });
  const viewerPage = await viewerContext.newPage();
  const sql = postgres(
    process.env.DATABASE_URL ||
      "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
    { max: 1 },
  );
  const errors = captureBrowserErrors(page);
  const viewerErrors = captureBrowserErrors(viewerPage);
  try {
    // This account belongs to the test. These fixtures are not product rewards or existing user data.
    await sql`INSERT INTO currency_accounts(user_id,currency,balance) VALUES(${owner.id},'tell-coins',200)`;
    await sql`INSERT INTO user_achievements(user_id,achievement_id) VALUES(${owner.id},'incremental-forge')`;
    await accounts.signIn(viewerPage, "iview");
    await page.goto("/settings");
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Inventory", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Inventory & TellCoin shop",
        exact: true,
      }),
    ).toBeVisible();
    for (const [name, price] of [
      ["Neon frame", 40],
      ["Night owl", 60],
      ["Foundry badge", 100],
    ] as const) {
      await page
        .getByRole("button", {
          name: `Buy ${name} · ${price} TellCoins`,
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: `Equip ${name}`, exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: `Remove ${name}`, exact: true }),
      ).toBeVisible();
    }
    await page.getByLabel("Showcase First alloy", { exact: true }).check();
    await page
      .getByRole("button", { name: "Save showcase", exact: true })
      .click();
    await expect(
      page.getByText("Achievement showcase saved.", { exact: true }),
    ).toBeVisible();
    await viewerPage.goto(`/profile/${owner.id}`);
    await expect(viewerPage.locator(".inventory-avatar-frame")).toHaveCSS(
      "border-top-color",
      "rgb(142, 232, 196)",
    );
    await expect(
      viewerPage
        .locator(".inventory-cosmetics")
        .getByText("Night owl", { exact: true }),
    ).toBeVisible();
    await expect(
      viewerPage
        .locator(".inventory-cosmetics")
        .getByText("Foundry badge", { exact: true }),
    ).toBeVisible();
    await expect(
      viewerPage.getByText("First alloy", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Privacy", exact: true })
      .click();
    await page.getByLabel("Share my activity", { exact: true }).uncheck();
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      page.getByText("Saved. Your space, just the way you like it.", {
        exact: true,
      }),
    ).toBeVisible();
    await viewerPage.reload();
    await expect(
      viewerPage.getByText("This player's achievements are private.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      viewerPage.getByText("First alloy", { exact: true }),
    ).toHaveCount(0);
    await expect(
      viewerPage
        .locator(".inventory-cosmetics")
        .getByText("Night owl", { exact: true }),
    ).toBeVisible();
    expect([...errors, ...viewerErrors]).toEqual([]);
  } finally {
    await viewerContext.close();
    await sql.end();
  }
});
