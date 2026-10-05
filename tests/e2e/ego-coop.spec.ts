import { test, expect, captureBrowserErrors } from "./fixtures";
import type { Page } from "@playwright/test";
import postgres from "postgres";
import Redis from "ioredis";

async function resume(page: Page) {
  await page.bringToFront();
  const button = page.getByRole("button", { name: "Resume", exact: true });
  if (await button.isVisible()) await button.click();
}

test("Ego Trip two-account co-op shares movement, server damage and recoverable membership", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const host = await accounts.signIn();
  const errors = captureBrowserErrors(page);
  const context = await browser.newContext({ baseURL });
  let code = "";
  let guestId = "";
  try {
    const partner = await context.newPage();
    const guest = await accounts.signIn(partner, "coop");
    guestId = guest.id;
    const guestErrors = captureBrowserErrors(partner);
    for (const player of [page, partner]) {
      await player.goto("/games/ego-trip/play");
      await player
        .getByRole("button", { name: "Private co-op", exact: true })
        .click();
      await expect(
        player.getByText("Realtime connected", { exact: true }),
      ).toBeVisible();
    }
    await page
      .getByRole("button", { name: "Create private room", exact: true })
      .click();
    const heading = page.getByRole("heading", { name: /^Room [A-Z0-9]+$/ });
    await expect(heading).toBeVisible();
    code = (await heading.innerText()).replace("Room ", "");
    await partner.getByLabel("Room code").fill(code);
    await partner.getByRole("button", { name: "Join", exact: true }).click();
    await expect(
      partner.getByRole("heading", { name: `Room ${code}`, exact: true }),
    ).toBeVisible();
    await partner.getByRole("button", { name: "Ready", exact: true }).click();
    await page.getByRole("button", { name: "Ready", exact: true }).click();
    await page
      .getByRole("button", { name: "Start match", exact: true })
      .click();
    for (const player of [page, partner]) {
      await expect(player.getByLabel("Co-op combat arena")).toBeVisible();
      await expect(
        player.getByLabel("Co-op player positions").locator("li"),
      ).toHaveCount(2);
      await expect(player.getByTestId("coop-boss-health")).toHaveText(
        "578 / 578",
      );
    }
    await resume(partner);
    await partner
      .getByRole("button", { name: "Start sustained fire", exact: true })
      .click();
    await expect(
      partner.locator(`[data-player-id="${guest.id}"]`),
    ).toContainText(/damage [1-9]\d*/);
    await partner
      .getByRole("button", { name: "Stop sustained fire", exact: true })
      .click();
    await resume(page);
    // Gameplay keys belong to the arena. A focused toolbar button keeps its
    // native keyboard behavior and must not capture movement or dash input.
    await page.getByLabel("Co-op combat arena", { exact: true }).focus();
    const before = await page.getByTestId("coop-player-position-0").innerText();
    await page.keyboard.down("d");
    await page.keyboard.down("Shift");
    await expect(page.getByTestId("coop-player-position-0")).not.toHaveText(
      before,
    );
    await page.keyboard.up("Shift");
    await page.keyboard.up("d");
    await page
      .getByRole("button", { name: "Start sustained fire", exact: true })
      .click();
    await expect(page.locator(`[data-player-id="${host.id}"]`)).toContainText(
      /damage [1-9]\d*/,
    );
    await expect(
      partner.locator(`[data-player-id="${host.id}"]`),
    ).toContainText(/damage [1-9]\d*/);
    await page
      .getByRole("button", { name: "Stop sustained fire", exact: true })
      .click();
    await partner.reload();
    await partner
      .getByRole("button", { name: "Private co-op", exact: true })
      .click();
    await expect(
      partner.getByRole("heading", { name: `Room ${code}`, exact: true }),
    ).toBeVisible();
    await expect(
      partner.getByLabel("Co-op player positions").locator("li"),
    ).toHaveCount(2);
    await page.getByRole("button", { name: "Leave room", exact: true }).click();
    await expect(
      partner.getByRole("heading", { name: "Expedition ended", exact: true }),
    ).toBeVisible();
    await expect(
      partner.getByText("A player left the match", { exact: true }),
    ).toBeVisible();
    await partner
      .getByRole("button", { name: "Leave room", exact: true })
      .click();
    expect(errors).toEqual([]);
    expect(guestErrors).toEqual([]);
  } finally {
    // The code was created by this test; other matches are never touched.
    if (code) {
      const redis = new Redis(
        process.env.REDIS_URL || "redis://127.0.0.1:6379",
      );
      try {
        await redis.del(
          `tell-aviv:lobby:${code}`,
          `tell-aviv:user-lobby:${host.id}`,
          `tell-aviv:user-lobby:${guestId}`,
        );
        await redis.zrem("tell-aviv:lobbies", code);
      } finally {
        await redis.quit();
      }
      const sql = postgres(
        process.env.DATABASE_URL ||
          "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
        { max: 1 },
      );
      try {
        await sql`DELETE FROM multiplayer_matches WHERE lobby_code=${code}`;
      } finally {
        await sql.end();
      }
    }
    await context.close();
  }
});
