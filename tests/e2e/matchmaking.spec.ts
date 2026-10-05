import { test, expect, captureBrowserErrors } from "./fixtures";
import type { Page } from "@playwright/test";
import postgres from "postgres";
import Redis from "ioredis";
async function resume(page: Page) {
  await page.bringToFront();
  const paused = page.getByRole("button", { name: "Resume", exact: true });
  if (await paused.isVisible()) await paused.click();
}
async function cleanOwnRoom(code: string, userIds: string[]) {
  if (!code) return;
  const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
  const sql = postgres(
    process.env.DATABASE_URL ||
      "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
    { max: 1 },
  );
  try {
    await redis.del(
      `tell-aviv:lobby:${code}`,
      ...userIds.map((id) => `tell-aviv:user-lobby:${id}`),
    );
    await redis.zrem("tell-aviv:lobbies", code);
    await sql`DELETE FROM multiplayer_checkpoints WHERE namespace='tell-aviv' AND lobby_code=${code}`;
    await sql`DELETE FROM multiplayer_matches WHERE lobby_code=${code}`;
  } finally {
    await redis.quit();
    await sql.end();
  }
}
test("public matchmaking pairs two accounts, requires readiness, plays real turns and reconnects", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  const host = await accounts.signIn();
  const errors = captureBrowserErrors(page);
  const guestContext = await browser.newContext({ baseURL });
  let code = "",
    guestId = "";
  try {
    const partner = await guestContext.newPage();
    const guest = await accounts.signIn(partner);
    guestId = guest.id;
    const partnerErrors = captureBrowserErrors(partner);
    for (const player of [page, partner]) {
      await player.goto("/games/board-games/play");
      await expect(
        player.getByText("Realtime connected", { exact: true }),
      ).toBeVisible();
    }
    await page
      .getByRole("button", { name: "Join public matchmaking", exact: true })
      .click();
    await expect(
      page.getByText("Waiting for compatible players", { exact: true }),
    ).toBeVisible();
    await partner
      .getByRole("button", { name: "Join public matchmaking", exact: true })
      .click();
    await expect(
      partner.getByText(
        /^(Waiting for compatible players|Match found · ready check)$/,
      ),
    ).toBeVisible();
    const room = page.getByRole("heading", { name: /^Room [A-Z0-9]+$/ });
    await expect(room).toBeVisible({ timeout: 15000 });
    code = (await room.innerText()).replace("Room ", "");
    await expect(
      partner.getByRole("heading", { name: `Room ${code}`, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Start match", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: /ready/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ready", exact: true }).click();
    await partner.getByRole("button", { name: "Ready", exact: true }).click();
    await expect(
      partner.getByRole("button", { name: "Unready", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Start match", exact: true })
      .click();
    await expect(page.getByText("Your turn", { exact: true })).toBeVisible();
    await resume(page);
    await page
      .getByRole("button", { name: "Drop in column 1", exact: true })
      .click();
    await expect(partner.getByText("Your turn", { exact: true })).toBeVisible();
    await resume(partner);
    await partner
      .getByRole("button", { name: "Drop in column 2", exact: true })
      .click();
    await expect(page.getByText("Your turn", { exact: true })).toBeVisible();
    await partner.reload();
    await expect(
      partner.getByRole("heading", { name: `Room ${code}`, exact: true }),
    ).toBeVisible();
    await expect(partner.getByLabel("Player 1", { exact: true })).toHaveCount(
      1,
    );
    await expect(partner.getByLabel("Player 2", { exact: true })).toHaveCount(
      1,
    );
    for (let move = 2; move < 7; move++) {
      const player = move % 2 === 0 ? page : partner;
      await expect(
        player.getByText("Your turn", { exact: true }),
      ).toBeVisible();
      await resume(player);
      await player
        .getByRole("button", {
          name: `Drop in column ${move % 2 === 0 ? 1 : 2}`,
          exact: true,
        })
        .click();
    }
    await expect(
      page.getByText("Player 1 wins!", { exact: true }),
    ).toBeVisible();
    await expect(
      partner.getByText("Player 1 wins!", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Leave room", exact: true }).click();
    await partner
      .getByRole("button", { name: "Leave room", exact: true })
      .click();
    expect(errors).toEqual([]);
    expect(partnerErrors).toEqual([]);
  } finally {
    await cleanOwnRoom(code, [host.id, guestId].filter(Boolean));
    await guestContext.close();
  }
});
test("matchmaking pool selection is real and a declined ready room clears both clients", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  const host = await accounts.signIn();
  const context = await browser.newContext({ baseURL });
  let code = "",
    guestId = "";
  try {
    const partner = await context.newPage();
    const guest = await accounts.signIn(partner);
    guestId = guest.id;
    for (const player of [page, partner]) {
      await player.goto("/games/board-games/play");
      await expect(
        player.getByText("Realtime connected", { exact: true }),
      ).toBeVisible();
    }
    await page.getByLabel("Matchmaking player pool").selectOption("europe");
    await partner
      .getByLabel("Matchmaking player pool")
      .selectOption("americas");
    await page
      .getByRole("button", { name: "Join public matchmaking", exact: true })
      .click();
    await partner
      .getByRole("button", { name: "Join public matchmaking", exact: true })
      .click();
    await expect(
      page.getByText("Waiting for compatible players", { exact: true }),
    ).toBeVisible();
    await expect(
      partner.getByText("Waiting for compatible players", { exact: true }),
    ).toBeVisible();
    await partner
      .getByRole("button", { name: "Leave matchmaking", exact: true })
      .click();
    await expect(
      partner.getByRole("button", {
        name: "Join public matchmaking",
        exact: true,
      }),
    ).toBeVisible();
    await partner.getByLabel("Matchmaking player pool").selectOption("europe");
    await partner
      .getByRole("button", { name: "Join public matchmaking", exact: true })
      .click();
    const room = page.getByRole("heading", { name: /^Room [A-Z0-9]+$/ });
    await expect(room).toBeVisible();
    code = (await room.innerText()).replace("Room ", "");
    await expect(
      partner.getByRole("button", {
        name: "Decline matched room",
        exact: true,
      }),
    ).toBeVisible();
    await partner
      .getByRole("button", { name: "Decline matched room", exact: true })
      .click();
    for (const player of [page, partner]) {
      await expect(
        player.getByRole("button", {
          name: "Join public matchmaking",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        player.getByRole("heading", { name: `Room ${code}`, exact: true }),
      ).toHaveCount(0);
    }
  } finally {
    await cleanOwnRoom(code, [host.id, guestId].filter(Boolean));
    await context.close();
  }
});
