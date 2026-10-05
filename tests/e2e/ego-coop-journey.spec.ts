import Redis from "ioredis";
import postgres from "postgres";
import { test, expect, captureBrowserErrors } from "./fixtures";
import type { Page } from "@playwright/test";
import type { CoopState } from "../../games/ego-trip/coop-engine";

test("two-account journey uses real movement for shared pickup and delivery and preserves the carrier across reload", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  test.setTimeout(120000);
  const host = await accounts.signIn(page, "coopjourney");
  const context = await browser.newContext({ baseURL });
  const guestPage = await context.newPage();
  const guest = await accounts.signIn(guestPage, "coopjourney");
  const errors = captureBrowserErrors(page);
  const guestErrors = captureBrowserErrors(guestPage);
  const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  let code = "";
  const readState = async () =>
    (
      JSON.parse((await redis.get(`tell-aviv:lobby:${code}`))!) as {
        state: CoopState;
      }
    ).state;
  const walkTo = async (
    player: Page,
    playerId: string,
    target: { x: number; y: number },
  ) => {
    await player.bringToFront();
    const resume = player.getByRole("button", { name: "Resume", exact: true });
    if (await resume.isVisible()) await resume.click();
    await player.getByLabel("Co-op combat arena").focus();
    const held = new Set<string>();
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        const position = (await readState()).players[playerId];
        if (Math.hypot(target.x - position.x, target.y - position.y) < 25)
          return;
        const wanted = new Set<string>();
        if (Math.abs(target.x - position.x) > 13)
          wanted.add(target.x > position.x ? "d" : "a");
        if (Math.abs(target.y - position.y) > 13)
          wanted.add(target.y > position.y ? "s" : "w");
        for (const key of held)
          if (!wanted.has(key)) {
            await player.keyboard.up(key);
            held.delete(key);
          }
        for (const key of wanted)
          if (!held.has(key)) {
            await player.keyboard.down(key);
            held.add(key);
          }
        await player.waitForTimeout(120);
      }
      throw new Error(
        "Journey marker was not reachable using ordinary movement",
      );
    } finally {
      for (const key of held) await player.keyboard.up(key);
    }
  };
  try {
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
    for (const player of [page, guestPage])
      await player.getByRole("button", { name: "Ready", exact: true }).click();
    await page
      .getByRole("button", { name: "Start match", exact: true })
      .click();
    for (const player of [page, guestPage])
      await expect(player.getByTestId("coop-journey-progress")).toContainText(
        "Mission 1 / 3",
      );
    expect((await readState()).campaign!.pacingVersion).toBe(1);
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
    // Defeat the complete patrol through the same keyboard/fire controls a
    // player uses. Redis reads observe only this test's canonical room; no HP,
    // invulnerability, elapsed time or mission marker is rewritten.
    await page.getByLabel("Co-op combat arena").focus();
    const patrolCorners = [
      { x: 820, y: 480 },
      { x: 820, y: 80 },
      { x: 90, y: 80 },
      { x: 90, y: 480 },
    ];
    let corner = 0;
    const held = new Set<string>();
    try {
      for (let attempt = 0; attempt < 350; attempt++) {
        const state = await readState();
        if (state.campaign!.objective) break;
        expect(state.stage).toBe("fight");
        const position = state.players[host.id];
        expect(position.status).toBe("alive");
        if (
          Math.hypot(
            patrolCorners[corner].x - position.x,
            patrolCorners[corner].y - position.y,
          ) < 45
        )
          corner = (corner + 1) % 4;
        const goal = patrolCorners[corner];
        const wanted = new Set<string>(["Shift"]);
        if (Math.abs(goal.x - position.x) > 20)
          wanted.add(goal.x > position.x ? "d" : "a");
        if (Math.abs(goal.y - position.y) > 20)
          wanted.add(goal.y > position.y ? "s" : "w");
        for (const key of held)
          if (!wanted.has(key)) {
            await page.keyboard.up(key);
            held.delete(key);
          }
        for (const key of wanted)
          if (!held.has(key)) {
            await page.keyboard.down(key);
            held.add(key);
          }
        await page.waitForTimeout(120);
      }
    } finally {
      for (const key of held) await page.keyboard.up(key);
    }
    expect((await readState()).campaign!.enemies).toHaveLength(0);
    await page
      .getByRole("button", { name: "Stop sustained fire", exact: true })
      .click();
    await expect(page.getByTestId("coop-journey-objective")).toContainText(
      "0 / 4 checkpoints",
    );
    await walkTo(page, host.id, (await readState()).campaign!.objective!);
    for (const player of [page, guestPage]) {
      await expect(player.getByTestId("coop-journey-objective")).toContainText(
        "1 / 4 checkpoints",
      );
      await expect(player.getByTestId("coop-journey-objective")).toContainText(
        "Carry the signal",
      );
    }
    await guestPage.reload();
    await guestPage
      .getByRole("button", { name: "Private co-op", exact: true })
      .click();
    await expect(guestPage.getByTestId("coop-journey-objective")).toContainText(
      "1 / 4 checkpoints",
    );
    expect((await readState()).campaign!.objective!.carrierId).toBe(host.id);
    await walkTo(page, host.id, (await readState()).campaign!.objective!);
    for (const player of [page, guestPage])
      await expect(player.getByTestId("coop-journey-objective")).toContainText(
        "2 / 4 checkpoints",
      );
    const state = await readState();
    expect(state.campaign!.journey!.stage).toBe(1);
    expect(state.campaign!.objective!.carrying).toBe(false);
    await page.getByRole("button", { name: "Leave room", exact: true }).click();
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
        `tell-aviv:user-lobby:${guest.id}`,
      );
      await redis.zrem("tell-aviv:lobbies", code);
      const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
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
