import { test, expect, captureBrowserErrors } from "./fixtures";
import type { EgoRankedView } from "../../packages/platform/src/egoRanked";

test("saved movement remapping drives real ranked inputs and survives reload", async ({
  page,
  accounts,
  baseURL,
}) => {
  await accounts.signIn(page, "remap");
  const errors = captureBrowserErrors(page);
  await page.goto("/games/ego-trip/play");
  await page
    .locator(".game-toolbar")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.getByLabel("Move right key").selectOption("KeyI");
  await page
    .getByRole("button", { name: "Save movement controls", exact: true })
    .click();
  await expect(
    page.getByText("Movement controls saved to your account.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .locator(".game-toolbar")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(page.getByLabel("Move right key")).toHaveValue("KeyI");
  await page
    .locator(".game-toolbar")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const invalid = await page.request.post("/api/profile", {
    headers: { Origin: baseURL! },
    data: { settings: { games: { movementKeys: { left: "KeyW" } } } },
  });
  expect(invalid.status()).toBe(400);
  await page.getByRole("button", { name: "Ranked solo", exact: true }).click();
  await page
    .getByRole("button", { name: "Start ranked run", exact: true })
    .click();
  // Clicking dispatches the start request; await the committed run before
  // taking the initial authoritative position used by the movement assertion.
  await expect(
    page.getByRole("button", { name: "Abandon ranked run", exact: true }),
  ).toBeVisible();
  const snapshot = async () => {
    const response = await page.request.get("/api/games/ego-trip/ranked");
    expect(response.ok()).toBe(true);
    return ((await response.json()) as { data: EgoRankedView }).data;
  };
  const initial = await snapshot();
  expect(initial.run?.status).toBe("active");
  await page.locator(".ego-ranked canvas").focus();
  await page.keyboard.down("i");
  await expect
    .poll(async () => (await snapshot()).run?.world.player.x)
    .toBeGreaterThan(initial.run!.world.player.x + 20);
  await page.keyboard.up("i");
  expect(errors).toEqual([]);
});
