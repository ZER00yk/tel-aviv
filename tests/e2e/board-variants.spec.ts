import { test, expect, captureBrowserErrors } from "./fixtures";
import Redis from "ioredis";
import postgres from "postgres";
import type { Page } from "@playwright/test";
async function resume(page: Page) {
  await page.bringToFront();
  const button = page.getByRole("button", { name: "Resume", exact: true });
  if (await button.isVisible()) await button.click();
}
async function move(page: Page, from: string, to: string) {
  await resume(page);
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}
for (const variant of ["checkers", "chess"] as const)
  test(`two accounts play authoritative ${variant} in the reusable board host`, async ({
    page,
    browser,
    accounts,
    baseURL,
  }) => {
    test.setTimeout(75_000);
    const host = await accounts.signIn(page, "board"),
      context = await browser.newContext({ baseURL }),
      redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
    let code = "",
      guestId = "";
    const errors = captureBrowserErrors(page);
    try {
      const partner = await context.newPage(),
        guest = await accounts.signIn(partner, "board");
      guestId = guest.id;
      const guestErrors = captureBrowserErrors(partner);
      for (const player of [page, partner]) {
        await player.goto("/games/board-games/play");
        await player
          .getByLabel("Board game", { exact: true })
          .selectOption(variant);
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
      await expect(page.getByTestId("board-game-status")).toHaveText(
        "Your turn",
      );
      await expect(partner.getByTestId("board-game-status")).toHaveText(
        "Waiting for opponent",
      );
      if (variant === "checkers") {
        await move(page, "c3", "d4");
        await expect(partner.locator('[data-square="d4"]')).toHaveAttribute(
          "data-side",
          "1",
        );
        await move(partner, "b6", "c5");
        await move(page, "d4", "b6");
        for (const player of [page, partner])
          await expect(player.locator('[data-square="c5"]')).toHaveAttribute(
            "data-piece",
            "",
          );
        await partner.reload();
        await expect(
          partner.getByRole("heading", { name: `Room ${code}`, exact: true }),
        ).toBeVisible();
        await expect(
          partner.getByLabel("Board game", { exact: true }),
        ).toHaveValue("checkers");
        await expect(partner.locator('[data-square="b6"]')).toHaveAttribute(
          "data-side",
          "1",
        );
        await resume(partner);
        await partner
          .getByRole("button", { name: "Resign game", exact: true })
          .click();
        for (const player of [page, partner])
          await expect(player.getByTestId("board-game-status")).toContainText(
            `${host.username} wins — Opponent resigned`,
          );
      } else {
        await move(page, "f2", "f3");
        await move(partner, "e7", "e5");
        await move(page, "g2", "g4");
        await move(partner, "d8", "h4");
        for (const player of [page, partner]) {
          await expect(player.getByTestId("board-game-status")).toContainText(
            `${guest.username} wins — Checkmate`,
          );
          await expect(player.locator('[data-square="h4"]')).toHaveAttribute(
            "data-piece",
            "q",
          );
        }
      }
      await page
        .getByRole("button", { name: "Leave room", exact: true })
        .click();
      await partner
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
