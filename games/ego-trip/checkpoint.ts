import { z } from "zod";
import type { World } from "./engine";
import { bosses } from "./content";

const number = z.number().finite();
const nonnegative = number.min(0);
const position = {
  x: number.min(-1000).max(2000),
  y: number.min(-1000).max(2000),
};
const health = {
  hp: number.min(-10000).max(10000),
  maxHp: nonnegative.max(10000),
};
const weapon = z.enum([
  "pulse",
  "scatter",
  "blade",
  "comet",
  "lance",
  "boomerang",
  "prism",
]);
const mod = z.enum([
  "orbit",
  "split",
  "venom",
  "shield",
  "tempo",
  "dash",
  "vampire",
  "critical",
  "helper",
  "ricochet",
  "refraction",
  "heat-sink",
  "promise",
  "finale",
  "reach",
  "momentum",
  "guardian",
  "parry",
  "glass",
  "boss-hunter",
  "return",
  "anchor",
  "mercy",
]);
const route = z.object({
  id: z.string().max(100),
  kind: z.enum([
    "battle",
    "elite",
    "miniboss",
    "boss",
    "shop",
    "shrine",
    "helper",
    "treasure",
    "trade",
    "weapon",
    "challenge",
    "secret",
    "environment",
    "survival",
    "npc",
    "curse",
    "rare",
    "protect",
    "trial",
  ]),
  name: z.string().max(200),
  description: z.string().max(500),
});
const checkpoint = z.object({
  stage: z.enum(["fight", "choice", "shop", "route", "event", "won", "lost"]),
  time: nonnegative.max(1e8),
  bossIndex: z
    .number()
    .int()
    .min(0)
    .max(bosses.length - 1),
  bossCount: z.number().int().min(1).max(bosses.length).optional(),
  promiseUsed: z.boolean().optional(),
  telemetry: z
    .object({
      damageDealt: nonnegative.max(1e10),
      damageTaken: nonnegative.max(1e10),
      healing: nonnegative.max(1e10),
    })
    .optional(),
  player: z.object({
    ...position,
    ...health,
    dashTime: nonnegative.max(10),
    dashCooldown: nonnegative.max(100),
    invulnerable: nonnegative.max(100),
    vx: number.max(10000).min(-10000),
    vy: number.max(10000).min(-10000),
    stillTime: nonnegative.max(1e8).optional(),
    guard: nonnegative.max(1).optional(),
  }),
  boss: z.object({
    ...position,
    ...health,
    phase: z.number().int().min(1).max(3),
    opening: nonnegative.max(10).optional(),
    recoveryDelay: nonnegative.max(100).optional(),
    attackTimer: number.min(-100).max(1000),
    attackIndex: z.number().int().min(0).max(1e7),
    poison: nonnegative.max(100),
    chargeTime: number.min(-10).max(10),
    vx: number.min(-10000).max(10000),
    vy: number.min(-10000).max(10000),
  }),
  bullets: z
    .array(
      z.object({
        ...position,
        vx: number.min(-10000).max(10000),
        vy: number.min(-10000).max(10000),
        life: number.min(-10).max(100),
        damage: nonnegative.max(10000),
        radius: nonnegative.max(500),
        enemy: z.boolean(),
        explosive: z.boolean(),
        bounces: z.number().int().min(0).max(1).optional(),
        piercing: z.number().int().min(0).max(5).optional(),
        returning: z.boolean().optional(),
        returnTime: number.min(-100).max(100).optional(),
        hitIds: z
          .array(z.number().int().min(-1).max(1000000))
          .max(100)
          .optional(),
      }),
    )
    .max(1000),
  hazards: z
    .array(
      z.object({
        ...position,
        kind: z.enum(["circle", "line", "ring"]),
        x2: number,
        y2: number,
        radius: nonnegative.max(2000),
        safeRadius: nonnegative.max(2000),
        timer: number.min(-100).max(100),
        active: number.min(-100).max(100),
        damage: nonnegative.max(1000),
        color: z.number().int().min(0).max(0xffffff),
      }),
    )
    .max(500),
  weapon,
  mods: z.array(mod).max(500),
  offered: z.array(mod).max(10),
  ego: nonnegative.max(1e8),
  kills: z.number().int().min(0).max(10000),
  shots: z.number().int().min(0).max(1e8),
  hits: z.number().int().min(0).max(1e8),
  cooldown: number.min(-1e8).max(100),
  alternateCooldown: number.min(-1e8).max(100),
  helper: z
    .object({
      kind: z.enum(["gunner", "medic"]),
      hp: number.min(0).max(1000),
      timer: number.min(-10).max(100),
    })
    .nullable(),
  message: z.string().max(1000),
  seed: z.number().int().min(0).max(0xffffffff),
  enemies: z
    .array(
      z.object({
        ...position,
        ...health,
        id: z.number().int().min(0).max(1000000),
        kind: z.enum([
          "runner",
          "sentry",
          "anchor",
          "weaver",
          "splitter",
          "bulwark",
        ]),
        spawned: z.boolean().optional(),
        timer: number.min(-100).max(100),
        poison: nonnegative.max(100),
        speed: nonnegative.max(1000),
      }),
    )
    .max(100)
    .default([]),
  campaign: z
    .object({
      version: z.literal(1),
      length: z.number().int().min(20).max(40).optional(),
      contentVersion: z.literal(2).optional(),
      pacingVersion: z.literal(1).optional(),
      journey: z.object({
        stage: z.number().int().min(1).max(7),
        stages: z.number().int().min(1).max(6),
        bossPhase: z.number().int().min(1).max(3),
        completedStages: z.number().int().min(0).max(100000),
      }).optional(),
      wave: z.number().int().min(1).max(6).optional(),
      totalWaves: z.number().int().min(1).max(6).optional(),
      roomDamage: nonnegative.max(1e8).optional(),
      objective: z
        .object({
          kind: z.enum(["relay", "beacons", "parcel", "ward", "escort"]),
          carrying: z.boolean().optional(),
          ...position,
          ...health,
          progress: nonnegative.max(1e8),
          target: nonnegative.max(100),
          spawned: z.number().int().min(0).max(1e8),
        })
        .optional(),
      roomStartedAt: nonnegative.max(1e8).optional(),
      refusals: z.number().int().min(0).max(10000).optional(),
      signalKey: z.boolean().optional(),
      secrets: z
        .array(z.enum(["restored-relay", "pilgrims-refuge"]))
        .max(2)
        .optional(),
      initialSeed: z.number().int().min(0).max(0xffffffff),
      mode: z.enum(["normal", "seeded", "daily", "endless"]),
      difficulty: z.enum(["standard", "volatile"]),
      roomIndex: z.number().int().min(0).max(10000),
      room: route,
      routes: z.array(route).max(10),
      cleared: z.number().int().min(0).max(10000),
      enemyKills: z.number().int().min(0).max(1e7),
      path: z.array(z.string().max(100)).max(10000),
      secretUnlocked: z.boolean(),
      rewardMultiplier: nonnegative.max(10),
      eventResolved: z.boolean(),
      lastEvent: z.string().max(1000),
    })
    .nullable()
    .default(null),
});

/** Schema-1 boss-rush saves gain only missing fields; their progress is retained. */
export function normalizeCheckpoint(value: unknown): World | null {
  const parsed = checkpoint.safeParse(value);
  if (!parsed.success) return null;
  const world = parsed.data;
  if (world.player.hp > world.player.maxHp) return null;
  if (!world.campaign && ["route", "event"].includes(world.stage)) return null;
  if (world.campaign?.pacingVersion && world.stage === "fight" && !world.campaign.journey) return null;
  if (!world.campaign?.pacingVersion && (world.campaign?.journey || ["parcel", "ward", "escort"].includes(world.campaign?.objective?.kind ?? ""))) return null;
  return world;
}

export interface SoloSave {
  version: 1;
  bestClears: number;
  runs: number;
  unlocked: string[];
  insight: number;
  unlocks: string[];
  bestRooms: number;
  lastRunId: string;
  checkpoint: World | null;
  /** Local discovery journal; verified platform achievements belong to ranked runs. */
  journal: string[];
}
export const initialSave: SoloSave = {
  version: 1,
  bestClears: 0,
  runs: 0,
  unlocked: ["pulse", "blade"],
  insight: 0,
  unlocks: [],
  bestRooms: 0,
  lastRunId: "",
  checkpoint: null,
  journal: [],
};
const saveSchema = z.object({
  version: z.literal(1),
  bestClears: nonnegative.max(10000),
  runs: nonnegative.max(1e8),
  unlocked: z.array(weapon).max(10),
  insight: nonnegative.max(1e8).default(0),
  unlocks: z
    .array(z.enum(["starting-gunner", "starting-medic", "secret-paths"]))
    .max(10)
    .default([]),
  bestRooms: nonnegative.max(10000).default(0),
  checkpoint: z.unknown().nullable(),
  journal: z.array(z.string().max(100)).max(40).default([]),
  lastRunId: z.string().max(100).default(""),
});
export function normalizeSave(value: unknown): SoloSave | null {
  const parsed = saveSchema.safeParse(value);
  if (!parsed.success) return null;
  const world = normalizeCheckpoint(parsed.data.checkpoint);
  if (parsed.data.checkpoint != null && !world) return null;
  return { ...parsed.data, checkpoint: world };
}
export function insightForRun(w: World) {
  return w.campaign
    ? Math.floor(w.campaign.cleared / 2) + w.kills * 3
    : w.kills * 3;
}
export function completeRun(save: SoloSave, w: World): SoloSave {
  if (w.stage !== "won" && w.stage !== "lost") return save;
  const runId = `${w.campaign?.initialSeed ?? w.seed}:${w.time.toFixed(3)}:${w.stage}`;
  if (save.lastRunId === runId) return save;
  const journal = [
    ...new Set([
      ...save.journal,
      ...bosses
        .slice(0, Math.min(w.kills, bosses.length))
        .map((boss) => boss.achievement),
      ...(w.campaign?.secrets ?? []),
      ...(w.stage === "won" && w.campaign?.contentVersion === 2
        ? [
            "eight-districts",
            ...(w.campaign.difficulty === "volatile"
              ? ["volatile-victory"]
              : []),
          ]
        : []),
    ]),
  ];
  return {
    ...save,
    journal,
    runs: save.runs + 1,
    bestClears: Math.max(save.bestClears, w.kills),
    bestRooms: Math.max(save.bestRooms, w.campaign?.cleared ?? w.kills),
    insight: save.insight + insightForRun(w),
    lastRunId: runId,
    unlocked: [
      ...new Set([
        ...save.unlocked,
        ...(w.kills >= 1 ? ["scatter"] : []),
        ...(w.kills >= 2 ? ["comet", "lance"] : []),
        ...(w.kills >= 3 ? ["boomerang"] : []),
        ...(w.kills >= 4 || w.campaign?.secrets?.includes("restored-relay")
          ? ["prism"]
          : []),
      ]),
    ],
    checkpoint: w,
  };
}
