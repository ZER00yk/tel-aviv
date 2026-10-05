/** Local QA only: node --env-file=.env --import tsx scripts/ego-browser-playtest.ts */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { db, closeDatabase } from "../packages/database/src/index";
import { mods } from "../games/ego-trip/content";
import { playtestInput } from "../games/ego-trip/playtest";
import { shopCost } from "../games/ego-trip/engine";
import type { EgoRankedView } from "../packages/platform/src/egoRanked";

const origin = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const nativeAuth = process.env.EGO_BROWSER_NATIVE_AUTH === "true";
const localTlsFixture = origin === "https://localhost:3843";
const durationMinutes = Number(process.env.EGO_BROWSER_DEADLINE_MINUTES ?? 90);
if (
  !Number.isFinite(durationMinutes) ||
  durationMinutes < 15 ||
  durationMinutes > 120
)
  throw new Error("Ego browser deadline must be between 15 and 120 minutes");
const username = `egobrowser_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const password = `A!${randomUUID()}${randomUUID()}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  baseURL: origin,
  ignoreHTTPSErrors: localTlsFixture,
  viewport: { width: 1280, height: 1000 },
});
const page = await context.newPage();
let ownerId = "";
const held = new Set<string>(),
  errors: string[] = [],
  roomSamples: unknown[] = [];
type Meter = {
  started: number;
  previousFrame: number;
  frameIntervals: number[];
  frameCount: number;
  maxFrameMs: number;
  over50Ms: number;
  paintCount: number;
  heapSamples: { at: number; used: number; total: number }[];
};
const percentile = (values: number[], fraction: number) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    null
  );
};
// Keep this as plain JavaScript source: tsx/esbuild can insert a __name helper
// into serialized callback bodies, which is unavailable in the browser realm.
await page.addInitScript({
  content: `
  const target = window;
  target.egoQAMeter = {
    started: performance.now(),
    previousFrame: 0,
    frameIntervals: [],
    frameCount: 0,
    maxFrameMs: 0,
    over50Ms: 0,
    paintCount: 0,
    heapSamples: [],
  };
  const frame = (now) => {
    const meter = target.egoQAMeter;
    if (meter.previousFrame) {
      const interval = now - meter.previousFrame;
      meter.frameCount++;
      meter.maxFrameMs = Math.max(meter.maxFrameMs, interval);
      if (interval > 50) meter.over50Ms++;
      // Bound memory while retaining a reservoir across the entire run.
      if (meter.frameIntervals.length < 50000) meter.frameIntervals.push(interval);
      else {
        const slot = Math.floor(Math.random() * meter.frameCount);
        if (slot < 50000) meter.frameIntervals[slot] = interval;
      }
    }
    meter.previousFrame = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const original = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function (
    x,
    y,
    width,
    height,
  ) {
    if (x === 0 && y === 0 && width === 900 && height === 560)
      target.egoQAMeter.paintCount++;
    return original.call(this, x, y, width, height);
  };
  window.setInterval(() => {
    const memory = performance.memory;
    if (memory)
      target.egoQAMeter.heapSamples.push({
        at: performance.now() - target.egoQAMeter.started,
        used: memory.usedJSHeapSize,
        total: memory.totalJSHeapSize,
      });
  }, 10000);
`,
});
page.on("pageerror", (e) => errors.push(e.message));
const release = async () => {
  for (const key of held) await page.keyboard.up(key);
  held.clear();
};
const applyKeys = async (keys: Set<string>) => {
  for (const key of held)
    if (!keys.has(key)) {
      await page.keyboard.up(key);
      held.delete(key);
    }
  for (const key of keys)
    if (!held.has(key)) {
      await page.keyboard.down(key);
      held.add(key);
    }
};
let latest: EgoRankedView | null = null;
const clickIntent = async (name: string, command: string) => {
  const settled = page.waitForResponse((response) => {
    if (
      !response.url().endsWith("/api/games/ego-trip/ranked/intent") ||
      response.request().method() !== "POST"
    )
      return false;
    return (
      (response.request().postDataJSON() as { command?: string }).command ===
      command
    );
  });
  await page.getByRole("button", { name, exact: true }).click();
  await settled;
};
const started = Date.now();
let campaignStarted = started;
try {
  const auth = await page.request.post(
    nativeAuth ? "/api/auth/register" : "/api/auth/dev",
    {
      headers: { Origin: origin },
      data: nativeAuth
        ? { username, password, passwordConfirmation: password }
        : { username },
    },
  );
  if (!auth.ok())
    throw new Error(`Fixture authentication failed: ${auth.status()}`);
  ownerId = ((await auth.json()) as { data: { id: string } }).data.id;
  await page.goto("/games/ego-trip/play");
  await page.getByRole("button", { name: "Ranked solo", exact: true }).click();
  await page.getByLabel("Ranked mode").selectOption("campaign");
  await page
    .getByRole("button", { name: "Start ranked run", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Abandon ranked run", exact: true })
    .waitFor();
  await page.evaluate(() => {
    const target = window as unknown as Window & { egoQAMeter: Meter };
    target.egoQAMeter.started = performance.now();
    target.egoQAMeter.previousFrame = 0;
    target.egoQAMeter.frameIntervals = [];
    target.egoQAMeter.frameCount = 0;
    target.egoQAMeter.maxFrameMs = 0;
    target.egoQAMeter.over50Ms = 0;
    target.egoQAMeter.paintCount = 0;
    target.egoQAMeter.heapSamples = [];
  });
  campaignStarted = Date.now();
  const canvas = page.locator(".ego-ranked canvas");
  let measuredRoom = -1,
    lastRoomAt = Date.now(),
    lastStage = "",
    shopBought = new Set<string>();
  const priority = [
    "vampire",
    "shield",
    "mercy",
    "tempo",
    "venom",
    "critical",
    "split",
    "promise",
    "guardian",
    "boss-hunter",
  ];
  const deadline = Date.now() + durationMinutes * 60000;
  while (Date.now() < deadline) {
    const response = await page.request.get("/api/games/ego-trip/ranked");
    if (!response.ok())
      throw new Error(`Ranked snapshot failed: ${response.status()}`);
    latest = ((await response.json()) as { data: EgoRankedView }).data;
    const run = latest.run!;
    const w = run.world,
      c = w.campaign!;
    if (c.roomIndex !== measuredRoom) {
      if (measuredRoom >= 0)
        roomSamples.push({
          index: measuredRoom,
          wallSeconds: (Date.now() - lastRoomAt) / 1000,
          endedAtStage: lastStage,
        });
      measuredRoom = c.roomIndex;
      lastRoomAt = Date.now();
      shopBought = new Set();
      console.log(
        JSON.stringify({
          room: c.roomIndex + 1,
          kind: c.room.kind,
          health: w.player.hp,
          resources: w.ego,
          wallSeconds: Math.round((Date.now() - started) / 1000),
        }),
      );
    }
    lastStage = w.stage;
    if (run.status !== "active") break;
    if (w.stage === "fight") {
      await canvas.scrollIntoViewIfNeeded();
      await canvas.focus();
      const input = playtestInput(w),
        keys = new Set<string>();
      if (input.x > 0.2) keys.add("d");
      if (input.x < -0.2) keys.add("a");
      if (input.y > 0.2) keys.add("s");
      if (input.y < -0.2) keys.add("w");
      if (input.attack) keys.add("j");
      if (input.alternate) keys.add("k");
      if (input.dash) keys.add("l");
      const box = (await canvas.boundingBox())!;
      await page.mouse.move(
        box.x + (input.aimX * box.width) / 900,
        box.y + (input.aimY * box.height) / 560,
      );
      await applyKeys(keys);
    } else {
      await release();
      if (w.stage === "choice") {
        const id = w.offered
          .slice()
          .sort(
            (a, b) =>
              (priority.includes(a) ? priority.indexOf(a) : 99) -
              (priority.includes(b) ? priority.indexOf(b) : 99),
          )[0];
        await clickIntent(mods.find((mod) => mod.id === id)?.name ?? id, "mod");
      } else if (w.stage === "route") {
        const order =
          w.player.hp < w.player.maxHp * 0.65
            ? [
                "shop",
                "helper",
                "shrine",
                "secret",
                "npc",
                "treasure",
                "weapon",
                "battle",
                "environment",
                "survival",
                "elite",
                "challenge",
              ]
            : [
                "helper",
                "secret",
                "npc",
                "shop",
                "weapon",
                "battle",
                "treasure",
                "shrine",
                "environment",
                "survival",
                "elite",
                "challenge",
              ];
        const route = c.routes
          .slice()
          .sort(
            (a, b) =>
              (order.includes(a.kind) ? order.indexOf(a.kind) : 99) -
              (order.includes(b.kind) ? order.indexOf(b.kind) : 99),
          )[0];
        await clickIntent(`${route.name} · ${route.kind}`, "route");
      } else if (w.stage === "event")
        await clickIntent(
          c.room.kind === "helper"
            ? "medic"
            : c.room.kind === "npc"
              ? "risk"
              : "safe",
          "event",
        );
      else if (w.stage === "shop") {
        if (
          w.player.hp < w.player.maxHp - 15 &&
          w.ego >= shopCost(w, "heal") &&
          !shopBought.has("heal")
        ) {
          shopBought.add("heal");
          await clickIntent("heal", "shop");
        } else if (
          (!w.helper || w.helper.kind !== "medic") &&
          w.ego >= shopCost(w, "helper") &&
          !shopBought.has("helper")
        ) {
          shopBought.add("helper");
          await clickIntent("helper", "shop");
        } else await clickIntent("Continue ranked run", "continue");
      }
    }
    await page.waitForTimeout(160);
  }
  await release();
  roomSamples.push({
    index: latest?.run?.world.campaign?.roomIndex,
    wallSeconds: (Date.now() - lastRoomAt) / 1000,
    endedAtStage: lastStage,
  });
  const meter = await page.evaluate(
    () => (window as unknown as Window & { egoQAMeter: Meter }).egoQAMeter,
  );
  const run = latest?.run;
  const report = {
    measuredAt: new Date().toISOString(),
    method:
      "Actual Chromium ranked canvas; ordinary keyboard/pointer/buttons; heuristic reads owned server snapshots. No SQL gameplay changes, submitted score, synthetic elapsed time or direct simulation.",
    limitations: [
      `One automated player and one server-generated seed in Chromium at ${origin}; not a human pacing study or mobile/device budget measurement.`,
      "requestAnimationFrame intervals measure browser scheduling. Canvas repaints follow approximately 8 Hz server snapshots; they do not measure 60 Hz gameplay rendering.",
      "Chrome performance.memory includes tab/framework runtime; collected samples do not prove a leak or a mobile budget.",
    ],
    wallSeconds: (Date.now() - campaignStarted) / 1000,
    setupWallSeconds: (campaignStarted - started) / 1000,
    result: run?.status ?? "no-run",
    stage: run?.world.stage,
    runId: run?.id,
    seed: run?.seed,
    version: run?.gameVersion,
    roomsCleared: run?.world.campaign?.cleared,
    bossesDefeated: run?.world.kills,
    simulationSeconds: (run?.simulatedMs ?? 0) / 1000,
    damageDealt: run?.world.telemetry?.damageDealt,
    incomingDamage: run?.world.telemetry?.damageTaken,
    healing: run?.world.telemetry?.healing,
    upgrades: run?.world.mods.length,
    resources: run?.world.ego,
    finalStateBytes: run ? Buffer.byteLength(JSON.stringify(run.world)) : null,
    frameIntervals: {
      count: meter.frameCount,
      samples: meter.frameIntervals.length,
      sampling:
        "Bounded reservoir of up to 50000 intervals; max and over50 count cover all frames",
      medianMs: percentile(meter.frameIntervals, 0.5),
      p95Ms: percentile(meter.frameIntervals, 0.95),
      maxMs: meter.maxFrameMs,
      over50Ms: meter.over50Ms,
    },
    canvasPaints: meter.paintCount,
    heapSamples: meter.heapSamples,
    roomSamples,
    pageErrors: errors,
  };
  await mkdir(".local/verification", { recursive: true });
  await writeFile(
    ".local/verification/ego-browser-playtest-goals5.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await page.screenshot({
    path: ".local/verification/ego-browser-playtest-goals5.png",
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      result: report.result,
      roomsCleared: report.roomsCleared,
      wallSeconds: report.wallSeconds,
      simulationSeconds: report.simulationSeconds,
      pageErrors: errors,
      report: ".local/verification/ego-browser-playtest-goals5.json",
    }),
  );
  if (
    report.result !== "completed" ||
    report.roomsCleared !== 40 ||
    report.bossesDefeated !== 8 ||
    run?.world.campaign?.pacingVersion !== 1 ||
    errors.length ||
    !meter.frameIntervals.length ||
    !meter.paintCount ||
    !meter.heapSamples.length
  )
    process.exitCode = 1;
} finally {
  try {
    if (ownerId && nativeAuth) {
      const proof = await page.request.post("/api/auth/reauthenticate", {
        headers: { Origin: origin },
        data: { password },
      });
      if (!proof.ok())
        throw new Error(
          `Fixture reauthentication cleanup failed: ${proof.status()}`,
        );
      const removed = await page.request.post("/api/account/delete", {
        headers: { Origin: origin },
        data: { confirmation: `DELETE ${username}` },
      });
      if (!removed.ok())
        throw new Error(`Fixture account cleanup failed: ${removed.status()}`);
    } else if (ownerId) await db`DELETE FROM users WHERE id=${ownerId}`;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Fixture cleanup failed",
    );
    process.exitCode = 1;
  }
  await context.close();
  await browser.close();
  await closeDatabase();
}
