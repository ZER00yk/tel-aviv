import { test, expect, captureBrowserErrors } from "./fixtures";
import type { TowerState } from "../../games/server/tower";

test("Neon Defense HTTP progression separates campaign maps and Endless scores", async ({
  page,
  accounts,
  baseURL,
}) => {
  const account = await accounts.signIn(page, "neoncat");
  const act = async (action: string, payload: Record<string, unknown> = {}) => {
    const response = await page.request.post(
      "/api/games/tower-defense/action",
      {
        data: { action, payload },
        headers: { Origin: new URL(baseURL || "http://localhost:3000").origin },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    const result = (await response.json()).data as {
      state: TowerState;
      authoritative: boolean;
      achievements: string[];
    };
    expect(result.authoritative).toBe(true);
    expect(result.achievements).not.toContain("tower-clear");
    return result.state;
  };
  for (const configuration of [
    { category: "default", payload: {}, x: 3, y: 1 },
    {
      category: "switchback",
      payload: { map: "switchback", mode: "campaign" },
      x: 4,
      y: 2,
    },
    {
      category: "crossroads",
      payload: { map: "crossroads", mode: "campaign" },
      x: 2,
      y: 2,
    },
    {
      category: "endless",
      payload: { map: "crossroads", mode: "endless" },
      x: 2,
      y: 2,
    },
  ]) {
    await act("start", configuration.payload);
    await act("place", {
      kind: "rapid",
      x: configuration.x,
      y: configuration.y,
    });
    const state = await act("wave", { score: 999999, phase: "won" });
    expect(state.wave).toBe(1);
    expect(state.phase).toBe("build");
    const response = await page.request.get(
      `/api/games/tower-defense/leaderboard?category=${configuration.category}&period=all&scope=friends`,
    );
    expect(response.ok()).toBe(true);
    const leaderboard = (await response.json()).data;
    expect(leaderboard.category).toBe(configuration.category);
    expect(
      leaderboard.entries.find(
        (entry: { userId: string }) => entry.userId === account.id,
      ),
    ).toMatchObject({ score: 1 });
  }
});

test("Neon Defense plays a split-route endless map, validates path tiles and persists targeting and authoritative replay", async ({
  page,
  accounts,
}) => {
  const account = await accounts.signIn(page, "neonmaps");
  const errors = captureBrowserErrors(page);
  await page.goto("/games/tower-defense/play");
  const canvas = page.locator(".game-canvas canvas");
  await expect(canvas).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /City Boulevard/ }),
  ).toBeVisible();
  await page
    .getByLabel("Defense map", { exact: true })
    .selectOption("crossroads");
  await page
    .getByLabel("Defense mode", { exact: true })
    .selectOption("endless");
  const restarting = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/games/tower-defense/action") &&
      response.request().postDataJSON()?.action === "start",
  );
  await page.getByRole("button", { name: "New defense", exact: true }).click();
  expect((await restarting).ok()).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Two-Way Crossing · Endless defense" }),
  ).toBeVisible();
  const clickTile = async (x: number, y: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.click(
      box!.x + ((x + 0.5) * box!.width) / 8,
      box!.y + ((y + 0.5) * box!.height) / 5,
    );
  };
  await clickTile(3, 2);
  await expect(
    page.getByRole("alert").filter({ hasText: /away from this map's path/ }),
  ).toBeVisible();
  const placed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/games/tower-defense/action") &&
      response.request().postDataJSON()?.action === "place" &&
      response.ok(),
  );
  await clickTile(2, 2);
  await placed;
  await clickTile(2, 2);
  await expect(
    page.getByLabel("Target priority", { exact: true }),
  ).toBeVisible();
  const targeting = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/games/tower-defense/action") &&
      response.request().postDataJSON()?.action === "target",
  );
  await page
    .getByLabel("Target priority", { exact: true })
    .selectOption("support");
  expect((await targeting).ok()).toBe(true);
  const sent = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/games/tower-defense/action") &&
      response.request().postDataJSON()?.action === "wave",
  );
  await page.getByRole("button", { name: "Send wave 1", exact: true }).click();
  const response = await sent;
  expect(response.ok()).toBe(true);
  const state = (await response.json()).data.state;
  expect(state.map).toBe("crossroads");
  expect(state.mode).toBe("endless");
  expect(state.towers[0].target).toBe("support");
  expect(state.lastWave.kills + state.lastWave.leaks).toBe(6);
  expect(
    new Set(
      state.lastWave.enemies.map((enemy: { route: number }) => enemy.route),
    ).size,
  ).toBe(2);
  expect(
    state.lastWave.events.some(
      (event: { type: string; y: number }) =>
        event.type === "shot" && event.y !== 2,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Skip replay", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip replay", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Send wave 2", exact: true }),
  ).toBeEnabled();
  await page.getByText("Build combinations", { exact: true }).click();
  await expect(page.getByText("Cryo shatter:", { exact: true })).toBeVisible();
  const leaderboard = await page.request.get(
    "/api/games/tower-defense/leaderboard?category=endless&period=all&scope=friends",
  );
  expect(leaderboard.ok()).toBe(true);
  const endless = (await leaderboard.json()).data;
  expect(endless).toMatchObject({ ranked: true, category: "endless" });
  expect(
    endless.entries.find(
      (entry: { userId: string }) => entry.userId === account.id,
    ),
  ).toMatchObject({ score: 1 });
  for (const category of ["default", "crossroads", "switchback"]) {
    const result = await page.request.get(
      `/api/games/tower-defense/leaderboard?category=${category}&period=all&scope=friends`,
    );
    expect(result.ok()).toBe(true);
    expect(
      (await result.json()).data.entries.some(
        (entry: { userId: string; score: number }) =>
          entry.userId === account.id && entry.score > 0,
      ),
    ).toBe(false);
  }
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Two-Way Crossing · Endless defense" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
