import type { Locator, Page } from "@playwright/test";
import { test, expect, captureBrowserErrors } from "./fixtures";

interface Run {
  phase: string;
  floor: number;
  runId: string;
  deck: string[];
  hand: string[];
  energy: number;
  enemy?: { name: string; hp: number; intentLabel?: string };
  event?: {
    name: string;
    choices: {
      id: string;
      label: string;
      remove?: boolean;
      upgrade?: boolean;
      unavailable?: boolean;
    }[];
  };
}
async function act(page: Page, button: Locator, name: string): Promise<Run> {
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/games/deck-roguelike/action") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON().action === name,
  );
  await button.click();
  const response = await pending;
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { data: { state: Run } }).data.state;
}

test("Paper Odyssey persists upgrades and choice events, then reaches its first distinct guardian", async ({
  page,
  accounts,
}) => {
  await accounts.signIn(page, "paperdepth");
  const errors = captureBrowserErrors(page);
  await page.goto("/games/deck-roguelike/play");
  await expect(
    page.getByRole("heading", { name: "Choose your path" }),
  ).toBeVisible();
  await page.getByLabel("Starting character").selectOption("warden");
  const started = await act(
    page,
    page.getByRole("button", { name: "Daily seeded run" }),
    "start",
  );
  expect(started.deck).toContain("brace");
  await expect(page.getByText(/Warden: 75 starting health/)).toBeVisible();
  await act(page, page.getByRole("button", { name: /Reading room/ }), "choose");
  await page.getByLabel("Card to upgrade").selectOption("0");
  await expect(page.getByText(/Upgrade: \+3 base damage/)).toBeVisible();
  const upgraded = await act(
    page,
    page.getByRole("button", { name: "Upgrade this card" }),
    "rest",
  );
  expect(upgraded.deck[0]).toBe("strike+");
  expect(upgraded.runId).toBe(started.runId);
  await page.reload();
  await page.getByRole("button", { name: "Deck (8)" }).click();
  await expect(
    page.getByText("Margin strike + ×1", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Deck (8)" }).click();
  const event = await act(
    page,
    page.getByRole("button", { name: "? Event", exact: true }),
    "choose",
  );
  expect(event.phase).toBe("event");
  await expect(
    page.getByRole("heading", { name: event.event!.name, exact: true }),
  ).toBeVisible();
  const choice = event.event!.choices.find(
    (choice) => !choice.unavailable && !choice.remove && !choice.upgrade,
  )!;
  const resolved = await act(
    page,
    page.getByRole("button", { name: choice.label, exact: true }),
    "event",
  );
  expect(resolved.phase).toBe("map");
  await act(page, page.getByRole("button", { name: /Reading room/ }), "choose");
  await expect(
    page
      .getByLabel("Card to upgrade")
      .getByRole("option", { name: /Margin strike \+/ }),
  ).toHaveCount(0);
  await act(
    page,
    page.getByRole("button", { name: "Rest · recover health" }),
    "rest",
  );
  await expect(
    page.getByRole("button", { name: /The Glass Archivist/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "⚔ Battle", exact: true }),
  ).toHaveCount(0);
  const boss = await act(
    page,
    page.getByRole("button", { name: /The Glass Archivist/ }),
    "choose",
  );
  expect(boss.floor).toBe(4);
  expect(boss.enemy!.name).toBe("The Glass Archivist");
  await expect(
    page.getByText(boss.enemy!.intentLabel!, { exact: true }),
  ).toBeVisible();
  const played = await act(
    page,
    page
      .getByRole("button", { name: /Play card →/ })
      .filter({ has: page.locator("h3") })
      .and(page.locator("button:enabled"))
      .first(),
    "play",
  );
  expect(played.hand.length).toBeGreaterThan(0);
  expect(played.runId).toBe(started.runId);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "The Glass Archivist", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(played.enemy!.intentLabel!, { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
