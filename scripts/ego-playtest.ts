/** Run with: node --expose-gc --import tsx scripts/ego-playtest.ts */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";
import { resolve } from "node:path";
import { runCampaignPlaytest } from "../games/ego-trip/playtest";
import { weapons, type WeaponId } from "../games/ego-trip/content";
import type { Difficulty } from "../games/ego-trip/campaign";

const seedValues = [81, 481, 2026, 20261003, 3735928559];
const weaponValues = Object.keys(weapons) as WeaponId[];
const difficulties: Difficulty[] = ["standard", "volatile"];
const routes = ["safer", "objectives"] as const;
const sourceFiles = [
  "games/ego-trip/engine.ts",
  "games/ego-trip/campaign.ts",
  "games/ego-trip/journey.ts",
  "games/ego-trip/content.ts",
  "games/ego-trip/arena.ts",
  "games/ego-trip/telemetry.ts",
  "games/ego-trip/playtest.ts",
  "scripts/ego-playtest.ts",
];
async function fingerprints() {
  return Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
      ]),
    ),
  );
}
const sourceBefore = await fingerprints();
const startedAt = new Date().toISOString();
const collection = (globalThis as typeof globalThis & { gc?: () => void }).gc;
const round = (n: number) => +n.toFixed(3);
function distribution(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    count: values.length,
    min: round(sorted[0] ?? 0),
    mean: round(values.reduce((sum, n) => sum + n, 0) / (values.length || 1)),
    median: round(sorted[Math.floor(sorted.length / 2)] ?? 0),
    p95: round(
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ??
        0,
    ),
    max: round(sorted.at(-1) ?? 0),
  };
}
type Measurement = ReturnType<typeof runCampaignPlaytest> & {
  collectedHeapBeforeBytes: number | null;
  collectedHeapAfterBytes: number | null;
};
// Warm JIT once before measured runs. Never change HP, RNG, room outcomes or controls.
runCampaignPlaytest({
  seed: 481,
  weapon: "pulse",
  routeStrategy: "objectives",
});
collection?.();
const runs: Measurement[] = [];
for (const seed of seedValues) {
  for (const weapon of weaponValues) {
    for (const difficulty of difficulties) {
      for (const routeStrategy of routes) {
        collection?.();
        const collectedHeapBeforeBytes = collection
          ? process.memoryUsage().heapUsed
          : null;
        const result = runCampaignPlaytest({
          seed,
          weapon,
          difficulty,
          routeStrategy,
        });
        collection?.();
        const collectedHeapAfterBytes = collection
          ? process.memoryUsage().heapUsed
          : null;
        runs.push({
          ...result,
          collectedHeapBeforeBytes,
          collectedHeapAfterBytes,
        });
      }
    }
  }
  console.log(
    `Measured seed ${seed}: ${runs.length}/140 runs, ${runs.filter((r) => r.result === "won").length} wins`,
  );
}
const sourceAfter = await fingerprints();
const sourceUnchangedDuringMeasurement =
  JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter);
const wins = runs.filter((r) => r.result === "won");
function summarize(group: Measurement[]) {
  const complete = group.filter((r) => r.result === "won");
  return {
    runs: group.length,
    wins: complete.length,
    losses: group.filter((r) => r.result === "lost").length,
    timeouts: group.filter((r) => r.timedOut).length,
    completeRunSeconds: distribution(complete.map((r) => r.simulationSeconds)),
    completeRunIncomingDamage: distribution(
      complete.map((r) => r.incomingDamage),
    ),
    completeRunHealing: distribution(complete.map((r) => r.healing)),
    completeRunDamageDealt: distribution(complete.map((r) => r.damageDealt)),
    completeRunUpgrades: distribution(complete.map((r) => r.upgrades)),
    completeRunResources: distribution(complete.map((r) => r.resources)),
    completeRunResourceCapSeconds: distribution(
      complete.map((r) => r.resourceCapSeconds),
    ),
    botWallClockMs: distribution(group.map((r) => r.botWallClockMs)),
    maximumSampledStateBytes: Math.max(...group.map((r) => r.maxStateBytes)),
    engineStepP95Ms: distribution(group.map((r) => r.engineStepProfile.p95Ms)),
    engineStepMaximumMs: Math.max(
      ...group.map((r) => r.engineStepProfile.maxMs),
    ),
  };
}
const rooms = runs.flatMap((r) => r.rooms);
const byRoomKind = Object.fromEntries(
  [...new Set(rooms.map((r) => r.kind))].sort().map((kind) => {
    const group = rooms.filter((r) => r.kind === kind && r.complete);
    return [
      kind,
      {
        cleared: group.length,
        seconds: distribution(group.map((r) => r.seconds)),
        damagePerSecond: distribution(group.map((r) => r.damagePerSecond)),
        incomingDamage: distribution(group.map((r) => r.incomingDamage)),
        healing: distribution(group.map((r) => r.healing)),
        resourcesNet: distribution(group.map((r) => r.resourcesNet)),
        upgradesGained: distribution(group.map((r) => r.upgradesGained.length)),
      },
    ];
  }),
);
const byBoss = Object.fromEntries(
  [...new Set(rooms.flatMap((r) => (r.bossName ? [r.bossName] : [])))].map(
    (name) => {
      const group = rooms.filter((r) => r.bossName === name && r.complete);
      return [
        name,
        {
          clears: group.length,
          seconds: distribution(group.map((r) => r.seconds)),
          incomingDamage: distribution(group.map((r) => r.incomingDamage)),
          observedAttacks: distribution(group.map((r) => r.bossAttacks)),
          allThreePhasesObserved: group.filter(
            (r) => r.bossPhasesSeen.length >= 3,
          ).length,
        },
      ];
    },
  ),
);
const byDistrict = Object.fromEntries(
  Array.from({ length: 8 }, (_, i) => {
    const group = rooms.filter((r) => r.district === i + 1 && r.complete);
    return [
      i + 1,
      {
        clearedRooms: group.length,
        roomSeconds: distribution(group.map((r) => r.seconds)),
        incomingDamage: distribution(group.map((r) => r.incomingDamage)),
        damagePerSecond: distribution(group.map((r) => r.damagePerSecond)),
        upgradesAtExit: distribution(group.map((r) => r.upgrades)),
        resourcesAtExit: distribution(group.map((r) => r.resources)),
      },
    ];
  }),
);
const report = {
  schemaVersion: 1,
  startedAt,
  completedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpuModel: cpus()[0]?.model,
    garbageCollectionEnabled: Boolean(collection),
  },
  methodology: {
    seeds: seedValues,
    weapons: weaponValues,
    difficulties,
    routes,
    ordinaryControlsOnly: true,
    fixedStepSeconds: 0.04,
    maxSeconds: 7200,
    decisionTimeModeled: false,
    browserRenderingMeasured: false,
    explanation:
      "Deterministic visible-geometry heuristic. Menus and choices are instant. This is not normal human run duration. Engine-step timings exclude drawing, browser input and network. Heap samples include bot instrumentation and retained measurement objects; collection deltas cannot demonstrate a gameplay leak.",
  },
  sourceBefore,
  sourceAfter,
  sourceUnchangedDuringMeasurement,
  summary: summarize(runs),
  byWeapon: Object.fromEntries(
    weaponValues.map((weapon) => [
      weapon,
      summarize(runs.filter((r) => r.weapon === weapon)),
    ]),
  ),
  byDifficulty: Object.fromEntries(
    difficulties.map((difficulty) => [
      difficulty,
      summarize(runs.filter((r) => r.difficulty === difficulty)),
    ]),
  ),
  byRoute: Object.fromEntries(
    routes.map((route) => [
      route,
      summarize(runs.filter((r) => r.routeStrategy === route)),
    ]),
  ),
  byRoomKind,
  byBoss,
  byDistrict,
  heapCollectedRunDeltaBytes: distribution(
    runs.flatMap((r) =>
      r.collectedHeapAfterBytes !== null && r.collectedHeapBeforeBytes !== null
        ? [r.collectedHeapAfterBytes - r.collectedHeapBeforeBytes]
        : [],
    ),
  ),
  totalBossClears: wins.reduce((sum, r) => sum + r.bossesDefeated, 0),
  runs,
};
const destination = resolve(".local/verification/ego-playtest-goals5.json");
await mkdir(resolve(".local/verification"), { recursive: true });
await writeFile(destination, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    { destination, sourceUnchangedDuringMeasurement, summary: report.summary },
    null,
    2,
  ),
);
if (!sourceUnchangedDuringMeasurement) process.exitCode = 2;
