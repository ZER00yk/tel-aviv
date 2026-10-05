import { test, expect, captureBrowserErrors } from "./fixtures";
import type { LevelData } from "../../packages/platform/src/classes/models";

test("creator motion and button-to-door connections persist and play", async ({
  page,
  accounts,
}) => {
  await accounts.signIn(page, "creator");
  const errors = captureBrowserErrors(page);
  await page.goto("/create");
  await page.getByRole("button", { name: "+ New level", exact: true }).click();
  await page.getByLabel("Level title").fill("Pressure plate world");
  const canvas = page.getByLabel("Level editor canvas");
  async function place(type: string, x: number, y: number) {
    await page.getByRole("button", { name: type, exact: true }).click();
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await canvas.click({
      position: { x: (x / 960) * bounds!.width, y: (y / 540) * bounds!.height },
    });
  }
  await place("moving-platform", 240, 300);
  await page.getByLabel("Travel distance").fill("120");
  await page.getByLabel("Cycle seconds").fill("3");
  await place("door", 500, 400);
  await place("button", 200, 480);
  await page.getByLabel("Button behavior").selectOption("toggle");
  await page.getByRole("checkbox", { name: /Door 1 at/ }).check();
  await page
    .getByRole("button", { name: "Set spawn above object", exact: true })
    .click();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/creations") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  const { data } = (await response.json()) as {
    data: { id: string; level: LevelData };
  };
  const moving = data.level.objects.find(
    (object) => object.type === "moving-platform",
  )!;
  const door = data.level.objects.find((object) => object.type === "door")!;
  const button = data.level.objects.find((object) => object.type === "button")!;
  expect(moving.motion).toEqual({ axis: "x", distance: 120, periodSeconds: 3 });
  expect(button).toMatchObject({ buttonMode: "toggle", targetIds: [door.id] });
  await page.reload();
  await page
    .getByRole("heading", { name: "Pressure plate world", exact: true })
    .click();
  await expect(page.getByLabel("Level title")).toHaveValue(
    "Pressure plate world",
  );
  await page.getByRole("button", { name: "Playtest", exact: true }).click();
  const playtest = page.getByLabel("Level playtest");
  await expect(
    playtest.locator(`[data-object-id="${door.id}"]`),
  ).toHaveAttribute("opacity", "0.18");
  await expect
    .poll(async () =>
      Number(
        await playtest
          .locator(`[data-object-id="${moving.id}"]`)
          .getAttribute("x"),
      ),
    )
    .toBeGreaterThan(moving.x + 10);
  expect(errors).toEqual([]);
});
