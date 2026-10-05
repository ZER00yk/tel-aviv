import { z } from "zod";
import {
  chooseMod,
  newWorld,
  newCampaignWorld,
  chooseRoute,
  eventChoice,
  nextEncounter,
  shop,
  stepWorld,
  type Input,
  type World,
} from "../ego-trip/engine";
import { bosses, weapons, type WeaponId } from "../ego-trip/content";
import { GameRuleError } from "./rules";

export const EGO_RANKED_VERSION = "ego-ranked-4.0.0";
export const rankedInputSchema = z
  .object({
    x: z.number().finite().min(-1).max(1),
    y: z.number().finite().min(-1).max(1),
    aimX: z.number().finite().min(0).max(900),
    aimY: z.number().finite().min(0).max(560),
    attack: z.boolean(),
    alternate: z.boolean(),
    dash: z.boolean(),
  })
  .strict();
export type RankedDifficulty = "standard" | "volatile";
export type RankedModifier = "fragile" | "no-helper";
export interface EgoRankedState {
  version: 1;
  mode?: "boss-gauntlet" | "campaign";
  world: World;
  input: Input;
  lastServerTick: number;
  simulatedMs: number;
  idleMs: number;
  damageTaken: number;
  difficulty: RankedDifficulty;
  modifiers: RankedModifier[];
  bossCount: number;
}
export interface EgoPermanentProgress {
  bosses: string[];
  completions: number;
  runs: number;
  insight: number;
  unlockedWeapons: string[];
  unlockedHelpers: ("gunner" | "medic")[];
  challenges: string[];
  discoveries: string[];
  coopCompletions: number;
}
export const neutralRankedInput: Input = {
  x: 0,
  y: 0,
  aimX: 450,
  aimY: 170,
  attack: false,
  alternate: false,
  dash: false,
};

export function egoUnlocks(
  bossNames: string[],
  completions = 0,
  runs = 0,
  insight = 0,
  discoveries: string[] = [],
  coopCompletions = 0,
): EgoPermanentProgress {
  const names = new Set(bossNames);
  const unlockedWeapons = ["pulse", "scatter", "blade"];
  for (const [name, weapon] of [
    ["Rowan", "comet"],
    ["Bennett", "lance"],
    ["Austin", "boomerang"],
    ["Dakota", "prism"],
  ])
    if (names.has(name) && Object.hasOwn(weapons, weapon))
      unlockedWeapons.push(weapon);
  return {
    bosses: [...names],
    completions,
    runs,
    insight,
    discoveries,
    coopCompletions,
    unlockedWeapons,
    unlockedHelpers: [
      ...(names.has("Rowan") ? ["gunner" as const] : []),
      ...(names.has("Bennett") ? ["medic" as const] : []),
    ],
    challenges: names.has("Austin") ? ["volatile", "fragile", "no-helper"] : [],
  };
}

function scaleBoss(state: EgoRankedState) {
  if (state.difficulty === "volatile") {
    state.world.boss.hp *= 1.2;
    state.world.boss.maxHp *= 1.2;
  }
}
export function newEgoRanked(
  weapon: WeaponId,
  seed: number,
  now: number,
  difficulty: RankedDifficulty = "standard",
  modifiers: RankedModifier[] = [],
  helper: "gunner" | "medic" | null = null,
  mode: "boss-gauntlet" | "campaign" = "boss-gauntlet",
): EgoRankedState {
  const world =
    mode === "campaign"
      ? newCampaignWorld(weapon, seed, { difficulty })
      : newWorld(weapon, seed, { bossCount: bosses.length });
  if (helper)
    world.helper = { kind: helper, hp: helper === "medic" ? 50 : 40, timer: 0 };
  if (modifiers.includes("fragile")) world.player.hp = world.player.maxHp = 70;
  const state: EgoRankedState = {
    version: 1,
    mode,
    world,
    input: { ...neutralRankedInput },
    lastServerTick: now,
    simulatedMs: 0,
    idleMs: 0,
    damageTaken: 0,
    difficulty,
    modifiers: [...modifiers],
    bossCount: bosses.length,
  };
  if (mode === "boss-gauntlet") scaleBoss(state);
  return state;
}

/** Only elapsed server time drives the engine. Browser durations/outcomes are never accepted. */
export function advanceEgoRanked(state: EgoRankedState, now: number) {
  if (!Number.isFinite(now) || now < state.lastServerTick) return;
  const elapsed = now - state.lastServerTick;
  state.lastServerTick = now;
  if (elapsed > 1000) {
    // A suspended tab or reconnect freezes combat rather than replaying minutes of held fire.
    state.idleMs += elapsed;
    state.input = { ...neutralRankedInput };
    return;
  }
  if (state.world.stage !== "fight") return;
  let remaining = elapsed / 1000;
  while (remaining > 0.000001 && state.world.stage === "fight") {
    const seconds = Math.min(0.025, remaining);
    const oldHp = state.world.player.hp;
    stepWorld(state.world, state.input, seconds);
    if (state.modifiers.includes("no-helper")) state.world.helper = null;
    const damage = Math.max(0, oldHp - state.world.player.hp);
    if (damage && state.difficulty === "volatile") {
      state.world.player.hp = Math.max(
        0,
        state.world.player.hp - damage * 0.25,
      );
      if (state.world.player.hp === 0) state.world.stage = "lost";
    }
    state.damageTaken += Math.max(0, oldHp - state.world.player.hp);
    state.simulatedMs += seconds * 1000;
    remaining -= seconds;
  }
}

export function actEgoRanked(
  state: EgoRankedState,
  command: string,
  payload: Record<string, unknown>,
  now: number,
) {
  if (state.version !== 1)
    throw new GameRuleError("Unsupported ranked state preserved");
  if (
    !Number.isInteger(state.world.kills) ||
    state.world.kills < 0 ||
    state.world.kills > state.bossCount ||
    !Number.isInteger(state.world.bossIndex) ||
    state.world.bossIndex < 0 ||
    state.world.bossIndex >= state.bossCount ||
    !Number.isFinite(state.world.player.hp) ||
    !Number.isFinite(state.world.player.maxHp) ||
    state.world.player.hp < 0 ||
    state.world.player.hp > state.world.player.maxHp ||
    state.world.player.maxHp > 1000 ||
    !Number.isFinite(state.world.boss.hp) ||
    !Number.isFinite(state.world.boss.maxHp) ||
    ((state.mode ?? "boss-gauntlet") === "boss-gauntlet" &&
      state.world.campaign !== null) ||
    (state.mode === "campaign" && !validCampaignProgress(state)) ||
    (!state.world.campaign &&
      state.world.stage === "fight" &&
      state.world.kills !== state.world.bossIndex) ||
    (!state.world.campaign &&
      ["choice", "shop"].includes(state.world.stage) &&
      state.world.kills !== state.world.bossIndex + 1) ||
    !Number.isFinite(state.lastServerTick) ||
    !Number.isFinite(state.simulatedMs)
  )
    throw new GameRuleError(
      "Ranked state is inconsistent; the stored run is preserved",
    );
  if (state.world.stage === "won" || state.world.stage === "lost")
    throw new GameRuleError("This ranked run has ended");
  if (command === "input") {
    const input = rankedInputSchema.safeParse(payload);
    if (!input.success) throw new GameRuleError("Invalid ranked controls");
    advanceEgoRanked(state, now);
    state.input = input.data;
  } else if (command === "mod") {
    const input = z
      .object({ id: z.string().min(1).max(40) })
      .strict()
      .safeParse(payload);
    if (!input.success || !chooseMod(state.world, input.data.id))
      throw new GameRuleError("Choose an offered mod");
    if (state.modifiers.includes("no-helper")) state.world.helper = null;
    state.lastServerTick = now;
  } else if (command === "shop") {
    const input = z
      .object({ choice: z.enum(["heal", "helper", "mod", "risk"]) })
      .strict()
      .safeParse(payload);
    if (
      !input.success ||
      (input.data.choice === "helper" &&
        state.modifiers.includes("no-helper")) ||
      !shop(state.world, input.data.choice)
    )
      throw new GameRuleError("This shop purchase is unavailable");
  } else if (command === "continue") {
    if (Object.keys(payload).length || state.world.stage !== "shop")
      throw new GameRuleError(
        "Finish the boss and choose a mod before continuing",
      );
    nextEncounter(state.world);
    if (!state.world.campaign) scaleBoss(state);
    state.input = { ...neutralRankedInput };
    state.lastServerTick = now;
  } else if (command === "route") {
    const route = z
      .object({ id: z.string().min(1).max(100) })
      .strict()
      .safeParse(payload);
    if (
      !route.success ||
      !state.world.campaign ||
      !chooseRoute(state.world, route.data.id)
    )
      throw new GameRuleError("Choose a server-offered campaign route");
    state.input = { ...neutralRankedInput };
    state.lastServerTick = now;
  } else if (command === "event") {
    const event = z
      .object({
        choice: z.enum([
          "safe",
          "risk",
          "gunner",
          "medic",
          "sell",
          "buy",
          "pulse",
          "scatter",
          "blade",
          "comet",
          "lance",
          "boomerang",
          "prism",
        ]),
      })
      .strict()
      .safeParse(payload);
    if (
      !event.success ||
      !state.world.campaign ||
      (state.modifiers.includes("no-helper") &&
        ["gunner", "medic"].includes(event.data.choice)) ||
      !eventChoice(state.world, event.data.choice)
    )
      throw new GameRuleError("This campaign event choice is unavailable");
    if (state.modifiers.includes("no-helper")) state.world.helper = null;
    state.input = { ...neutralRankedInput };
    state.lastServerTick = now;
  } else throw new GameRuleError("Unknown ranked intent");
  if (
    state.world.mods.length > 100 ||
    state.world.bullets.length > 500 ||
    state.world.hazards.length > 300
  )
    throw new GameRuleError("Ranked simulation capacity exceeded");
  return state;
}

/** Validate the server checkpoint before any mutation; every route must belong to the live room. */
function validCampaignProgress(state: EgoRankedState) {
  const c = state.world.campaign;
  if (!c || c.contentVersion !== 2 || c.length !== 40 || c.mode === "endless")
    return false;
  const afterClear = ["route", "choice", "won"].includes(state.world.stage);
  const expectedKills =
    Math.floor(c.roomIndex / 5) +
    (c.room.kind === "boss" && afterClear ? 1 : 0);
  return (
    Number.isInteger(c.roomIndex) &&
    c.roomIndex >= 0 &&
    c.roomIndex < 40 &&
    c.path.length === c.roomIndex + 1 &&
    c.path.at(-1) === c.room.kind &&
    c.cleared === c.roomIndex + (afterClear ? 1 : 0) &&
    state.world.kills === expectedKills &&
    state.world.bossIndex === Math.floor(c.roomIndex / 5) &&
    c.routes.every((route) => route.id.startsWith(`${c.roomIndex + 1}:`))
  );
}

export function rankedStatistics(state: EgoRankedState) {
  return {
    mode: state.mode ?? "boss-gauntlet",
    roomsCleared: state.world.campaign?.cleared ?? state.world.kills,
    roomIndex: state.world.campaign?.roomIndex ?? state.world.bossIndex,
    route: state.world.campaign?.path ?? [],
    secrets: state.world.campaign?.secrets ?? [],
    runResources: state.world.ego,
    bossesDefeated: state.world.kills,
    finalBossReached:
      bosses[Math.min(state.world.bossIndex, bosses.length - 1)]?.name ?? null,
    shots: state.world.shots,
    hits: state.world.hits,
    simulatedMs: Math.round(state.simulatedMs),
    idleMs: Math.round(state.idleMs),
    damageTaken: Math.round(state.damageTaken),
    weapon: state.world.weapon,
    modifiers: state.world.mods,
    deaths: state.world.stage === "lost" ? 1 : 0,
  };
}
