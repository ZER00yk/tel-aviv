import type { Locator } from "@playwright/test";
import { test, expect, captureBrowserErrors } from "./fixtures";
import type { LevelData } from "../../packages/platform/src/classes/models";

test("creators build a timed gate visually, repair references with undo, and play the saved level", async ({
  page,
  accounts,
}) => {
  test.setTimeout(90_000);
  await accounts.signIn(page, "logic");
  const errors = captureBrowserErrors(page);
  await page.goto("/create");
  await page.getByRole("button", { name: "+ New level", exact: true }).click();
  await page.getByLabel("Level title").fill("Visual clockwork gate");
  const canvas = page.getByLabel("Level editor canvas");
  async function place(type: string, x: number, y: number, label: string) {
    await page.getByRole("button", { name: type, exact: true }).click();
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await canvas.click({
      position: { x: (x / 960) * bounds!.width, y: (y / 540) * bounds!.height },
    });
    await page.getByLabel("Object label", { exact: true }).fill(label);
  }
  await place("door", 500, 400, "Exit door");
  await place("trigger-zone", 220, 380, "Gate sensor");
  await page
    .getByRole("button", { name: "Set spawn above object", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Logic & variables", exact: true })
    .click();

  for (const [index, name, type] of [
    [1, "score", "number"],
    [2, "gate_ready", "boolean"],
    [3, "greeting", "string"],
  ] as const) {
    await page
      .getByRole("button", { name: "+ Add variable", exact: true })
      .click();
    await page.getByLabel(`Variable ${index} name`, { exact: true }).fill(name);
    await page
      .getByLabel(`Variable ${index} name`, { exact: true })
      .press("Tab");
    await page
      .getByLabel(`Variable ${index} type`, { exact: true })
      .selectOption(type);
  }
  await page
    .getByLabel("Variable 3 initial value", { exact: true })
    .fill("Find the gate");

  await page
    .getByRole("button", { name: "+ Add logic block", exact: true })
    .click();
  const first = page.getByRole("article", {
    name: "Logic block 1",
    exact: true,
  });
  await first
    .getByLabel("Logic block 1 name", { exact: true })
    .fill("Start the gate clock");
  await first.getByLabel("Event", { exact: true }).selectOption("zone-enter");
  await expect(first.getByLabel("Scene object", { exact: true })).toHaveText(
    /Gate sensor/,
  );
  await first
    .getByRole("button", { name: "+ Add condition", exact: true })
    .click();
  await first.getByLabel("Condition", { exact: true }).selectOption("and");
  await first
    .getByLabel("Condition", { exact: true })
    .nth(1)
    .selectOption("variable");
  await first.getByLabel("Variable", { exact: true }).selectOption("score");
  await first
    .getByRole("button", { name: "+ Add group condition", exact: true })
    .click();

  function action(block: Locator, number: number) {
    return block.getByRole("group", { name: `Action ${number}`, exact: true });
  }
  await action(first, 1)
    .getByLabel("Action", { exact: true })
    .selectOption("add-variable");
  await action(first, 1)
    .getByLabel("Variable", { exact: true })
    .selectOption("score");
  await first
    .getByRole("button", { name: "+ Add action", exact: true })
    .click();
  await action(first, 2)
    .getByLabel("Action", { exact: true })
    .selectOption("set-timer");
  await action(first, 2)
    .getByLabel("Timer name", { exact: true })
    .fill("gate_clock");
  await action(first, 2)
    .getByLabel("Timer seconds", { exact: true })
    .fill("0.5");
  await first
    .getByRole("button", { name: "+ Add action", exact: true })
    .click();
  await action(first, 3)
    .getByLabel("Action", { exact: true })
    .selectOption("set-variable");
  await action(first, 3)
    .getByLabel("Variable", { exact: true })
    .selectOption("gate_ready");
  await action(first, 3)
    .getByLabel("New value", { exact: true })
    .selectOption("true");

  await page
    .getByRole("button", { name: "+ Add logic block", exact: true })
    .click();
  const second = page.getByRole("article", {
    name: "Logic block 2",
    exact: true,
  });
  await second
    .getByLabel("Logic block 2 name", { exact: true })
    .fill("Open the exit");
  await second
    .getByLabel("Event", { exact: true })
    .selectOption("timer-expires");
  await second.getByLabel("Timer name", { exact: true }).fill("gate_clock");
  await second
    .getByRole("button", { name: "+ Add condition", exact: true })
    .click();
  await second
    .getByLabel("Condition", { exact: true })
    .selectOption("variable");
  await second
    .getByLabel("Variable", { exact: true })
    .selectOption("gate_ready");
  await second
    .getByLabel("Compared value", { exact: true })
    .selectOption("true");
  await action(second, 1)
    .getByLabel("Action", { exact: true })
    .selectOption("open-door");
  await expect(
    action(second, 1).getByLabel("Scene object", { exact: true }),
  ).toHaveText(/Exit door/);
  await second
    .getByRole("button", { name: "+ Add action", exact: true })
    .click();
  await action(second, 2)
    .getByLabel("Message", { exact: true })
    .fill("Gate unlocked");
  await second
    .getByRole("button", { name: "+ Add action", exact: true })
    .click();
  await action(second, 3)
    .getByLabel("Action", { exact: true })
    .selectOption("objective");
  await action(second, 3)
    .getByLabel("Objective", { exact: true })
    .fill("Reach the finish");

  await second
    .getByRole("button", { name: "Duplicate action 3", exact: true })
    .click();
  await action(second, 4)
    .getByRole("button", { name: "Move action 4 up", exact: true })
    .click();
  await action(second, 3)
    .getByRole("button", { name: "Delete action 3", exact: true })
    .click();
  await page.getByLabel("Variable 1 name", { exact: true }).fill("keys_found");
  await page.getByLabel("Variable 1 name", { exact: true }).press("Tab");
  await expect(
    action(first, 1).getByLabel("Variable", { exact: true }),
  ).toHaveValue("keys_found");
  await first
    .getByRole("button", { name: "Duplicate logic block 1", exact: true })
    .click();
  const copy = page.getByRole("article", {
    name: "Logic block 2",
    exact: true,
  });
  await copy
    .getByRole("button", { name: "Move logic block 2 down", exact: true })
    .click();
  await page
    .getByRole("article", { name: "Logic block 3", exact: true })
    .getByRole("button", { name: "Delete logic block 3", exact: true })
    .click();
  await expect(page.getByRole("article", { name: /^Logic block/ })).toHaveCount(
    2,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("article", { name: /^Logic block/ })).toHaveCount(
    3,
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByRole("article", { name: /^Logic block/ })).toHaveCount(
    2,
  );

  await page.getByRole("tab", { name: "Scene", exact: true }).click();
  await page
    .getByRole("button", { name: "Select / move", exact: true })
    .click();
  await canvas
    .locator("g")
    .filter({ hasText: "Gate sensor" })
    .locator("rect")
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Playtest", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("tab", { name: "Logic & variables", exact: true })
    .click();
  await expect(
    page.getByText("Missing scene object", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByText("Missing scene object", { exact: false }),
  ).toHaveCount(0);
  await page
    .getByRole("region", { name: "Visual logic editor", exact: true })
    .screenshot({ path: test.info().outputPath("visual-logic-editor.png") });

  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/creations") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  const { data } = (await response.json()) as { data: { level: LevelData } };
  expect(data.level.schemaVersion).toBe(2);
  expect(data.level.logic).toHaveLength(2);
  expect(data.level.variables?.map((variable) => variable.name)).toEqual([
    "keys_found",
    "gate_ready",
    "greeting",
  ]);
  const door = data.level.objects.find(
    (object) => object.label === "Exit door",
  )!;

  await page.reload();
  await page
    .getByRole("heading", { name: "Visual clockwork gate", exact: true })
    .click();
  await page.getByRole("button", { name: "Playtest", exact: true }).click();
  const playtest = page.getByLabel("Level playtest", { exact: true });
  await expect(
    playtest.locator(`[data-object-id="${door.id}"]`),
  ).toHaveAttribute("opacity", "0.18");
  await expect(page.getByText("Gate unlocked", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Reach the finish", { exact: false }),
  ).toBeVisible();
  await playtest.focus();
  await page.keyboard.down("ArrowRight");
  await expect(page.getByText("Level complete!", { exact: true })).toBeVisible({
    timeout: 8_000,
  });
  await page.keyboard.up("ArrowRight");
  expect(errors).toEqual([]);
});
