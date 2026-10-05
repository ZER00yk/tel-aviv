import postgres from "postgres";
import { test, expect, captureBrowserErrors } from "./fixtures";

test("ranked and map categories use real SQL scopes and friend/period filters", async ({
  page,
  accounts,
}) => {
  const account = await accounts.signIn(page, "rankfilter");
  const errors = captureBrowserErrors(page);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  try {
    await sql`INSERT INTO leaderboard_entries(user_id,game_id,category,period,period_key,score)
      VALUES(${account.id},'ego-trip','volatile','all','all',731),
      (${account.id},'ego-trip','standard-fragile','all','all',419),
      (${account.id},'tower-defense','endless','weekly',${monday.toISOString().slice(0, 10)},27)`;
    await page.goto("/games/ego-trip");
    await expect(
      page.getByText("Server-validated solo gauntlet", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Leaderboards", exact: true })
      .click();
    await page.getByLabel("Leaderboard players").selectOption("friends");
    await page.getByLabel("Leaderboard category").selectOption("volatile");
    const row = page
      .locator(".leaderboard-row")
      .filter({ hasText: account.username });
    await expect(row.locator("strong")).toHaveText("731");
    await page
      .getByLabel("Leaderboard category")
      .selectOption("standard-fragile");
    await expect(row.locator("strong")).toHaveText("419");
    await page.goto("/games/tower-defense");
    await page
      .getByRole("button", { name: "Leaderboards", exact: true })
      .click();
    await page.getByLabel("Leaderboard category").selectOption("endless");
    await page.getByLabel("Leaderboard period").selectOption("weekly");
    await page.getByLabel("Leaderboard players").selectOption("friends");
    await expect(row.locator("strong")).toHaveText("27");
    await page.getByLabel("Leaderboard category").selectOption("crossroads");
    await expect(
      page.locator(".leaderboard-row").filter({ hasText: account.username }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await sql.end();
  }
});
