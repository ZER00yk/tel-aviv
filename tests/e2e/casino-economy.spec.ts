import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { test, expect, captureBrowserErrors } from "./fixtures";

test("casino controls play poker and Plinko and settle a fictional loan", async ({
  page,
  accounts,
}) => {
  const errors = captureBrowserErrors(page);
  await accounts.signIn(page, "casino");
  await page.goto("/games/casino/play");
  const casino = page.getByLabel("Velvet Casino", { exact: true });
  await expect(casino.getByText("1,000", { exact: true })).toBeVisible();
  await casino.getByRole("button", { name: "Loans", exact: true }).click();
  await casino.getByLabel("Fictional loan amount").fill("500");
  await casino
    .getByRole("button", { name: "Borrow Credits", exact: true })
    .click();
  await expect(casino.getByText("1,500", { exact: true })).toBeVisible();
  await casino
    .getByRole("button", { name: "Repay 500 Credits", exact: true })
    .click();
  await expect(casino.getByText("1,000", { exact: true })).toBeVisible();
  await expect(
    casino.getByRole("button", { name: "Borrow Credits", exact: true }),
  ).toBeDisabled();
  await casino.getByRole("button", { name: "Poker", exact: true }).click();
  await casino.getByRole("button", { name: "New hand", exact: true }).click();
  await expect(
    casino.getByRole("button", { name: "Fold", exact: true }),
  ).toBeEnabled();
  await casino.getByRole("button", { name: "Fold", exact: true }).click();
  await expect(
    casino.getByText("You fold", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    casino.getByRole("button", { name: "Fold", exact: true }),
  ).toBeDisabled();
  await casino.getByRole("button", { name: "Plinko", exact: true }).click();
  await casino.getByRole("button", { name: "Drop ball", exact: true }).click();
  await expect(
    casino
      .getByRole("img", { name: "Plinko board and the most recent ball path" })
      .locator("polyline"),
  ).toHaveCount(1);
  await expect(casino.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("casino collection can be sold to another player and gifted through browser controls", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  const sql = postgres(
    process.env.DATABASE_URL ||
      "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
    { max: 1 },
  );
  const itemId = `browser-${randomUUID()}`;
  const buyerContext = await browser.newContext({ baseURL });
  const buyerPage = await buyerContext.newPage();
  const errors = captureBrowserErrors(page);
  const buyerErrors = captureBrowserErrors(buyerPage);
  try {
    await sql`INSERT INTO casino_collectible_stock(item_id,supply,price) VALUES(${itemId},2,100)`;
    await accounts.signIn(page, "cseller");
    const buyer = await accounts.signIn(buyerPage, "cbuyer");
    await page.goto("/games/casino/play");
    const casino = page.getByLabel("Velvet Casino", { exact: true });
    await casino
      .getByRole("button", { name: "Collection", exact: true })
      .click();
    await casino
      .getByRole("button", { name: `Buy ${itemId}`, exact: true })
      .click();
    await expect(
      casino.getByRole("heading", { name: `${itemId} #1`, exact: true }),
    ).toBeVisible();
    await casino.getByLabel("Collectible listing price").fill("50");
    await casino
      .getByRole("button", { name: "List for 50 Credits", exact: true })
      .click();
    await expect(
      casino.getByText("Listed for 50 Credits", { exact: true }),
    ).toBeVisible();
    await buyerPage.goto("/games/casino/play");
    const buyerCasino = buyerPage.getByLabel("Velvet Casino", { exact: true });
    await buyerCasino
      .getByRole("button", { name: "Marketplace", exact: true })
      .click();
    const listing = buyerCasino.locator("article").filter({
      has: buyerPage.getByRole("heading", {
        name: `${itemId} #1`,
        exact: true,
      }),
    });
    await listing
      .getByRole("button", { name: "Buy for 50 Credits", exact: true })
      .click();
    await expect(buyerCasino.getByText("950", { exact: true })).toBeVisible();
    await buyerCasino
      .getByRole("button", { name: "Collection", exact: true })
      .click();
    await expect(
      buyerCasino.getByRole("heading", { name: `${itemId} #1`, exact: true }),
    ).toBeVisible();
    await page.bringToFront();
    const resume = page.getByRole("button", { name: "Resume", exact: true });
    if (await resume.isVisible()) await resume.click();
    await casino
      .getByRole("button", { name: `Buy ${itemId}`, exact: true })
      .click();
    await expect(
      casino.getByRole("heading", { name: `${itemId} #2`, exact: true }),
    ).toBeVisible();
    await casino
      .getByLabel("Collectible recipient username")
      .fill(buyer.username);
    const owned = casino.locator("article").filter({
      has: page.getByRole("heading", { name: `${itemId} #2`, exact: true }),
    });
    await owned
      .getByRole("button", { name: `Send to ${buyer.username}`, exact: true })
      .click();
    await expect(
      casino.getByRole("heading", { name: `${itemId} #2`, exact: true }),
    ).toHaveCount(0);
    await buyerPage.reload();
    await buyerCasino
      .getByRole("button", { name: "Collection", exact: true })
      .click();
    await expect(
      buyerCasino.getByRole("heading", { name: `${itemId} #2`, exact: true }),
    ).toBeVisible();
    await expect(casino.getByRole("alert")).toHaveCount(0);
    await expect(buyerCasino.getByRole("alert")).toHaveCount(0);
    expect([...errors, ...buyerErrors]).toEqual([]);
  } finally {
    await buyerContext.close();
    // These copies and stock exist only for this UUID, not any shared edition.
    await sql`DELETE FROM casino_collectibles WHERE item_id=${itemId}`;
    await sql`DELETE FROM casino_collectible_stock WHERE item_id=${itemId}`;
    await sql.end();
  }
});
