import { test, expect, captureBrowserErrors } from "./fixtures";
import { newCampaignWorld, stepWorld } from "../../games/ego-trip/engine";
import { initialSave } from "../../games/ego-trip/checkpoint";
import { mods } from "../../games/ego-trip/content";

test("Ego Trip restores a mod choice, enters a route, and retains the seeded campaign", async ({
  page,
  accounts,
  baseURL,
}) => {
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  // This historical compact checkpoint seeds an already-cleared encounter;
  // the active mission campaign is exercised without progress rewrites elsewhere.
  const world = newCampaignWorld("pulse", 9041, { pacingVersion: null });
  for (const enemy of world.enemies) enemy.hp = 0;
  stepWorld(
    world,
    {
      x: 0,
      y: 0,
      aimX: 450,
      aimY: 170,
      attack: false,
      alternate: false,
      dash: false,
    },
    0.02,
  );
  const seedSave = await page.request.post("/api/games/ego-trip/save", {
    data: { schemaVersion: 1, data: { ...initialSave, checkpoint: world } },
    headers: { Origin: new URL(baseURL || "http://localhost:3000").origin },
  });
  expect(seedSave.ok(), await seedSave.text()).toBe(true);
  await page.goto("/games/ego-trip/play");
  await expect(
    page.getByRole("heading", { name: "Choose one build mod" }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: new RegExp(mods.find((mod) => mod.id === world.offered[0])!.name),
    })
    .click();
  const routeSection = page
    .locator(".game-card")
    .filter({ has: page.getByRole("heading", { name: "Choose your route" }) });
  await expect(routeSection).toBeVisible();
  await routeSection.getByRole("button").first().click();
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Run saved to cloud." }),
  ).toBeVisible();
  const persisted = await page.request.get("/api/games/ego-trip/save");
  const payload = (await persisted.json()) as {
    data: {
      data: {
        checkpoint: {
          campaign: { initialSeed: number; roomIndex: number; path: string[] };
        };
      };
    };
  };
  expect(payload.data.data.checkpoint.campaign.initialSeed).toBe(9041);
  expect(payload.data.data.checkpoint.campaign.roomIndex).toBe(1);
  expect(payload.data.data.checkpoint.campaign.path).toHaveLength(2);
  await page.reload();
  await expect(page.getByText(/seed 9041/)).toBeVisible();
  await expect(
    page
      .locator(".game-stat")
      .filter({ has: page.getByText("Encounter", { exact: true }) })
      .locator("strong"),
  ).toHaveText("2 / 40");
  expect(errors).toEqual([]);
});

test("Ego Trip preserves an unsupported save and disables writes", async ({
  page,
  accounts,
  baseURL,
}) => {
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  const future = { version: 2, futureProgress: "retain this checkpoint" };
  const saved = await page.request.post("/api/games/ego-trip/save", {
    data: { schemaVersion: 1, data: future },
    headers: { Origin: new URL(baseURL || "http://localhost:3000").origin },
  });
  expect(saved.ok()).toBe(true);
  await page.goto("/games/ego-trip/play");
  await expect(page.getByText(/unsupported or damaged format/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save checkpoint", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Private co-op", exact: true })
    .click();
  const loaded = await page.request.get("/api/games/ego-trip/save");
  const payload = (await loaded.json()) as { data: { data: unknown } };
  expect(payload.data.data).toEqual(future);
  expect(errors).toEqual([]);
});
