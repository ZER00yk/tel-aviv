import type { Page, Locator } from "@playwright/test";
import { test, expect, captureBrowserErrors } from "./fixtures";

async function action<T>(
  page: Page,
  game: string,
  button: Locator,
  expectedAction: string,
): Promise<T> {
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/games/${game}/action`) &&
      response.request().method() === "POST" &&
      (response.request().postDataJSON() as { action?: string }).action ===
        expectedAction,
  );
  await button.click();
  const response = await pending;
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { data: { state: T } }).data.state;
}

test("Signal Foundry captures a server-verified spark and persists after reload", async ({
  page,
  accounts,
}) => {
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  await page.goto("/games/incremental/play");
  const button = page.getByRole("button", { name: "Capture a spark" });
  await expect(button).toBeVisible();
  const state = await action<{ spark: number }>(
    page,
    "incremental",
    button,
    "tap",
  );
  expect(state.spark).toBeGreaterThanOrEqual(1);
  await page.reload();
  await expect(
    page
      .locator(".game-stat")
      .filter({ has: page.getByText("Spark", { exact: true }) })
      .locator("strong"),
  ).not.toHaveText("0");
  expect(errors).toEqual([]);
});

test("Neon Defense places a tower on the canvas and simulates a wave", async ({
  page,
  accounts,
}) => {
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  await page.goto("/games/tower-defense/play");
  const canvas = page.locator(".game-canvas canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByRole("button", { name: /Send wave 1/ })).toBeEnabled();
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/games/tower-defense/action") &&
      response.request().method() === "POST" &&
      (response.request().postDataJSON() as { action?: string }).action ===
        "place",
  );
  await canvas.click({
    position: { x: bounds!.width / 16, y: bounds!.height * 0.3 },
  });
  const response = await pending;
  expect(response.ok(), await response.text()).toBe(true);
  const state = (
    (await response.json()) as { data: { state: { towers: unknown[] } } }
  ).data.state;
  expect(state.towers).toHaveLength(1);
  const wave = await action<{ wave: number; kills: number }>(
    page,
    "tower-defense",
    page.getByRole("button", { name: /Send wave 1/ }),
    "wave",
  );
  expect(wave.wave).toBe(1);
  expect(wave.kills).toBeGreaterThan(0);
  await expect(page.getByText(/Last wave:.*defeated/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("After Hours solo trivia answers and drawing canvas work", async ({
  page,
  accounts,
}) => {
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  await page.goto("/games/party-games/play");
  await page.getByRole("button", { name: "Trivia", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Which planet has the most visible rings?",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Saturn", exact: true }).click();
  await expect(page.getByText("Correct!", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A hexagon has how many sides?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Drawing", exact: true }).click();
  const canvas = page.locator(".game-body canvas");
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds!.x + 50, bounds!.y + 50);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 180, bounds!.y + 90, { steps: 8 });
  await page.mouse.up();
  expect(
    await canvas.evaluate((element) =>
      [
        ...(element as HTMLCanvasElement)
          .getContext("2d")!
          .getImageData(0, 0, 600, 400).data,
      ].some((channel) => channel > 0),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Clear canvas" }).click();
  expect(errors).toEqual([]);
});

test("Velvet Casino deals poker and resolves Plinko using server results", async ({
  page,
  accounts,
}) => {
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  await page.goto("/games/casino/play");
  await page.getByRole("button", { name: "Poker", exact: true }).click();
  const poker = await action<{
    poker: { playerCards: number[]; phase: string };
    credits: number;
  }>(
    page,
    "casino",
    page.getByRole("button", { name: "New hand", exact: true }),
    "poker.start",
  );
  expect(poker.poker.playerCards).toHaveLength(2);
  expect(poker.poker.phase).toBe("playing");
  const folded = await action<{ rounds: number }>(
    page,
    "casino",
    page.getByRole("button", { name: "Fold", exact: true }),
    "poker.fold",
  );
  expect(folded.rounds).toBe(1);
  await page.getByRole("button", { name: "Plinko", exact: true }).click();
  const dropped = await action<{
    rounds: number;
    lastResult: { path: number[]; slot: number };
  }>(
    page,
    "casino",
    page.getByRole("button", { name: "Drop ball", exact: true }),
    "plinko",
  );
  expect(dropped.rounds).toBe(2);
  expect(dropped.lastResult.path).toHaveLength(8);
  expect(dropped.lastResult.slot).toBeGreaterThanOrEqual(0);
  await expect(
    page.getByRole("img", {
      name: "Plinko board and the most recent ball path",
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Empire Exchange opens a business and serves customers", async ({
  page,
  accounts,
}) => {
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  await page.goto("/games/tycoon/play");
  const opened = await action<{ businesses: { kind: string }[] }>(
    page,
    "tycoon",
    page.getByRole("button", { name: "Open kiosk", exact: true }),
    "open",
  );
  expect(opened.businesses).toHaveLength(1);
  expect(opened.businesses[0].kind).toBe("kiosk");
  const served = await action<{ totalEarned: number }>(
    page,
    "tycoon",
    page.getByRole("button", { name: "Serve customers", exact: true }),
    "operate",
  );
  expect(served.totalEarned).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("Paper Odyssey begins combat and plays a card", async ({
  page,
  accounts,
}) => {
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  await page.goto("/games/deck-roguelike/play");
  await action(
    page,
    "deck-roguelike",
    page.getByRole("button", { name: "New expedition", exact: true }),
    "start",
  );
  const combat = await action<{
    phase: string;
    energy: number;
    hand: string[];
  }>(
    page,
    "deck-roguelike",
    page.getByRole("button", { name: /Battle/, exact: false }),
    "choose",
  );
  expect(combat.phase).toBe("combat");
  const played = await action<{ hand: string[]; energy: number }>(
    page,
    "deck-roguelike",
    page.getByRole("button", { name: /1 ENERGY.*Play card/ }).first(),
    "play",
  );
  expect(played.hand).not.toEqual(combat.hand);
  expect(played.energy).toBeLessThan(combat.energy);
  await expect(page.getByRole("button", { name: /End turn/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Ego Trip renders combat, pauses and saves a checkpoint", async ({
  page,
  accounts,
}) => {
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  await page.goto("/games/ego-trip/play");
  await expect(page.locator(".game-canvas canvas")).toBeVisible();
  await page.keyboard.press("Shift");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save checkpoint" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Run saved to cloud." }),
  ).toBeVisible();
  const response = await page.request.get("/api/games/ego-trip/save");
  expect(response.ok()).toBe(true);
  const { data } = (await response.json()) as {
    data: { data: { checkpoint: { player: { hp: number } } } };
  };
  expect(data.data.checkpoint.player.hp).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("Loose Parts places physics bodies and restores a cloud scene", async ({
  page,
  accounts,
}) => {
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  await page.goto("/games/physics-sandbox/play");
  const canvas = page.locator(".game-canvas canvas");
  await expect(canvas).toBeVisible();
  await canvas.click({ position: { x: 100, y: 50 } });
  await expect(page.getByText("1 / 150 bodies", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save cloud scene" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Workshop saved to cloud." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear workshop" }).click();
  await expect(page.getByText("0 / 150 bodies", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore cloud scene" }).click();
  await expect(page.getByText("1 / 150 bodies", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Night Shift starts a real four-player private lobby with private roles", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  const contexts = await Promise.all(
    Array.from({ length: 3 }, () => browser.newContext({ baseURL })),
  );
  try {
    const others = await Promise.all(
      contexts.map((context) => context.newPage()),
    );
    for (const other of others) {
      await accounts.signIn(other, "crew");
      await other.goto("/games/social-deduction/play");
    }
    await page.goto("/games/social-deduction/play");
    await expect(
      page.getByText("Realtime connected", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create private room" }).click();
    const heading = page.getByRole("heading", { name: /^Room [A-Z0-9]+$/ });
    await expect(heading).toBeVisible();
    const code = (await heading.innerText()).replace("Room ", "");
    for (const other of others) {
      await other.getByLabel("Room code").fill(code);
      await other.getByRole("button", { name: "Join", exact: true }).click();
      await expect(
        other.getByRole("heading", { name: `Room ${code}`, exact: true }),
      ).toBeVisible();
      await other.getByRole("button", { name: "Ready", exact: true }).click();
    }
    await page.getByRole("button", { name: "Ready", exact: true }).click();
    await page
      .getByRole("button", { name: "Start match", exact: true })
      .click();
    for (const player of [page, ...others]) {
      await expect(
        player.getByText("Your private role", { exact: true }),
      ).toBeVisible();
      await expect(player.getByLabel("Station map")).toBeVisible();
      await expect(
        player
          .locator(".game-stat")
          .filter({
            has: player.getByText("Your private role", { exact: true }),
          })
          .locator("strong"),
      ).toHaveText(/crew|hostile/);
      await expect(
        player.getByText("Your private role", { exact: true }),
      ).toHaveCount(1);
    }
    expect(errors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
  }
});

test("Four in a Row plays a local winning sequence and saves victories", async ({
  page,
  accounts,
}) => {
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  await page.goto("/games/board-games/play");
  await page.getByLabel("Local opponent").selectOption("friend");
  for (const column of [1, 2, 1, 2, 1, 2, 1])
    await page
      .getByRole("button", { name: `Drop in column ${column}`, exact: true })
      .click();
  await expect(page.getByText("Player 1 wins!", { exact: true })).toBeVisible();
  await expect(page.getByText(/Saved local victories: 1/)).toBeVisible();
  const response = await page.request.get("/api/games/board-games/save");
  expect(response.ok()).toBe(true);
  const { data } = (await response.json()) as {
    data: { data: { wins: number } };
  };
  expect(data.data.wins).toBe(1);
  expect(errors).toEqual([]);
});
