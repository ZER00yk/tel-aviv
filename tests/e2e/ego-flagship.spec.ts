import { test, expect, captureBrowserErrors } from "./fixtures";
import { newCampaignWorld } from "../../games/ego-trip/engine";
import { initialSave } from "../../games/ego-trip/checkpoint";
import { routeFor } from "../../games/ego-trip/campaign";

test("Ego Trip carries an archivist key, opens a relay, and saves its real weapon reward", async ({
  page,
  accounts,
  baseURL,
}) => {
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  const origin = new URL(baseURL || "http://localhost:3000").origin;
  // Preserve the existing compact saved-campaign key and relay contract.
  const w = newCampaignWorld("pulse", 482, { pacingVersion: null });
  w.stage = "event";
  w.campaign!.room = routeFor("npc", 1);
  w.campaign!.roomIndex = 1;
  const seed = await page.request.post("/api/games/ego-trip/save", {
    data: { schemaVersion: 1, data: { ...initialSave, checkpoint: w } },
    headers: { Origin: origin },
  });
  expect(seed.ok(), await seed.text()).toBe(true);
  await page.goto("/games/ego-trip/play");
  await expect(
    page.getByRole("heading", { name: "The signal archivist", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Carry the signal key to a relay" })
    .click();
  await expect(page.getByText(/Carried object: signal key/)).toBeVisible();
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Run saved to cloud." }),
  ).toBeVisible();
  const saved = (
    await (await page.request.get("/api/games/ego-trip/save")).json()
  ).data.data;
  expect(saved.checkpoint.campaign.signalKey).toBe(true);
  // Move this account's checkpoint to the next actual key-gated event junction;
  // progression and one-use reward behavior are independently covered by engine tests.
  saved.checkpoint.stage = "event";
  saved.checkpoint.campaign.room = routeFor("secret", 3);
  saved.checkpoint.campaign.room.name = "The abandoned relay";
  saved.checkpoint.campaign.roomIndex = 3;
  saved.checkpoint.campaign.eventResolved = false;
  const existing = (
    await (await page.request.get("/api/games/ego-trip/save")).json()
  ).data;
  const relay = await page.request.post("/api/games/ego-trip/save", {
    data: {
      schemaVersion: 1,
      expectedRevision: existing.revision,
      data: saved,
    },
    headers: { Origin: origin },
  });
  expect(relay.ok(), await relay.text()).toBe(true);
  await page.reload();
  await page
    .getByRole("button", {
      name: "Use carried key · restore Prism argument + Prismatic memory",
    })
    .click();
  await expect(
    page.getByText(/The signal key restores Prism argument/),
  ).toBeVisible();
  await expect(page.getByText(/Carried object: signal key/)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Run saved to cloud." }),
  ).toBeVisible();
  const completed = (
    await (await page.request.get("/api/games/ego-trip/save")).json()
  ).data.data.checkpoint;
  expect(completed.weapon).toBe("prism");
  expect(completed.mods).toContain("refraction");
  expect(completed.campaign.secrets).toContain("restored-relay");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Alternate", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ranked solo", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
