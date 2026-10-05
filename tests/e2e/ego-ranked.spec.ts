import { test, expect, captureBrowserErrors } from "./fixtures";
import type { EgoRankedView } from "../../packages/platform/src/egoRanked";
test("ranked solo plays real server movement, restores its run, and rejects forged outcomes", async ({
  page,
  accounts,
  baseURL,
}) => {
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  await page.goto("/games/ego-trip/play");
  await page.getByRole("button", { name: "Ranked solo", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Ranked solo", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start ranked run", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Abandon ranked run", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ego-ranked canvas")).toBeVisible();
  const snapshot = async () => {
    const response = await page.request.get("/api/games/ego-trip/ranked");
    expect(response.ok()).toBe(true);
    return ((await response.json()) as { data: EgoRankedView }).data;
  };
  const initial = await snapshot();
  expect(initial.run?.status).toBe("active");
  expect(initial.run?.validationStatus).toBe("server-simulated");
  await page.locator(".ego-ranked canvas").focus();
  await page.keyboard.down("d");
  await expect
    .poll(async () => (await snapshot()).run?.world.player.x)
    .toBeGreaterThan(initial.run!.world.player.x + 15);
  await page.keyboard.up("d");
  const moved = await snapshot();
  expect(moved.run?.revision).toBeGreaterThan(initial.run!.revision);
  const box = await page.locator(".ego-ranked canvas").boundingBox();
  expect(box).not.toBeNull();
  await page.keyboard.down("j");
  await expect
    .poll(
      async () => {
        const combat = await snapshot();
        await page.mouse.move(
          box!.x + (combat.run!.world.boss.x * box!.width) / 900,
          box!.y + (combat.run!.world.boss.y * box!.height) / 560,
        );
        return combat.run!.world.boss.hp;
      },
      { timeout: 10000 },
    )
    .toBeLessThan(initial.run!.world.boss.hp);
  await page.keyboard.up("j");
  const forged = await page.request.post("/api/games/ego-trip/ranked/intent", {
    headers: { Origin: new URL(baseURL || "http://localhost:3000").origin },
    data: {
      runId: moved.run!.id,
      expectedRevision: moved.run!.revision,
      command: "input",
      score: 1e12,
      outcome: "won",
      payload: {
        x: 0,
        y: 0,
        aimX: 450,
        aimY: 170,
        attack: false,
        alternate: false,
        dash: false,
      },
    },
  });
  expect(forged.status()).toBe(400);
  await page.reload();
  await page.getByRole("button", { name: "Ranked solo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Abandon ranked run", exact: true }),
  ).toBeVisible();
  const restored = await snapshot();
  expect(restored.run?.id).toBe(initial.run!.id);
  expect(restored.run?.world.kills).toBe(0);
  expect(restored.progress.completions).toBe(0);
  expect(errors).toEqual([]);
});

test("ranked campaign renders server-owned patrols, rejects invented routes, and recovers real input combat", async ({
  page,
  accounts,
  baseURL,
}) => {
  await accounts.signIn();
  const errors = captureBrowserErrors(page);
  await page.goto("/games/ego-trip/play");
  await page.getByRole("button", { name: "Ranked solo", exact: true }).click();
  await page.getByLabel("Ranked mode").selectOption("campaign");
  await page
    .getByRole("button", { name: "Start ranked run", exact: true })
    .click();
  const snapshot = async () =>
    (
      (await (await page.request.get("/api/games/ego-trip/ranked")).json()) as {
        data: EgoRankedView;
      }
    ).data;
  await expect.poll(async () => (await snapshot()).run?.mode).toBe("campaign");
  const first = (await snapshot()).run!;
  expect(first.world.campaign?.roomIndex).toBe(0);
  expect(first.world.enemies.length).toBeGreaterThan(0);
  const canvas = page.locator(".ego-ranked canvas");
  await canvas.focus();
  await page.keyboard.down("d");
  await expect
    .poll(async () => (await snapshot()).run!.world.player.x)
    .toBeGreaterThan(first.world.player.x + 15);
  await page.keyboard.up("d");
  const box = (await canvas.boundingBox())!;
  await page.keyboard.down("j");
  await expect
    .poll(
      async () => {
        const run = (await snapshot()).run!;
        const target =
          run.world.enemies.find((enemy) => enemy.hp > 0) ?? run.world.boss;
        await page.mouse.move(
          box.x + (target.x * box.width) / 900,
          box.y + (target.y * box.height) / 560,
        );
        return run.world.hits;
      },
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);
  await page.keyboard.up("j");
  await expect
    .poll(async () => {
      const current = (await snapshot()).run!;
      const invented = await page.request.post(
        "/api/games/ego-trip/ranked/intent",
        {
          headers: {
            Origin: new URL(baseURL || "http://localhost:3000").origin,
          },
          data: {
            runId: current.id,
            expectedRevision: current.revision,
            command: "route",
            payload: { id: "39:boss:0" },
          },
        },
      );
      return invented.status();
    })
    .toBe(400);
  await page.reload();
  await page.getByRole("button", { name: "Ranked solo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Abandon ranked run", exact: true }),
  ).toBeVisible();
  const restored = (await snapshot()).run!;
  expect(restored.id).toBe(first.id);
  expect(restored.mode).toBe("campaign");
  expect(restored.world.campaign!.roomIndex).toBe(0);
  expect(restored.world.hits).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("ranked records are private and abandonment preserves a casual save", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  await accounts.signIn();
  const origin = new URL(baseURL || "http://localhost:3000").origin;
  const casual = {
    version: 77,
    futureCheckpoint: "Keep this local simulation separate",
  };
  const saved = await page.request.post("/api/games/ego-trip/save", {
    headers: { Origin: origin },
    data: { data: casual, schemaVersion: 1 },
  });
  expect(saved.ok()).toBe(true);
  await page.goto("/games/ego-trip/play");
  await page.getByRole("button", { name: "Ranked solo", exact: true }).click();
  await page
    .getByRole("button", { name: "Start ranked run", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Abandon ranked run", exact: true }),
  ).toBeVisible();
  const response = await page.request.get("/api/games/ego-trip/ranked");
  const initial = ((await response.json()) as { data: EgoRankedView }).data;
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await accounts.signIn(other);
    const denied = await other.request.post(
      `${origin}/api/games/ego-trip/ranked/intent`,
      {
        headers: { Origin: origin },
        data: {
          runId: initial.run!.id,
          expectedRevision: initial.run!.revision,
          command: "abandon",
          payload: {},
        },
      },
    );
    expect(denied.status()).toBe(404);
    const privateHistory = await other.request.get(
      `${origin}/api/games/ego-trip/ranked`,
    );
    const otherView = ((await privateHistory.json()) as { data: EgoRankedView })
      .data;
    expect(otherView.run).toBeNull();
    expect(otherView.history).toEqual([]);
  } finally {
    await otherContext.close();
  }
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", { name: "Abandon ranked run", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start ranked run", exact: true }),
  ).toBeVisible();
  const loaded = await page.request.get("/api/games/ego-trip/save");
  expect(
    ((await loaded.json()) as { data: { data: unknown } }).data.data,
  ).toEqual(casual);
});
