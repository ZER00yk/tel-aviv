import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { test, expect, captureBrowserErrors } from "./fixtures";

test("season preview, verified gameplay, finalization and once-only reward history work in two browsers", async ({
  page,
  accounts,
  baseURL,
}) => {
  const owner = await accounts.signIn(page, "seasonadm"),
    playerContext = await page.context().browser()!.newContext(),
    playerPage = await playerContext.newPage(),
    player = await accounts.signIn(playerPage, "seasonply"),
    errors = captureBrowserErrors(page),
    playerErrors = captureBrowserErrors(playerPage),
    slug = `browser-${randomUUID().slice(0, 8)}`,
    title = `Browser season ${slug}`,
    origin = new URL(baseURL || "http://localhost:3000").origin,
    sql = postgres(
      process.env.DATABASE_URL ||
        "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
      { max: 1 },
    );
  let seasonId = "";
  try {
    await sql`UPDATE users SET role='owner' WHERE id=${owner.id}`;
    await page.goto("/admin");
    await page.getByRole("button", { name: "Seasons", exact: true }).click();
    await page.getByLabel("Season identifier", { exact: true }).fill(slug);
    await page.getByLabel("Season title", { exact: true }).fill(title);
    await page
      .getByLabel("Season eligible game", { exact: true })
      .selectOption("tower-defense");
    await page
      .getByLabel("Season eligible mode", { exact: true })
      .selectOption("crossroads");
    await page
      .getByLabel("Season ends", { exact: true })
      .fill(new Date(Date.now() + 3600000).toISOString().slice(0, 16));
    await page
      .getByRole("button", { name: "Preview season start", exact: true })
      .click();
    await expect(
      page.getByText(
        "Maximum rewards: 175 fictional Tell Coins. Starts when confirmed.",
      ),
    ).toBeVisible();
    expect(
      await sql`SELECT id FROM game_seasons WHERE slug=${slug}`,
    ).toHaveLength(0);
    await page
      .getByLabel("Season operation confirmation", { exact: true })
      .fill(`START SEASON ${slug}`);
    await page
      .getByLabel("Season operation reason", { exact: true })
      .fill("Browser season lifecycle verification");
    await page
      .getByRole("button", { name: "Start confirmed season", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Season started." }),
    ).toBeVisible();
    const [season] = await sql`SELECT id FROM game_seasons WHERE slug=${slug}`;
    seasonId = season.id;

    // Produce the score with authoritative gameplay, without a fixture score injection.
    await playerPage.goto("/games/tower-defense/play");
    const canvas = playerPage.locator(".game-canvas canvas");
    await expect(canvas).toBeVisible();
    await playerPage
      .getByLabel("Defense map", { exact: true })
      .selectOption("crossroads");
    const restarting = playerPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/games/tower-defense/action") &&
        response.request().postDataJSON()?.action === "start",
    );
    await playerPage
      .getByRole("button", { name: "New defense", exact: true })
      .click();
    expect((await restarting).ok()).toBe(true);
    await expect(
      playerPage.getByRole("heading", {
        name: "Two-Way Crossing · 20-wave campaign",
      }),
    ).toBeVisible();
    await canvas.scrollIntoViewIfNeeded();
    const bounds = await canvas.boundingBox();
    expect(bounds).toBeTruthy();
    const placed = playerPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/games/tower-defense/action") &&
        response.request().postDataJSON()?.action === "place",
    );
    await canvas.click({
      position: { x: (2.5 * bounds!.width) / 8, y: (2.5 * bounds!.height) / 5 },
    });
    expect((await placed).ok()).toBe(true);
    const simulated = playerPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/games/tower-defense/action") &&
        response.request().postDataJSON()?.action === "wave",
    );
    await playerPage
      .getByRole("button", { name: "Send wave 1", exact: true })
      .click();
    const waveResponse = await simulated;
    expect(waveResponse.ok()).toBe(true);
    expect((await waveResponse.json()).data.state.wave).toBe(1);
    const [entry] =
      await sql`SELECT score FROM game_season_entries WHERE season_id=${seasonId} AND user_id=${player.id}`;
    expect(Number(entry.score)).toBe(1);
    await playerPage.goto("/games/tower-defense");
    await playerPage
      .getByRole("button", { name: "Leaderboards", exact: true })
      .click();
    await playerPage
      .getByLabel("Competition season", { exact: true })
      .selectOption(seasonId);
    await expect(
      playerPage.getByRole("cell", {
        name: `${player.username} (you)`,
        exact: true,
      }),
    ).toBeVisible();

    await page
      .getByLabel("Season to finalize", { exact: true })
      .selectOption(seasonId);
    await page
      .getByRole("button", { name: "Preview season finalization", exact: true })
      .click();
    await expect(
      page.getByText(/This ends scoring before the scheduled deadline/),
    ).toBeVisible();
    await page
      .getByLabel("Season operation confirmation", { exact: true })
      .fill(`CLOSE SEASON ${slug}`);
    await page
      .getByLabel("Season operation reason", { exact: true })
      .fill("Browser finalized reward verification");
    await page
      .getByRole("button", { name: "Finalize confirmed season", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Standings finalized" }),
    ).toBeVisible();
    await playerPage
      .getByRole("button", { name: "Refresh seasons", exact: true })
      .click();
    await expect(
      playerPage.getByRole("button", {
        name: "Claim 100 Tell Coins",
        exact: true,
      }),
    ).toBeVisible();
    await playerPage
      .getByRole("button", { name: "Claim 100 Tell Coins", exact: true })
      .click();
    await expect(
      playerPage
        .getByRole("status")
        .filter({ hasText: "100 fictional Tell Coins claimed." }),
    ).toBeVisible();
    await playerPage.reload();
    await playerPage
      .getByRole("button", { name: "Leaderboards", exact: true })
      .click();
    await playerPage
      .getByLabel("Competition season", { exact: true })
      .selectOption(seasonId);
    await expect(
      playerPage.getByText("100 · claimed", { exact: true }),
    ).toBeVisible();
    await expect(
      playerPage.getByRole("button", { name: /Claim .* Tell Coins/ }),
    ).toHaveCount(0);
    const retry = await playerPage.request.post(
      `/api/seasons/${seasonId}/claim`,
      { headers: { Origin: origin }, data: {} },
    );
    expect(retry.ok()).toBe(true);
    expect((await retry.json()).data.claimedCoins).toBe(0);
    expect(
      await sql`SELECT r.standing_id FROM game_season_reward_receipts r JOIN game_season_standings s ON s.id=r.standing_id WHERE s.season_id=${seasonId} AND r.user_id=${player.id}`,
    ).toHaveLength(1);
    await playerPage.setViewportSize({ width: 375, height: 812 });
    expect(
      await playerPage.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375);
    expect(errors).toEqual([]);
    expect(playerErrors).toEqual([]);
  } finally {
    if (seasonId) await sql`DELETE FROM game_seasons WHERE id=${seasonId}`;
    await sql.end();
    await playerContext.close();
  }
});
