import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { test, expect, captureBrowserErrors } from "./fixtures";
test("casino browser barter reserves both sides, settles numbered copies, and records history", async ({
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
  const edition = `offer-${randomUUID()}`;
  const recipientContext = await browser.newContext({ baseURL });
  const recipientPage = await recipientContext.newPage();
  const errors = captureBrowserErrors(page),
    recipientErrors = captureBrowserErrors(recipientPage);
  const resume = async (target: typeof page) => {
    await target.bringToFront();
    const button = target.getByRole("button", { name: "Resume", exact: true });
    if (await button.isVisible()) await button.click();
  };
  try {
    await sql`INSERT INTO casino_collectible_stock(item_id,supply,price) VALUES(${edition},3,1)`;
    const sender = await accounts.signIn(page, "offerfrom"),
      recipient = await accounts.signIn(recipientPage, "offerto");
    for (const target of [page, recipientPage]) {
      await target.goto("/games/casino/play");
      await resume(target);
      const casino = target.getByLabel("Velvet Casino", { exact: true });
      await casino
        .getByRole("button", { name: "Collection", exact: true })
        .click();
      await casino
        .getByRole("button", { name: `Buy ${edition}`, exact: true })
        .click();
      await expect(
        casino.getByRole("heading", { name: new RegExp(`${edition} #`) }),
      ).toBeVisible();
    }
    await resume(page);
    const casino = page.getByLabel("Velvet Casino", { exact: true });
    await casino.getByRole("button", { name: "Offers", exact: true }).click();
    await casino.getByLabel("Trade offer recipient").fill(recipient.username);
    await casino.getByLabel(`${edition} #1`, { exact: true }).check();
    await casino.getByLabel("Offered fictional Credits").fill("100");
    await casino.getByLabel("Requested fictional Credits").fill("50");
    await casino.getByRole("button", { name: "Add requested edition" }).click();
    await casino
      .getByLabel("Requested edition 1", { exact: true })
      .selectOption(edition);
    await casino
      .getByRole("button", { name: "Send trade offer", exact: true })
      .click();
    await expect(
      casino.getByText("Trade offer sent; 100 fictional Credits reserved.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(casino.getByText("899", { exact: true })).toBeVisible();
    await resume(recipientPage);
    const incoming = recipientPage.getByLabel("Velvet Casino", { exact: true });
    await incoming.getByRole("button", { name: "Offers", exact: true }).click();
    await expect(
      incoming.getByRole("heading", {
        name: `Offer from @${sender.username}`,
        exact: true,
      }),
    ).toBeVisible({ timeout: 25000 });
    const offer = incoming
      .locator("article")
      .filter({
        has: recipientPage.getByRole("heading", {
          name: `Offer from @${sender.username}`,
          exact: true,
        }),
      });
    await offer.getByLabel(`${edition} #2`, { exact: true }).check();
    await offer
      .getByRole("button", { name: "Accept barter", exact: true })
      .click();
    await expect(
      incoming.getByText(
        "Barter accepted. Credits and collectible ownership settled together.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(incoming.getByText("1,049", { exact: true })).toBeVisible();
    await incoming.getByText(/Gift and trade history/).click();
    await expect(
      incoming.getByText(
        `barter · @${sender.username} → @${recipient.username}`,
        { exact: true },
      ),
    ).toBeVisible();
    await incoming
      .getByRole("button", { name: "Collection", exact: true })
      .click();
    await expect(
      incoming.getByRole("heading", { name: `${edition} #1`, exact: true }),
    ).toBeVisible();
    await expect(
      incoming.getByRole("heading", { name: `${edition} #2`, exact: true }),
    ).toHaveCount(0);
    await resume(page);
    await casino
      .getByRole("button", { name: "Collection", exact: true })
      .click();
    await expect(
      casino.getByRole("heading", { name: `${edition} #2`, exact: true }),
    ).toBeVisible({ timeout: 25000 });
    await expect(casino.getByText("949", { exact: true })).toBeVisible();
    expect([...errors, ...recipientErrors]).toEqual([]);
  } finally {
    await recipientContext.close();
    await sql`DELETE FROM casino_collectibles WHERE item_id=${edition}`;
    await sql`DELETE FROM casino_collectible_stock WHERE item_id=${edition}`;
    await sql.end();
  }
});
