import { test, expect, captureBrowserErrors } from "./fixtures";
import Redis from "ioredis";
import postgres from "postgres";
import type { CoopState } from "../../games/ego-trip/coop-engine";

test("two-account campaign shares canonical combat, route votes and private rewards across reload", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const host = await accounts.signIn(page, "coopcam"),
    context = await browser.newContext({ baseURL });
  const errors = captureBrowserErrors(page);
  const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  let code = "",
    guestId = "";
  try {
    const guestPage = await context.newPage(),
      guest = await accounts.signIn(guestPage, "coopcam");
    guestId = guest.id;
    const guestErrors = captureBrowserErrors(guestPage);
    for (const player of [page, guestPage]) {
      await player.goto("/games/ego-trip/play");
      await player
        .getByRole("button", { name: "Private co-op", exact: true })
        .click();
      await expect(
        player.getByText("Realtime connected", { exact: true }),
      ).toBeVisible();
    }
    await page.getByLabel("Co-op expedition mode").selectOption("campaign");
    await page
      .getByRole("button", { name: "Create private room", exact: true })
      .click();
    const heading = page.getByRole("heading", { name: /^Room [A-Z0-9]+$/ });
    await expect(heading).toBeVisible();
    code = (await heading.innerText()).replace("Room ", "");
    await guestPage.getByLabel("Room code").fill(code);
    await guestPage.getByRole("button", { name: "Join", exact: true }).click();
    await expect(
      guestPage.getByRole("heading", { name: `Room ${code}`, exact: true }),
    ).toBeVisible();
    await guestPage.getByRole("button", { name: "Ready", exact: true }).click();
    await page.getByRole("button", { name: "Ready", exact: true }).click();
    await page
      .getByRole("button", { name: "Start match", exact: true })
      .click();
    for (const player of [page, guestPage]) {
      await expect(player.getByText(/Shared room 1 \/ 40/)).toBeVisible();
      await expect(
        player.getByLabel("Co-op player positions").locator("li"),
      ).toHaveCount(2);
    }
    await page.bringToFront();
    const resume = page.getByRole("button", { name: "Resume", exact: true });
    if (await resume.isVisible()) await resume.click();
    await page
      .getByRole("button", { name: "Start sustained fire", exact: true })
      .click();
    await expect(page.locator(`[data-player-id="${host.id}"]`)).toContainText(
      /damage [1-9]\d*/,
    );
    await expect(
      guestPage.locator(`[data-player-id="${host.id}"]`),
    ).toContainText(/damage [1-9]\d*/);
    await page
      .getByRole("button", { name: "Stop sustained fire", exact: true })
      .click();
    // Preserve compact saved-campaign compatibility coverage. The separate
    // ego-coop-journey spec exercises new mission/carrier progress without
    // rewriting the new journey markers.
    const fixture = JSON.parse(
      (await redis.get(`tell-aviv:lobby:${code}`))!,
    ) as { state: CoopState };
    delete fixture.state.campaign!.pacingVersion;
    delete fixture.state.campaign!.journey;
    delete fixture.state.campaign!.objective;
    for (const enemy of fixture.state.campaign!.enemies) enemy.hp = 0;
    await redis.set(
      `tell-aviv:lobby:${code}`,
      JSON.stringify(fixture),
      "EX",
      3600,
    );
    await expect(
      page.getByRole("heading", { name: "Encounter cleared", exact: true }),
    ).toBeVisible();
    for (const player of [page, guestPage])
      await player
        .getByRole("button", { name: "Continue expedition", exact: true })
        .click();
    for (const player of [page, guestPage])
      await expect(
        player.getByRole("heading", {
          name: "Choose the shared route",
          exact: true,
        }),
      ).toBeVisible();
    await page
      .getByRole("button", { name: "Vote treasure", exact: true })
      .click();
    await expect(
      guestPage.getByText("1 votes received", { exact: true }),
    ).toBeVisible();
    await guestPage
      .getByRole("button", { name: "Vote treasure", exact: true })
      .click();
    await expect(page.getByText(/Shared room 2 \/ 40/)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Expedition rest stop", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Choose Signal companion (0/4)",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Choose Signal companion (1/4)",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      guestPage.getByRole("button", {
        name: "Choose Signal companion (0/4)",
        exact: true,
      }),
    ).toBeEnabled();
    await guestPage
      .getByRole("button", { name: "Choose Margin shield (0/4)", exact: true })
      .click();
    await guestPage.reload();
    await guestPage
      .getByRole("button", { name: "Private co-op", exact: true })
      .click();
    await expect(
      guestPage.getByRole("heading", { name: `Room ${code}`, exact: true }),
    ).toBeVisible();
    await expect(
      guestPage.getByRole("button", {
        name: "Choose Margin shield (1/4)",
        exact: true,
      }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Leave room", exact: true }).click();
    await expect(
      guestPage.getByRole("button", { name: "Start match", exact: true }),
    ).toBeVisible();
    await expect(guestPage.getByText(/Shared room 2 \/ 40/)).toBeVisible();
    await guestPage
      .getByRole("button", { name: "Leave room", exact: true })
      .click();
    expect(errors).toEqual([]);
    expect(guestErrors).toEqual([]);
  } finally {
    if (code) {
      await redis.del(
        `tell-aviv:lobby:${code}`,
        `tell-aviv:user-lobby:${host.id}`,
        `tell-aviv:user-lobby:${guestId}`,
      );
      await redis.zrem("tell-aviv:lobbies", code);
      const sql = postgres(
        process.env.DATABASE_URL ??
          "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
        { max: 1 },
      );
      try {
        await sql`DELETE FROM multiplayer_checkpoints WHERE namespace='tell-aviv' AND lobby_code=${code}`;
        await sql`DELETE FROM multiplayer_matches WHERE lobby_code=${code}`;
      } finally {
        await sql.end();
      }
    }
    await redis.quit();
    await context.close();
  }
});
