import { randomUUID } from "node:crypto";
import { test, expect, captureBrowserErrors } from "./fixtures";
import { levelTemplate } from "../../apps/web/components/creator/templates";
import type { LevelData } from "../../packages/creator-runtime/src/schema";

test("advanced geometry is edited visually, saved, reloaded and traversed", async ({
  page,
  accounts,
}) => {
  await accounts.signIn(page, "geometry");
  const errors = captureBrowserErrors(page);
  const title = `Geometry ${randomUUID().slice(0, 8)}`;
  await page.goto("/create");
  await page.getByLabel("Level template").selectOption("geometry");
  await page.getByRole("button", { name: "+ New level", exact: true }).click();
  await page.getByLabel("Level title").fill(title);
  const selector = page.getByLabel("Select a scene object");
  await selector.selectOption({ label: "Rising ramp · 220, 420" });
  await page
    .getByLabel("Slope rises toward", { exact: true })
    .selectOption("left");
  await page
    .getByLabel("Slope rises toward", { exact: true })
    .selectOption("right");
  await page.getByLabel("height", { exact: true }).fill("75");
  await selector.selectOption({ label: "Convex footing · 420, 460" });
  await page
    .getByRole("button", { name: "Hexagon shape", exact: true })
    .click();
  await expect(
    page.getByLabel("Vertex 6 horizontal", { exact: true }),
  ).toHaveValue("0");
  await page
    .getByRole("button", { name: "Trapezoid shape", exact: true })
    .click();
  await page.getByLabel("Vertex 1 horizontal", { exact: true }).fill("0.2");
  await selector.selectOption({ label: "Angled bridge · 430, 420" });
  await page.getByLabel("rotation", { exact: true }).fill("-15");
  await selector.selectOption({ label: "Rotating arm · 680, 260" });
  await page
    .getByLabel("Rotation degrees per second", { exact: true })
    .fill("-60");
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/creations") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const creation = (await response.json()).data as {
    id: string;
    level: LevelData;
  };
  expect(
    creation.level.objects.find((object) => object.type === "slope")?.height,
  ).toBe(75);
  expect(
    creation.level.objects.find((object) => object.type === "polygon-platform")
      ?.vertices?.[0].x,
  ).toBe(0.2);
  expect(
    creation.level.objects.find((object) => object.type === "rotating-hazard")
      ?.rotationSpeed,
  ).toBe(-60);
  await page.reload();
  await page.getByRole("heading", { name: title, exact: true }).click();
  await page.getByRole("button", { name: "Playtest", exact: true }).click();
  const playable = page.getByLabel("Level playtest", { exact: true });
  await playable.focus();
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("Space");
  await expect(page.getByText("Level complete!", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("Space");
  expect(errors).toEqual([]);
});

test("a second account drives a cart through a real explosion chain to server-verified completion", async ({
  page,
  accounts,
}) => {
  await accounts.signIn(page, "cart_author");
  const title = `Cart chain ${randomUUID().slice(0, 8)}`;
  const level = levelTemplate("cart-blast");
  const wall = level.objects.find((object) => object.type === "destructible")!;
  const response = await page.request.post("/api/creations", {
    headers: { Origin: "http://localhost:3000" },
    data: {
      title,
      level,
      category: "action",
      description: "Drive through the charges",
      tags: ["vehicles"],
    },
  });
  expect(response.ok()).toBe(true);
  const creation = (await response.json()).data as { id: string };
  expect(
    (
      await page.request.post(`/api/creations/${creation.id}/publish`, {
        headers: { Origin: "http://localhost:3000" },
        data: { published: true },
      })
    ).ok(),
  ).toBe(true);
  await accounts.signIn(page, "cart_player");
  const errors = captureBrowserErrors(page);
  await page.goto("/create");
  await page.getByLabel("Search creations").fill(title);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .click();
  await expect(
    page.getByText("Verified play · inputs synchronized", { exact: true }),
  ).toBeVisible();
  const playable = page.getByLabel("Level playtest", { exact: true });
  await expect(playable.locator(`[data-object-id="${wall.id}"]`)).toBeVisible();
  await playable.focus();
  await page.keyboard.press("e");
  await expect(
    page.getByText("Driving cart · E to exit", { exact: true }),
  ).toBeVisible();
  await page.keyboard.down("ArrowRight");
  await expect(playable.locator(`[data-object-id="${wall.id}"]`)).toHaveCount(
    0,
    { timeout: 10_000 },
  );
  await expect(
    page.getByText("The barrier is gone. Drive to the finish!"),
  ).toBeVisible();
  await expect(
    page.getByText("Completion verified by server", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await page.keyboard.up("ArrowRight");
  await expect(
    page.getByText("Health: 80 · Deaths: 0", { exact: false }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
