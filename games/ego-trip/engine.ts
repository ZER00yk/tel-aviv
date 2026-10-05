import {
  bosses,
  weapons,
  mods,
  modLimits,
  CLASSIC_BOSS_COUNT,
  CAMPAIGN_ROOM_COUNT,
  type WeaponId,
} from "./content";
import {
  campaignRandom,
  campaignLength,
  encounterName,
  isCombatRoom,
  isPatrol,
  openRoutes,
  routeFor,
  sector,
  resolveEvent,
  type CampaignMode,
  type CampaignState,
  type Difficulty,
  type EventChoice,
} from "./campaign";
import { arenaFor, keepOutsideCover } from "./arena";
import { journeyStageCount, journeyStageDefinition, JOURNEY_MOD_LIMIT, JOURNEY_RULES } from "./journey";
import {
  healPlayer,
  grantEgo,
  damageTarget,
  type CombatTelemetry,
} from "./telemetry";
export interface Vec {
  x: number;
  y: number;
}
export interface Bullet extends Vec {
  vx: number;
  vy: number;
  life: number;
  damage: number;
  radius: number;
  enemy: boolean;
  explosive: boolean;
  bounces?: number;
  piercing?: number;
  returning?: boolean;
  returnTime?: number;
  hitIds?: number[];
}
export interface Enemy extends Vec {
  id: number;
  kind: "runner" | "sentry" | "anchor" | "weaver" | "splitter" | "bulwark";
  spawned?: boolean;
  hp: number;
  maxHp: number;
  timer: number;
  poison: number;
  speed: number;
}
export interface Hazard extends Vec {
  kind: "circle" | "line" | "ring";
  x2: number;
  y2: number;
  radius: number;
  safeRadius: number;
  timer: number;
  active: number;
  damage: number;
  color: number;
}
export interface Input {
  x: number;
  y: number;
  aimX: number;
  aimY: number;
  attack: boolean;
  alternate: boolean;
  dash: boolean;
}
export interface World {
  stage: "fight" | "choice" | "shop" | "route" | "event" | "won" | "lost";
  time: number;
  bossIndex: number;
  /** Legacy boss-rush checkpoints default to four. */
  bossCount?: number;
  promiseUsed?: boolean;
  telemetry?: CombatTelemetry;
  player: Vec & {
    hp: number;
    maxHp: number;
    dashTime: number;
    dashCooldown: number;
    invulnerable: number;
    vx: number;
    vy: number;
    stillTime?: number;
    guard?: number;
  };
  boss: Vec & {
    hp: number;
    maxHp: number;
    phase: number;
    attackTimer: number;
    attackIndex: number;
    opening?: number;
    recoveryDelay?: number;
    poison: number;
    chargeTime: number;
    vx: number;
    vy: number;
  };
  bullets: Bullet[];
  hazards: Hazard[];
  weapon: WeaponId;
  mods: string[];
  offered: string[];
  ego: number;
  kills: number;
  shots: number;
  hits: number;
  cooldown: number;
  alternateCooldown: number;
  helper: { kind: "gunner" | "medic"; hp: number; timer: number } | null;
  message: string;
  seed: number;
  enemies: Enemy[];
  campaign: CampaignState | null;
}
export const WIDTH = 900,
  HEIGHT = 560;
function rng(w: World) {
  return campaignRandom(w);
}
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const length = (v: Vec) => Math.hypot(v.x, v.y) || 1;
export function newWorld(
  weapon: WeaponId = "pulse",
  seed = Date.now(),
  options: { bossCount?: number } = {},
): World {
  const b = bosses[0];
  return {
    stage: "fight",
    time: 0,
    bossIndex: 0,
    bossCount: Math.max(
      1,
      Math.min(
        bosses.length,
        Math.floor(options.bossCount ?? CLASSIC_BOSS_COUNT),
      ),
    ),
    promiseUsed: false,
    telemetry: { damageDealt: 0, damageTaken: 0, healing: 0 },
    player: {
      x: 450,
      y: 430,
      hp: 100,
      maxHp: 100,
      dashTime: 0,
      dashCooldown: 0,
      invulnerable: 0,
      vx: 0,
      vy: 0,
    },
    boss: {
      x: 450,
      y: 170,
      hp: b.hp,
      maxHp: b.hp,
      phase: 1,
      attackTimer: 1.8,
      attackIndex: 0,
      poison: 0,
      chargeTime: 0,
      vx: 0,
      vy: 0,
    },
    bullets: [],
    hazards: [],
    weapon,
    mods: [],
    offered: [],
    ego: 0,
    kills: 0,
    shots: 0,
    hits: 0,
    cooldown: 0,
    alternateCooldown: 0,
    helper: null,
    message: b.dialogue,
    seed: seed >>> 0,
    enemies: [],
    campaign: null,
  };
}
export function newCampaignWorld(
  weapon: WeaponId = "pulse",
  seed = Date.now(),
  options: {
    mode?: CampaignMode;
    difficulty?: Difficulty;
    secretUnlocked?: boolean;
    helper?: "gunner" | "medic" | null;
    /** Explicit null is reserved for preserved compact encounters and deterministic legacy fixtures. */
    pacingVersion?: 1 | null;
  } = {},
): World {
  const w = newWorld(weapon, seed, { bossCount: bosses.length });
  w.campaign = {
    version: 1,
    contentVersion: 2,
    ...(options.pacingVersion === null ? {} : { pacingVersion: 1 as const }),
    length: CAMPAIGN_ROOM_COUNT,
    wave: 1,
    totalWaves: 1,
    roomDamage: 0,
    roomStartedAt: 0,
    refusals: 0,
    signalKey: false,
    secrets: [],
    initialSeed: seed >>> 0,
    mode: options.mode ?? "normal",
    difficulty: options.difficulty ?? "standard",
    roomIndex: 0,
    room: routeFor("battle", 0),
    routes: [],
    cleared: 0,
    enemyKills: 0,
    path: ["battle"],
    secretUnlocked: options.secretUnlocked ?? false,
    rewardMultiplier: 1,
    eventResolved: false,
    lastEvent: "",
  };
  if (options.helper)
    w.helper = {
      kind: options.helper,
      hp: options.helper === "medic" ? 50 : 40,
      timer: 0,
    };
  startCampaignRoom(w);
  return w;
}
function startCampaignRoom(w: World) {
  const c = w.campaign!;
  const district = sector(w);
  w.bossIndex =
    district % (c.contentVersion === 2 ? bosses.length : CLASSIC_BOSS_COUNT);
  w.bullets = [];
  w.hazards = [];
  w.enemies = [];
  w.offered = [];
  w.player.x = 450;
  w.player.y = 445;
  w.player.invulnerable = 1;
  w.player.dashTime = 0;
  c.eventResolved = false;
  c.roomDamage = 0;
  delete c.objective;
  delete c.journey;
  if (!c.pacingVersion && c.room.kind === "protect")
    c.objective = {
      kind: "relay",
      x: 450,
      y: 280,
      hp: 120,
      maxHp: 120,
      progress: 0,
      target: 35,
      spawned: 0,
    };
  if (!c.pacingVersion && c.room.kind === "trial")
    c.objective = {
      kind: "beacons",
      x: 150,
      y: 430,
      hp: 1,
      maxHp: 1,
      progress: 0,
      target: 4,
      spawned: 0,
    };
  c.roomStartedAt = w.time;
  c.wave = 1;
  c.totalWaves =
    c.room.kind === "survival"
      ? 3
      : ["elite", "environment"].includes(c.room.kind) && c.contentVersion === 2
        ? 2
        : 1;
  w.promiseUsed = false;
  c.rewardMultiplier = ["elite", "challenge", "survival"].includes(c.room.kind)
    ? 2
    : 1;
  w.message = c.room.description;
  if (!isCombatRoom(c.room.kind)) {
    w.stage = c.room.kind === "shop" ? "shop" : "event";
    return;
  }
  w.stage = "fight";
  const difficulty = c.difficulty === "volatile" ? 1.25 : 1;
  const scaling = difficulty * (1 + Math.max(0, district - 7) * 0.15);
  if (isPatrol(w)) {
    if (!c.pacingVersion && c.room.kind !== "trial") spawnWave(w, scaling);
    w.boss.hp = 0;
    w.boss.maxHp = 0;
  } else {
    const miniboss = c.room.kind === "miniboss";
    const hp = Math.round(
      (miniboss ? 170 + district * 40 : bosses[w.bossIndex].hp) * scaling,
    );
    w.boss = {
      x: 450,
      y: 150,
      hp,
      maxHp: hp,
      phase: 1,
      attackTimer: 1.7,
      attackIndex: 0,
      poison: 0,
      chargeTime: 0,
      vx: 0,
      vy: 0,
    };
    w.message = miniboss
      ? `${encounterName(w)}: ${district % 2 ? "Every step has a beat." : "I decide what gets erased."}`
      : bosses[w.bossIndex].dialogue;
  }
  if (c.pacingVersion) {
    c.journey = { stage: 1, stages: journeyStageCount(c.room.kind, district), bossPhase: 1, completedStages: 0 };
    startJourneyStage(w);
  }
}
/** Gate every damage source, including poison and explosive secondary hits. */
function journeyShielded(w: World) {
  const c = w.campaign;
  return !!c?.pacingVersion && !!c.journey && c.journey.stage <= c.journey.stages;
}
function damageCombatTarget(w: World, target: { hp: number }, amount: number) {
  if (target === w.boss && w.campaign?.pacingVersion) {
    if (journeyShielded(w)) return;
    const phase = w.campaign.journey?.bossPhase ?? 1;
    const floor = w.campaign.room.kind === "boss" ? w.boss.maxHp * (1 - phase / 3) : 0;
    amount = Math.min(amount, Math.max(0, target.hp - floor));
  }
  damageTarget(w, target, amount);
}
function combatTargets(w: World) {
  if (isPatrol(w)) return w.enemies;
  return w.enemies.length ? [...w.enemies, w.boss] : [w.boss];
}
function startJourneyStage(w: World) {
  const c = w.campaign!, j = c.journey!;
  const definition = journeyStageDefinition(c.room.kind, sector(w), j.stage - 1, j.bossPhase);
  delete c.objective;
  c.wave = j.stage;
  c.totalWaves = j.stages;
  w.bullets = [];
  w.hazards = [];
  w.enemies = [];
  const district = sector(w), difficulty = c.difficulty === "volatile" ? 1.2 : 1;
  for (const [index, kind] of definition.squad.entries()) {
    const hp = Math.round((kind === "bulwark" ? 60 : kind === "anchor" ? 48 : 30) * (1 + district * 0.06) * difficulty);
    const enemy: Enemy = {
      id: j.bossPhase * 100000 + j.stage * 1000 + index,
      kind, x: 80 + rng(w) * 740, y: 70 + rng(w) * 270,
      hp, maxHp: hp, timer: 1.2 + rng(w) * 1.5, poison: 0,
      speed: kind === "runner" || kind === "splitter" ? 72 + district * 3 : kind === "weaver" ? 64 : 32,
    };
    keepOutsideCover(enemy, arenaFor(w.bossIndex).terrain, 17);
    w.enemies.push(enemy);
  }
  w.player.invulnerable = Math.max(w.player.invulnerable, 0.8);
  w.message = `Stage ${j.stage}/${j.stages}${c.room.kind === "boss" ? ` · phase ${j.bossPhase}/3` : ""}: break the patrol, then ${definition.kind === "courier" ? "recover and deliver two signals" : definition.kind === "ward" ? "cross the marked wards" : "carry the transmitter through its marked route"}.`;
}
function activateJourneyObjective(w: World) {
  const c = w.campaign!, j = c.journey!;
  const definition = journeyStageDefinition(c.room.kind, sector(w), j.stage - 1, j.bossPhase);
  const first = definition.checkpoints[0];
  c.objective = {
    kind: definition.kind === "courier" ? "parcel" : definition.kind,
    ...first, hp: 1, maxHp: 1, progress: 0, target: definition.checkpoints.length, spawned: 0, carrying: false,
  };
  w.bullets = w.bullets.filter((shot) => !shot.enemy);
  w.message = definition.kind === "courier" ? "Recover the marked signal. Carrying slows movement and prevents dashing; deliver it to the next mark." : definition.kind === "ward" ? "The patrol is broken. Cross the marked wards in order and read the crossing warnings." : "Recover the transmitter, then escort it through every marked landmark. Carrying slows movement and prevents dashing.";
}
function stepJourney(w: World, dt: number) {
  if (w.stage !== "fight") return;
  const c = w.campaign!, j = c.journey!;
  if (j.stage <= j.stages) {
    if (w.enemies.length && !c.objective) return;
    if (!c.objective) activateJourneyObjective(w);
    const objective = c.objective!;
    const definition = journeyStageDefinition(c.room.kind, sector(w), j.stage - 1, j.bossPhase);
    // Crossing hazards stay tied to actual simulation movement; no time quota grants completion.
    const warnings = Math.floor(w.time / JOURNEY_RULES.pressure.crossingWarningInterval);
    if (warnings > objective.spawned) {
      objective.spawned = warnings;
      warning(w, "line", 20, w.player.y, JOURNEY_RULES.pressure.crossingWarningRadius, JOURNEY_RULES.pressure.crossingWarningDelay, 880, w.player.y);
      if (c.room.kind === "challenge" || c.room.kind === "environment")
        warning(w, "circle", w.player.x, w.player.y, 48, 1.8);
    }
    if (objective.progress < objective.target && Math.hypot(w.player.x - objective.x, w.player.y - objective.y) < JOURNEY_RULES.movement.checkpointRadius) {
      objective.progress++;
      objective.carrying = objective.kind === "parcel" ? objective.progress % 2 === 1 : objective.kind === "escort" && objective.progress < objective.target;
      if (objective.kind === "escort" && objective.progress === 1) {
        // A recovered transmitter draws an actual pursuit, not an unopposed lap.
        for (const [index, kind] of JOURNEY_RULES.pressure.escortAmbushRoles.entries()) {
          const hp = JOURNEY_RULES.pressure.escortAmbushHealth + sector(w) * JOURNEY_RULES.pressure.escortAmbushHealthPerDistrict;
          const enemy: Enemy = {
            id: j.bossPhase * 100000 + j.stage * 1000 + 50 + index,
            kind, x: objective.x < 450 ? objective.x + 160 : objective.x - 160,
            y: objective.y < 280 ? objective.y + 90 : objective.y - 90,
            hp, maxHp: hp, timer: 1.8, poison: 0, speed: kind === "runner" ? JOURNEY_RULES.pressure.escortAmbushRunnerSpeed : JOURNEY_RULES.pressure.escortAmbushWeaverSpeed,
          };
          keepOutsideCover(enemy, arenaFor(w.bossIndex).terrain, 17);
          w.enemies.push(enemy);
        }
      }
      const next = definition.checkpoints[objective.progress];
      if (next) {
        objective.x = next.x; objective.y = next.y;
        w.message = `${objective.kind === "parcel" ? objective.carrying ? "Signal recovered: deliver it" : "Signal delivered: recover the next" : "Landmark reached"} · ${objective.progress}/${objective.target}.`;
      }
    }
    if (objective.progress >= objective.target && !w.enemies.length) {
      j.completedStages++;
      healPlayer(w, JOURNEY_RULES.sustain.stageHealing);
      j.stage++;
      delete c.objective;
      if (j.stage <= j.stages) startJourneyStage(w);
      else if (isPatrol(w)) combatCleared(w);
      else {
        w.bullets = w.bullets.filter((shot) => !shot.enemy);
        w.hazards = [];
        w.boss.opening = 2.5;
        w.boss.recoveryDelay = 0;
        w.boss.attackTimer = 2.8;
        w.message = `${encounterName(w)}'s shield breaks. Punish the opening${c.room.kind === "boss" ? ` in phase ${j.bossPhase}/3` : ""}.`;
      }
    }
    return;
  }
  if (c.room.kind === "boss" && j.bossPhase < 3 && w.boss.hp <= w.boss.maxHp * (1 - j.bossPhase / 3) + 0.000001) {
    // Clamp again for preserved/debug fixture inputs; all real damage was already bounded centrally.
    w.boss.hp = w.boss.maxHp * (1 - j.bossPhase / 3);
    j.bossPhase++; j.stage = 1;
    w.boss.phase = j.bossPhase;
    w.boss.poison = 0;
    w.boss.opening = 0;
    w.boss.recoveryDelay = 0;
    w.boss.attackTimer = 1.8;
    startJourneyStage(w);
  } else if (w.boss.hp <= 0) combatCleared(w);
  // dt remains the real fixed-step amount; outcomes never depend on an elapsed room minimum.
  void dt;
}
function spawnWave(w: World, scaling = 1) {
  const c = w.campaign!,
    district = sector(w),
    wave = c.wave ?? 1;
  const count =
    3 +
    Math.min(4, district) +
    (c.room.kind === "battle" ? 0 : 1) +
    (wave > 1 ? 1 : 0);
  const identities: Enemy["kind"][] =
    c.contentVersion === 2
      ? ["runner", "sentry", "anchor", "weaver", "splitter", "bulwark"]
      : ["anchor", "runner", "sentry"];
  for (let i = 0; i < count; i++) {
    const kind = identities[(i + district + wave - 1) % identities.length];
    const hp = Math.round(
      (kind === "bulwark" ? 60 : kind === "anchor" ? 48 : 30) *
        (1 + district * 0.1) *
        scaling,
    );
    w.enemies.push({
      id: wave * 100 + i,
      kind,
      x: 90 + rng(w) * 720,
      y: 65 + rng(w) * 210,
      hp,
      maxHp: hp,
      timer: 0.9 + rng(w) * 1.5,
      poison: 0,
      speed:
        kind === "runner" || kind === "splitter"
          ? 75 + district * 5
          : kind === "weaver"
            ? 70
            : 34,
    });
  }
}
export function chooseRoute(w: World, id: string) {
  const c = w.campaign;
  if (w.stage !== "route" || !c) return false;
  const route = c.routes.find((item) => item.id === id);
  if (!route) return false;
  c.roomIndex++;
  c.room = { ...route };
  c.path.push(route.kind);
  c.routes = [];
  startCampaignRoom(w);
  return true;
}
export function eventChoice(w: World, choice: EventChoice) {
  return resolveEvent(w, choice, (id) => applyMod(w, id), (id) => canAcquireMod(w, id));
}
export function chooseMod(w: World, id: string) {
  if (w.stage !== "choice" || !w.offered.includes(id)) return false;
  if (!applyMod(w, id) && w.campaign?.pacingVersion) return false;
  if (w.campaign) openRoutes(w);
  else {
    w.stage = "shop";
    w.message = "A quiet corner. Spend your Ego or take a risk.";
  }
  return true;
}
function isCharacterReward(id: string) {
  return bosses.some((boss) => boss.rewardMod === id);
}
function canAcquireMod(w: World, id: string) {
  const stackLimits: Record<string, number> = JOURNEY_RULES.buildStackLimits;
  const limit = w.campaign?.pacingVersion && id in stackLimits ? stackLimits[id] : (modLimits[id] ?? 1);
  if (w.mods.filter((mod) => mod === id).length >= limit) return false;
  return !w.campaign?.pacingVersion || isCharacterReward(id) || w.mods.filter((mod) => !isCharacterReward(mod)).length < JOURNEY_MOD_LIMIT;
}
function applyMod(w: World, id: string) {
  if (!canAcquireMod(w, id)) return false;
  if (w.mods.filter((mod) => mod === id).length >= (modLimits[id] ?? 1))
    return false;
  if (!mods.some((mod) => mod.id === id)) return false;
  w.mods.push(id);
  if (id === "shield") {
    w.player.maxHp += 12;
    healPlayer(w, 12);
  }
  if (id === "helper") w.helper = { kind: "gunner", hp: 40, timer: 0 };
  return true;
}
function drawMod(w: World, pool: readonly (typeof mods)[number][] = mods) {
  const rarityWeights: Record<string, number> = {
    Common: 8,
    Uncommon: 5,
    Rare: 3,
    Epic: 1,
    Legendary: 0.25,
  };
  const total = pool.reduce((sum, mod) => sum + rarityWeights[mod.rarity], 0);
  let roll = rng(w) * total;
  for (const mod of pool) {
    roll -= rarityWeights[mod.rarity];
    if (roll <= 0) return mod;
  }
  return pool[pool.length - 1];
}
export function shopCost(w: World, choice: "heal" | "helper" | "mod") {
  const district = w.campaign?.contentVersion === 2 ? sector(w) : 0;
  return choice === "heal"
    ? 20 + district * 3
    : choice === "helper"
      ? 35 + district * 4
      : 30 + district * 5;
}
export function shop(w: World, choice: "heal" | "helper" | "mod" | "risk") {
  if (w.stage !== "shop") return false;
  if (choice === "risk") {
    if (w.player.hp <= 20 || w.mods.includes("critical") || !canAcquireMod(w, "critical")) return false;
    w.player.hp -= 20;
    applyMod(w, "critical");
    w.message = "Confidence has a cost. Critical emphasis gained.";
    return true;
  }
  const cost = shopCost(w, choice);
  if (choice === "heal" && w.player.hp >= w.player.maxHp) return false;
  const available = mods.filter(
    (mod) =>
      canAcquireMod(w, mod.id),
  );
  if (w.ego < cost || (choice === "mod" && !available.length)) return false;
  w.ego -= cost;
  if (choice === "heal") healPlayer(w, 35);
  if (choice === "helper") w.helper = { kind: "medic", hp: 50, timer: 0 };
  if (choice === "mod") applyMod(w, drawMod(w, available).id);
  return true;
}
export function nextEncounter(w: World) {
  if (w.stage !== "shop") return;
  if (w.campaign) {
    w.campaign.cleared++;
    openRoutes(w);
    return;
  }
  w.bossIndex++;
  const b = bosses[w.bossIndex];
  if (!b || w.bossIndex >= (w.bossCount ?? CLASSIC_BOSS_COUNT)) {
    w.stage = "won";
    return;
  }
  w.boss = {
    x: 450,
    y: 170,
    hp: b.hp,
    maxHp: b.hp,
    phase: 1,
    attackTimer: 1.8,
    attackIndex: 0,
    poison: 0,
    chargeTime: 0,
    vx: 0,
    vy: 0,
  };
  w.player.x = 450;
  w.player.y = 440;
  w.player.invulnerable = 1;
  w.bullets = [];
  w.hazards = [];
  w.stage = "fight";
  w.promiseUsed = false;
  w.message = b.dialogue;
}
function hurt(w: World, damage: number) {
  if (w.player.invulnerable > 0) return;
  const armor = Math.min(
    0.5,
    w.mods.filter((x) => x === "shield").length * 0.12,
  );
  const guard = w.player.guard ?? 0;
  const actual =
    damage *
    (w.campaign?.pacingVersion ? JOURNEY_RULES.sustain.incomingDamage[w.campaign.difficulty] : 1) *
    (1 - armor) *
    (w.mods.includes("glass") ? 1.2 : 1) *
    (guard > 0 ? 0.4 : 1);
  w.player.guard = 0;
  w.player.stillTime = 0;
  if (w.telemetry) w.telemetry.damageTaken += Math.min(w.player.hp, actual);
  w.player.hp -= actual;
  if (w.campaign) w.campaign.roomDamage = (w.campaign.roomDamage ?? 0) + actual;
  if (w.player.hp <= 0 && w.mods.includes("promise") && !w.promiseUsed) {
    w.promiseUsed = true;
    w.player.hp = 12;
    w.player.invulnerable = 1.5;
    w.message =
      "Unbroken promise catches a lethal blow. It must recover before the next room.";
    return;
  }
  w.player.invulnerable = 0.65;
  if (w.player.hp <= 0) {
    w.player.hp = 0;
    w.stage = "lost";
    w.message = "Your confidence cracks. The next run awaits.";
  }
}
function hitTarget(
  w: World,
  target: { hp: number; poison: number },
  damage: number,
) {
  if (target === w.boss && journeyShielded(w)) return;
  w.hits++;
  const opening = target === w.boss && (w.boss.opening ?? 0) > 0;
  const multiplier =
    (w.mods.includes("glass") ? 1.25 : 1) *
    (w.mods.includes("momentum") &&
    (w.player.dashTime > 0 || Math.hypot(w.player.vx, w.player.vy) > 100)
      ? 1.18
      : 1) *
    (opening
      ? 1.2 +
        (w.mods.includes("boss-hunter") ? 0.3 : 0) +
        (w.mods.includes("refraction") ? 0.15 : 0)
      : 1) *
    (target === w.boss &&
    target.hp < w.boss.maxHp * 0.3 &&
    w.mods.includes("finale")
      ? 1.25
      : 1);
  damageCombatTarget(
    w,
    target,
    damage *
      multiplier *
      (w.mods.includes("critical") && w.hits % 4 === 0 ? 1.8 : 1),
  );
  if (w.mods.includes("return"))
    w.player.dashCooldown = Math.max(0, w.player.dashCooldown - 0.04);
  if (w.mods.includes("venom")) target.poison = Math.min(9, target.poison + 2);
  if (w.mods.includes("vampire") && w.hits % 5 === 0)
    healPlayer(w, w.weapon === "blade" || w.weapon === "lance" ? 3 : 2);
}
function shoot(
  w: World,
  x: number,
  y: number,
  angle: number,
  damage: number,
  enemy = false,
  speed = 450,
  life = 2,
  explosive = false,
  radius = 5,
) {
  if (w.bullets.length >= 700) return;
  w.bullets.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    damage,
    life,
    enemy,
    explosive,
    radius,
    bounces: !enemy && w.mods.includes("ricochet") ? 1 : 0,
  });
}
function warning(
  w: World,
  kind: Hazard["kind"],
  x: number,
  y: number,
  radius: number,
  delay = 1,
  x2 = x,
  y2 = y,
  safeRadius = 0,
) {
  if (w.hazards.length >= 200) return;
  w.hazards.push({
    kind,
    x,
    y,
    x2,
    y2,
    radius,
    safeRadius,
    timer: delay,
    active: 0.3,
    damage: kind === "ring" ? 22 : 18,
    color: bosses[w.bossIndex].color,
  });
}
function bossAttack(w: World) {
  const b = w.boss,
    p = w.player;
  const def = bosses[w.bossIndex];
  if (w.campaign?.room.kind === "miniboss") {
    const attack = b.attackIndex++ % 3;
    b.attackTimer = b.phase >= 2 ? 1.4 : 2.2;
    if (sector(w) % 2 === 0) {
      // Redactor marks the last player position, forcing a deliberate escape.
      if (attack === 0) {
        warning(w, "line", 20, p.y, 22, 1.1, 880, p.y);
        warning(w, "line", p.x, 20, 22, 1.45, p.x, 540);
      } else if (attack === 1) {
        for (let i = -2; i <= 2; i++)
          shoot(
            w,
            b.x,
            b.y,
            Math.atan2(p.y - b.y, p.x - b.x) + i * 0.25,
            9,
            true,
            200,
            4,
          );
      } else {
        warning(w, "circle", p.x, p.y, b.phase >= 2 ? 110 : 85, 1.2);
        warning(w, "ring", b.x, b.y, 170, 1.7, b.x, b.y, 110);
      }
    } else {
      // Metronome alternates expansion rings and two delayed directed pulses.
      if (attack === 0) {
        warning(w, "ring", 450, 280, 180, 0.8, 450, 280, 120);
        warning(w, "ring", 450, 280, 285, 1.4, 450, 280, 215);
      } else if (attack === 1) {
        warning(w, "line", b.x, b.y, 20, 0.8, p.x, p.y);
        warning(w, "line", b.x, b.y, 20, 1.6, 900 - p.x, p.y);
      } else {
        for (let i = 0; i < 8 + b.phase * 2; i++)
          shoot(
            w,
            b.x,
            b.y,
            (i * Math.PI * 2) / (8 + b.phase * 2),
            8,
            true,
            165,
            5,
          );
      }
    }
    return;
  }
  const attack = def.attacks[b.attackIndex++ % 3];
  if (b.attackIndex % 3 === 0) {
    b.opening = 0;
  }
  if (
    (Math.hypot(p.x - b.x, p.y - b.y) > 380 && b.attackIndex % 2 === 0) ||
    (p.stillTime ?? 0) > 2.5
  ) {
    warning(w, "circle", p.x, p.y, 75, 1.35); // Position-locked marks prevent distant corner camping.
  }
  const angle = Math.atan2(p.y - b.y, p.x - b.x);
  const phase = b.phase;
  b.attackTimer =
    (b.opening ?? 0) > 0
      ? 2.65
      : phase === 3
        ? 1.35
        : phase === 2
          ? 1.65
          : 2.25;
  if (attack === "rings") {
    for (let i = 0; i < phase + 1; i++)
      warning(
        w,
        "ring",
        450,
        280,
        110 + i * 85,
        0.7 + i * 0.5,
        450,
        280,
        70 + i * 85,
      );
  }
  if (attack === "fan") {
    for (let i = -3 - phase; i <= 3 + phase; i++)
      shoot(w, b.x, b.y, angle + i * 0.16, 10, true, 210 + phase * 25, 4);
  }
  if (attack === "cross") {
    warning(w, "line", p.x, 20, 20, 1, p.x, 540);
    warning(w, "line", 20, p.y, 20, 1, 880, p.y);
    if (phase >= 2) warning(w, "line", 20, 20, 16, 1.4, 880, 540);
  }
  if (attack === "grid") {
    for (let x = 100; x < 900; x += 160)
      if (Math.abs(x - p.x) > 60 || phase >= 2)
        warning(w, "line", x, 20, 32, 1.2, x, 540);
    if (phase >= 2) warning(w, "line", 20, 280, 28, 1.7, 880, 280);
  }
  if (attack === "sniper") {
    for (let i = 0; i < 3; i++)
      warning(w, "line", b.x, b.y, 15, 1 + i * 0.4, p.x + (i - 1) * 45, p.y);
  }
  if (attack === "mines") {
    for (let i = 0; i < 4 + phase; i++)
      warning(
        w,
        "circle",
        80 + rng(w) * 740,
        60 + rng(w) * 440,
        65,
        1.4 + i * 0.1,
      );
  }
  if (attack === "charge") {
    warning(w, "line", b.x, b.y, 33, 0.9, p.x, p.y);
    b.vx = Math.cos(angle) * 440;
    b.vy = Math.sin(angle) * 440;
    b.chargeTime = 1.7;
  }
  if (attack === "walls") {
    const safe = 100 + rng(w) * 320;
    for (let y = 50; y < 560; y += 45)
      if (Math.abs(y - safe) > 65)
        shoot(
          w,
          phase >= 2 ? 880 : 20,
          y,
          phase >= 2 ? Math.PI : 0,
          12,
          true,
          170,
          6,
          false,
          10,
        );
  }
  if (attack === "orbit") {
    for (let i = 0; i < 12; i++)
      shoot(w, b.x, b.y, w.time + (i * Math.PI) / 6, 10, true, 170, 5);
    warning(w, "circle", p.x, p.y, 80, 1.5);
  }
  if (attack === "mirror") {
    const reflected = { x: WIDTH - p.x, y: p.y };
    warning(w, "line", b.x, b.y, 18 + phase * 2, 1.1, reflected.x, reflected.y);
    warning(w, "line", WIDTH - b.x, b.y, 18, 1.5, p.x, p.y);
    if (phase >= 2) warning(w, "circle", reflected.x, reflected.y, 70, 1.8);
  }
  if (attack === "shatter") {
    for (let i = 0; i < 5 + phase; i++)
      warning(
        w,
        "circle",
        100 + i * 110,
        100 + (i % 2) * 330,
        53,
        0.9 + i * 0.2,
      );
    warning(w, "line", 30, 280, 22, 2.1, 870, 280);
  }
  if (attack === "reflection") {
    warning(w, "circle", p.x, p.y, 100, 1);
    warning(w, "circle", WIDTH - p.x, HEIGHT - p.y, 100, 1.4);
    if (phase >= 2) warning(w, "ring", 450, 280, 250, 1.9, 450, 280, 185);
  }
  if (attack === "furnace") {
    const safeX = p.x < 450 ? 670 : 230;
    for (let x = 60; x < 900; x += 90)
      if (Math.abs(x - safeX) > 85) warning(w, "line", x, 30, 32, 1.4, x, 530);
    if (phase >= 2) warning(w, "circle", safeX, p.y, 60, 2.1);
    if (phase === 3) warning(w, "ring", 450, 280, 230, 2.65, 450, 280, 150);
  }
  if (attack === "flare") {
    warning(w, "circle", p.x, p.y, 95, 1.25);
    for (let i = 0; i < 3 + phase; i++)
      warning(
        w,
        "ring",
        b.x,
        b.y,
        100 + i * 65,
        0.9 + i * 0.3,
        b.x,
        b.y,
        60 + i * 65,
      );
  }
  if (attack === "solar") {
    warning(w, "line", 30, 80, 24, 1.15, 870, 480);
    warning(w, "line", 30, 480, 24, 1.75, 870, 80);
    if (phase >= 2) warning(w, "line", 450, 30, 32, 2.2, 450, 530);
  }
  if (attack === "index") {
    const rows = phase >= 2 ? [100, 250, 400] : [140, 380];
    for (const [i, y] of rows.entries())
      warning(w, "line", 30, y, 24, 1.1 + i * 0.45, 870, y);
    if (phase === 3) warning(w, "line", p.x, 20, 22, 2.4, p.x, 540);
  }
  if (attack === "binding") {
    for (let i = 0; i < 3; i++)
      warning(
        w,
        "ring",
        p.x,
        p.y,
        100 + i * 70,
        1.1 + i * 0.45,
        p.x,
        p.y,
        55 + i * 70,
      );
  }
  if (attack === "erasure") {
    const safeY = p.y < 280 ? 420 : 120;
    for (let y = 55; y < 550; y += 70)
      if (Math.abs(y - safeY) > 65) warning(w, "line", 30, y, 24, 1.2, 870, y);
    if (phase >= 2) warning(w, "circle", p.x, safeY, 60, 1.85);
  }
  if (attack === "eclipse") {
    const safe = phase % 2 === 0 ? 120 : 225;
    warning(w, "ring", 450, 280, 390, 1.5, 450, 280, safe);
    warning(w, "circle", 450, 280, safe - 55, 1.5);
  }
  if (attack === "echo") {
    for (let i = 0; i < phase + 1; i++)
      warning(
        w,
        "line",
        b.x,
        b.y,
        18,
        1.0 + i * 0.45,
        p.x + (i - phase / 2) * 100,
        p.y,
      );
    warning(w, "circle", WIDTH - p.x, HEIGHT - p.y, 80, 2);
  }
  if (attack === "verdict") {
    const safeX = 150 + rng(w) * 600;
    for (let x = 50; x < 900; x += 75)
      if (Math.abs(x - safeX) > 90) warning(w, "line", x, 20, 27, 1.7, x, 540);
    warning(w, "line", 20, 280, 20, 2.4, 880, 280);
  }
  if (b.attackIndex % 5 === 0) {
    w.message = `${def.name}: FRICK OFF — find the opening!`;
    if (w.bossIndex === 0) {
      warning(w, "ring", 450, 280, 245, 1.65, 450, 280, 120);
      for (let i = 0; i < 16; i++)
        shoot(w, b.x, b.y, (i * Math.PI) / 8 + w.time, 12, true, 140, 5);
    } else if (w.bossIndex === 1) {
      const safeX = 100 + rng(w) * 700;
      for (let x = 60; x < 900; x += 80)
        if (Math.abs(x - safeX) > 85)
          warning(w, "line", x, 20, 34, 1.65, x, 540);
      warning(w, "line", 20, 150, 25, 2.2, 880, 150);
      warning(w, "line", 20, 400, 25, 2.2, 880, 400);
    } else if (w.bossIndex === 2) {
      warning(w, "line", 20, p.y, 65, 1.4, 880, p.y);
      warning(w, "line", p.x, 20, 40, 2, p.x, 540);
      b.vx = Math.cos(angle) * 640;
      b.vy = Math.sin(angle) * 640;
      b.chargeTime = 2.1;
    } else if (w.bossIndex === 4) {
      warning(w, "line", 20, 40, 24, 1.3, 880, 520);
      warning(w, "line", 20, 520, 24, 1.85, 880, 40);
      warning(w, "circle", WIDTH - p.x, p.y, 90, 2.25);
      w.message = "Mira: The frame is breaking. Cross between the reflections.";
    } else if (w.bossIndex === 5) {
      for (let i = 0; i < 3; i++)
        warning(
          w,
          "ring",
          450,
          280,
          130 + i * 95,
          1.2 + i * 0.4,
          450,
          280,
          85 + i * 95,
        );
      warning(w, "line", 450, 20, 32, 2.4, 450, 540);
      w.message = "Sol: A last flare. Follow the cooling bands.";
    } else if (w.bossIndex === 6) {
      for (let i = 0; i < 4; i++)
        warning(
          w,
          "line",
          20,
          90 + i * 110,
          22,
          1.2 + i * 0.3,
          880,
          90 + i * 110,
        );
      warning(w, "circle", p.x, p.y, 70, 2.6);
      w.message = "Inez: Every line must close. Move with the reading order.";
    } else if (w.bossIndex === 7) {
      warning(w, "circle", p.x, p.y, 100, 1.2);
      warning(w, "circle", WIDTH - p.x, HEIGHT - p.y, 100, 1.75);
      warning(w, "ring", 450, 280, 310, 2.25, 450, 280, 210);
      w.message = "Noa: Leave room for another ending. Cross the old echoes.";
    } else {
      for (let i = 0; i < 7; i++)
        warning(
          w,
          "circle",
          65 + rng(w) * 770,
          40 + rng(w) * 480,
          80,
          1.65 + i * 0.1,
        );
      warning(w, "ring", 450, 280, 350, 2.1, 450, 280, 210);
    }
  }
  if (b.attackIndex % 3 === 0) {
    b.recoveryDelay =
      Math.max(
        0,
        b.chargeTime,
        ...w.hazards.map((h) => Math.max(0, h.timer) + h.active),
        ...w.bullets.filter((shot) => shot.enemy).map((shot) => shot.life),
      ) + 0.08;
    b.attackTimer = b.recoveryDelay + 1.85;
  }
}
export function pointToSegment(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = clamp(
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    0,
    1,
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function stepPatrol(w: World, dt: number) {
  const p = w.player;
  for (const enemy of w.enemies) {
    if (enemy.hp <= 0) continue;
    const objective = w.campaign?.objective;
    const target =
      objective?.kind === "relay" && enemy.id % 2 === 0 ? objective : p;
    const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
    const distance = Math.hypot(target.x - enemy.x, target.y - enemy.y);
    if (
      enemy.kind === "runner" ||
      enemy.kind === "splitter" ||
      enemy.kind === "weaver" ||
      distance > 210
    ) {
      enemy.x = clamp(
        enemy.x +
          Math.cos(
            angle +
              (enemy.kind === "weaver"
                ? Math.sin(w.time * 2 + enemy.id) * 0.9
                : 0),
          ) *
            enemy.speed *
            dt,
        30,
        870,
      );
      enemy.y = clamp(
        enemy.y +
          Math.sin(
            angle +
              (enemy.kind === "weaver"
                ? Math.sin(w.time * 2 + enemy.id) * 0.9
                : 0),
          ) *
            enemy.speed *
            dt,
        30,
        530,
      );
    }
    keepOutsideCover(enemy, arenaFor(w.bossIndex).terrain, 17);
    enemy.timer -= dt;
    if (enemy.timer <= 0) {
      if (enemy.kind === "anchor") {
        warning(w, "line", enemy.x, enemy.y, 13, 1, target.x, target.y);
        enemy.timer = 3.3;
      } else if (enemy.kind === "weaver") {
        for (let i = -1; i <= 1; i++)
          shoot(w, enemy.x, enemy.y, angle + i * 0.35, 7, true, 155, 4);
        enemy.timer = 2.5;
      } else if (enemy.kind === "bulwark") {
        warning(w, "ring", enemy.x, enemy.y, 135, 1.2, enemy.x, enemy.y, 75);
        enemy.timer = 3.8;
      } else if (enemy.kind === "sentry") {
        const count = w.campaign?.room.kind === "elite" ? 3 : 1;
        for (let i = 0; i < count; i++)
          shoot(
            w,
            enemy.x,
            enemy.y,
            angle + (i - (count - 1) / 2) * 0.18,
            8,
            true,
            190,
            4,
          );
        enemy.timer = 2.1;
      } else {
        warning(w, "circle", enemy.x, enemy.y, 42, 0.6);
        enemy.timer = 2.8;
      }
      if (w.campaign?.difficulty === "volatile") enemy.timer *= 0.8;
    }
    if (Math.hypot(p.x - enemy.x, p.y - enemy.y) < 29) hurt(w, 10);
    if (objective?.kind === "relay" && distance < 33 && target === objective)
      objective.hp = Math.max(0, objective.hp - dt * 6);
    if (enemy.poison > 0) {
      damageCombatTarget(w, enemy, enemy.poison * dt);
      enemy.poison = Math.max(0, enemy.poison - dt * 0.4);
    }
  }
  if (
    ["challenge", "environment"].includes(w.campaign?.room.kind ?? "") &&
    Math.floor(w.time / 4) !== Math.floor((w.time - dt) / 4)
  ) {
    if (w.campaign?.room.kind === "environment" && sector(w) % 2 === 1) {
      warning(w, "ring", 450, 280, 260, 1.3, 450, 280, 180);
    } else {
      const x = 100 + rng(w) * 700;
      warning(w, "line", x, 20, 24, 1.2, x, 540);
    }
  }
}
function combatCleared(w: World) {
  const c = w.campaign;
  const bossRoom = !c || c.room.kind === "boss";
  if (bossRoom) {
    w.kills++;
    applyMod(w, bosses[w.bossIndex].rewardMod);
  }
  if (c) {
    c.cleared++;
    grantEgo(
      w,
      Math.round(
        (bossRoom ? 50 : c.room.kind === "miniboss" ? 35 : 20) *
          c.rewardMultiplier,
      ),
    );
  } else grantEgo(w, 45 + w.bossIndex * 10);
  w.bullets = [];
  w.hazards = [];
  if (w.mods.includes("finale") || w.mods.includes("mercy"))
    healPlayer(w, w.mods.includes("mercy") ? 8 : 5);
  if (c && c.room.kind === "environment") applyMod(w, "momentum");
  if (c && c.room.kind === "survival") applyMod(w, "anchor");
  const pool = mods.filter(
    (mod) =>
      canAcquireMod(w, mod.id),
  );
  w.offered = [];
  for (let i = 0; i < Math.min(3, pool.length + w.offered.length); i++) {
    const mod = drawMod(w, pool);
    w.offered.push(mod.id);
    pool.splice(pool.indexOf(mod), 1);
  }
  w.stage =
    !c && w.bossIndex === (w.bossCount ?? CLASSIC_BOSS_COUNT) - 1
      ? "won"
      : "choice";
  if (c && c.mode !== "endless" && c.roomIndex === campaignLength(w) - 1)
    w.stage = "won";
  if (w.stage === "choice" && !w.offered.length) {
    if (c) openRoutes(w);
    else w.stage = "shop";
  }
  w.message = bossRoom
    ? `${bosses[w.bossIndex].name} defeated. ${bosses[w.bossIndex].reward} discovered.`
    : `${encounterName(w)} cleared. Choose how your build grows.`;
}
export function stepWorld(w: World, input: Input, delta: number) {
  if (w.stage !== "fight") return;
  const dt = clamp(Number.isFinite(delta) ? delta : 0, 0, 0.04);
  w.time += dt;
  const p = w.player,
    b = w.boss;
  const patrol = isPatrol(w);
  w.cooldown -= dt;
  w.alternateCooldown -= dt;
  p.dashCooldown = Math.max(0, p.dashCooldown - dt);
  p.invulnerable = Math.max(0, p.invulnerable - dt);
  p.dashTime = Math.max(0, p.dashTime - dt);
  let move = {
    x: clamp(Number.isFinite(input.x) ? input.x : 0, -1, 1),
    y: clamp(Number.isFinite(input.y) ? input.y : 0, -1, 1),
  };
  if (length(move) > 1) {
    const len = length(move);
    move = { x: move.x / len, y: move.y / len };
  }
  if (input.dash && !w.campaign?.objective?.carrying && p.dashCooldown <= 0 && (move.x || move.y)) {
    p.dashTime = 0.19;
    p.invulnerable = 0.3;
    p.dashCooldown = Math.max(
      0.45,
      1.15 - w.mods.filter((id) => id === "dash").length * 0.18,
    );
    p.vx = move.x * 800;
    p.vy = move.y * 800;
    if (w.mods.includes("heat-sink")) {
      const targets = combatTargets(w);
      for (const target of targets)
        if (Math.hypot(target.x - p.x, target.y - p.y) < 105)
          hitTarget(w, target, 12);
      warning(w, "circle", p.x, p.y, 105, 0);
      const wake = w.hazards.at(-1);
      if (wake) {
        wake.damage = 0;
        wake.color = 0xffcb75;
      }
    }
  }
  const arena = arenaFor(w.bossIndex);
  const slowed = arena.terrain.some(
    (t) => t.kind === "slow" && Math.hypot(p.x - t.x, p.y - t.y) < t.radius,
  );
  const carrying = w.campaign?.pacingVersion && w.campaign.objective?.carrying;
  const speed = carrying ? (slowed ? JOURNEY_RULES.movement.slowedCarryingSpeed : JOURNEY_RULES.movement.carryingSpeed) : slowed ? JOURNEY_RULES.movement.slowedSpeed : JOURNEY_RULES.movement.normalSpeed;
  if (p.dashTime <= 0) {
    p.vx = move.x * speed;
    p.vy = move.y * speed;
  }
  p.x = clamp(
    p.x + (p.vx + arena.conveyor * (p.y > 280 ? 1 : -1)) * dt,
    20,
    880,
  );
  p.y = clamp(p.y + p.vy * dt, 20, 540);
  keepOutsideCover(p, arena.terrain, 13);
  p.stillTime = move.x || move.y ? 0 : (p.stillTime ?? 0) + dt;
  if (w.mods.includes("anchor") && p.stillTime > 1.4) p.guard = 1;
  if (
    (b.opening ?? 0) <= 0 &&
    Math.floor(w.time / 6) !== Math.floor((w.time - dt) / 6)
  ) {
    for (const t of arena.terrain)
      if (t.kind === "heat") warning(w, "circle", t.x, t.y, t.radius, 1.3);
  }
  b.opening = Math.max(0, (b.opening ?? 0) - dt);
  if ((b.recoveryDelay ?? 0) > 0) {
    b.recoveryDelay = Math.max(0, b.recoveryDelay! - dt);
    if (b.recoveryDelay === 0) {
      b.opening = 1.65;
      w.message = `${encounterName(w)} is recovering — punish the opening.`;
    }
  }
  const weapon = weapons[w.weapon];
  const angle = Math.atan2(
    (Number.isFinite(input.aimY) ? input.aimY : b.y) - p.y,
    (Number.isFinite(input.aimX) ? input.aimX : b.x) - p.x,
  );
  const alt = input.alternate && w.alternateCooldown <= 0;
  if ((input.attack && w.cooldown <= 0) || alt) {
    w.shots++;
    w.cooldown =
      weapon.interval /
      (1 + Math.min(1, w.mods.filter((id) => id === "tempo").length * 0.18));
    if (alt) w.alternateCooldown = w.mods.includes("orbit") ? 2.8 : 3.8;
    const multiplier = alt ? 1.8 : 1;
    if (w.mods.includes("heat-sink") && w.shots % 8 === 0)
      w.alternateCooldown = Math.max(0, w.alternateCooldown - 1.2);
    if (w.weapon === "blade" || w.weapon === "lance") {
      warning(w, "circle", p.x, p.y, alt ? 125 : 85, 0);
      const last = w.hazards[w.hazards.length - 1];
      last.damage = 0;
      last.color = 0xbfff75;
      const targets = combatTargets(w);
      const reach =
        (w.weapon === "lance" ? (alt ? 225 : 165) : alt ? 145 : 110) *
        (w.mods.includes("reach") ? 1.25 : 1);
      if (alt && (w.mods.includes("parry") || w.weapon === "lance"))
        p.invulnerable = Math.max(p.invulnerable, 0.3);
      if (w.weapon === "lance" && alt) {
        p.x = clamp(p.x + Math.cos(angle) * 55, 20, 880);
        p.y = clamp(p.y + Math.sin(angle) * 55, 20, 540);
        keepOutsideCover(p, arena.terrain, 13);
      }
      if (w.mods.includes("parry"))
        w.bullets = w.bullets.filter(
          (shot) =>
            !shot.enemy || Math.hypot(shot.x - p.x, shot.y - p.y) > reach,
        );
      for (const target of targets) {
        const distance = Math.hypot(target.x - p.x, target.y - p.y);
        const angleTo = Math.atan2(target.y - p.y, target.x - p.x);
        const facing =
          Math.cos(angleTo - angle) > (w.weapon === "lance" ? 0.8 : 0.2);
        if (
          target.hp > 0 &&
          distance < reach &&
          ((w.weapon === "blade" && alt) || facing)
        ) {
          hitTarget(w, target, weapon.damage * multiplier);
          target.x = clamp(target.x + Math.cos(angle) * 20, 35, 865);
          target.y = clamp(target.y + Math.sin(angle) * 20, 35, 525);
        }
      }
    } else if (w.weapon === "prism") {
      const reach = (alt ? 280 : 230) * (w.mods.includes("reach") ? 1.25 : 1);
      const endpoint = {
        x: p.x + Math.cos(angle) * reach,
        y: p.y + Math.sin(angle) * reach,
      };
      warning(w, "line", p.x, p.y, 6, 0, endpoint.x, endpoint.y);
      const beam = w.hazards.at(-1);
      if (beam) {
        beam.damage = 0;
        beam.color = 0x79d9ef;
        beam.active = 0.12;
      }
      const targets = combatTargets(w);
      const first = targets
        .filter(
          (target) =>
            target.hp > 0 &&
            pointToSegment(target, p, endpoint) < (alt ? 42 : 28),
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y),
        )[0];
      if (first) {
        hitTarget(w, first, weapon.damage * multiplier);
        const chainRange = w.mods.includes("refraction") ? 175 : 115;
        const chain = targets
          .filter(
            (target) =>
              target !== first &&
              target.hp > 0 &&
              Math.hypot(target.x - first.x, target.y - first.y) < chainRange,
          )
          .slice(0, alt || w.mods.includes("refraction") ? 3 : 1);
        for (const target of chain) {
          hitTarget(w, target, weapon.damage * multiplier * 0.65);
          warning(w, "line", first.x, first.y, 4, 0, target.x, target.y);
          const link = w.hazards.at(-1);
          if (link) {
            link.damage = 0;
            link.color = 0x79d9ef;
            link.active = 0.12;
          }
        }
      }
    } else {
      const spread =
        w.weapon === "boomerang" && alt
          ? 3
          : w.weapon === "scatter"
            ? alt
              ? 9
              : 5
            : w.mods.includes("split")
              ? 2
              : 1;
      for (let i = 0; i < spread; i++) {
        const offset =
          (i - (spread - 1) / 2) * (w.weapon === "scatter" ? 0.12 : 0.06);
        shoot(
          w,
          p.x,
          p.y,
          angle + offset,
          weapon.damage * multiplier,
          false,
          weapon.speed,
          (w.weapon === "scatter" ? 0.75 : 2) *
            (w.mods.includes("reach") ? 1.35 : 1),
          w.weapon === "comet",
          w.weapon === "comet" || w.weapon === "boomerang" ? 9 : 5,
        );
        const shot = w.bullets.at(-1);
        if (shot && w.weapon === "boomerang") {
          shot.returning = true;
          shot.returnTime = 0.55;
          shot.hitIds = [];
          shot.bounces = alt ? 1 : shot.bounces;
        }
        if (shot && w.weapon === "pulse" && alt) {
          shot.piercing = 2;
          shot.hitIds = [];
        }
      }
      if (alt && w.weapon === "pulse")
        for (let i = 1; i < 3; i++)
          shoot(
            w,
            p.x,
            p.y,
            angle + (i - 1.5) * 0.16,
            weapon.damage,
            false,
            600,
            2,
          );
    }
  }
  if (!w.campaign?.pacingVersion && !patrol && b.phase === 1 && b.hp <= b.maxHp * 0.5) {
    b.phase = 2;
    b.recoveryDelay = 0;
    b.opening = 0;
    w.message = `${encounterName(w)} enters phase two. ${bosses[w.bossIndex].phaseDialogue[0]}`;
    warning(w, "ring", b.x, b.y, 150, 1, b.x, b.y, 85);
    b.attackTimer = 1.2;
  }
  if (
    !w.campaign?.pacingVersion &&
    !patrol &&
    b.phase === 2 &&
    b.hp <= b.maxHp * 0.22 &&
    (!w.campaign || w.campaign.room.kind === "boss")
  ) {
    b.phase = 3;
    b.recoveryDelay = 0;
    b.opening = 0;
    b.attackTimer = 1.5;
    w.message = `${encounterName(w)}: ${bosses[w.bossIndex].phaseDialogue[1]}`;
    warning(w, "ring", b.x, b.y, 220, 1.2, b.x, b.y, 145);
  }
  if (patrol || w.enemies.length > 0) stepPatrol(w, dt);
  if (!patrol) {
    b.attackTimer -= dt * (journeyShielded(w) ? JOURNEY_RULES.pressure.shieldedBossCadence : 1);
    if (b.attackTimer <= 0) bossAttack(w);
  }
  if (!patrol && b.chargeTime > 0) {
    b.chargeTime -= dt;
    if (b.chargeTime < 0.8) {
      b.x = clamp(b.x + b.vx * dt, 40, 860);
      b.y = clamp(b.y + b.vy * dt, 40, 520);
    }
  } else if (!patrol) {
    const targetX = 450 + Math.sin(w.time * 0.7 + w.bossIndex) * 170,
      targetY = 160 + Math.cos(w.time * 0.6) * 65;
    b.x += (targetX - b.x) * dt * ((b.opening ?? 0) > 0 ? 0.15 : 0.8);
    b.y += (targetY - b.y) * dt * ((b.opening ?? 0) > 0 ? 0.15 : 0.8);
    keepOutsideCover(b, arena.terrain, 29);
  }
  if (!patrol && (b.opening ?? 0) <= 0 && Math.hypot(b.x - p.x, b.y - p.y) < 40)
    hurt(w, 16);
  if (!patrol && b.poison > 0) {
    damageCombatTarget(w, b, b.poison * dt);
    b.poison = Math.max(0, b.poison - dt * 0.4);
  }
  if (w.helper) {
    const h = w.helper;
    h.timer -= dt;
    if (h.timer <= 0) {
      if (h.kind === "gunner") {
        const target = (patrol || w.enemies.length > 0)
          ? w.enemies
              .filter((enemy) => enemy.hp > 0)
              .sort(
                (a, b) =>
                  Math.hypot(a.x - p.x, a.y - p.y) -
                  Math.hypot(b.x - p.x, b.y - p.y),
              )[0]
          : b;
        if (target)
          shoot(
            w,
            p.x - 28,
            p.y - 28,
            Math.atan2(target.y - p.y, target.x - p.x),
            6,
            false,
            460,
            2,
          );
        h.timer = w.mods.includes("guardian") ? 0.5 : 0.8;
      } else {
        healPlayer(w, 4);
        h.timer = w.mods.includes("guardian") ? 3.5 : 5;
      }
    }
  }
  for (const shot of w.bullets) {
    if (shot.returning && shot.returnTime !== undefined) {
      const before = shot.returnTime;
      shot.returnTime -= dt;
      if (shot.returnTime <= 0) {
        const direction = Math.atan2(p.y - shot.y, p.x - shot.x);
        shot.vx = Math.cos(direction) * 460;
        shot.vy = Math.sin(direction) * 460;
        if (before > 0) shot.hitIds = [];
      }
      if (
        shot.returnTime < -0.06 &&
        Math.hypot(shot.x - p.x, shot.y - p.y) < 15
      )
        shot.life = 0;
    }
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    shot.life -= dt;
    if (shot.enemy) {
      const objective = w.campaign?.objective;
      if (
        objective?.kind === "relay" &&
        Math.hypot(shot.x - objective.x, shot.y - objective.y) <
          shot.radius + 20
      ) {
        objective.hp = Math.max(0, objective.hp - shot.damage);
        shot.life = 0;
      } else if (
        w.helper &&
        Math.hypot(shot.x - (p.x - 28), shot.y - (p.y - 28)) < 18
      ) {
        w.helper.hp -= shot.damage * (w.mods.includes("guardian") ? 0.5 : 1);
        shot.life = 0;
        if (w.helper.hp <= 0) w.helper = null;
      } else if (Math.hypot(shot.x - p.x, shot.y - p.y) < shot.radius + 12) {
        hurt(w, shot.damage);
        shot.life = 0;
      }
    } else {
      const targets = combatTargets(w);
      const target = targets.find(
        (enemy) =>
          enemy.hp > 0 &&
          !(shot.hitIds ?? []).includes(
            "id" in enemy ? Number(enemy.id) : -1,
          ) &&
          Math.hypot(shot.x - enemy.x, shot.y - enemy.y) <
            shot.radius + (patrol ? 18 : 28),
      );
      if (target) {
        const returning = shot.returning && (shot.returnTime ?? 1) <= 0;
        hitTarget(
          w,
          target,
          shot.damage * (returning && w.mods.includes("return") ? 1.35 : 1),
        );
        if (shot.returning || (shot.piercing ?? 0) > 0) {
          shot.hitIds = [
            ...(shot.hitIds ?? []),
            "id" in target ? Number(target.id) : -1,
          ];
          if (!shot.returning) shot.piercing = (shot.piercing ?? 0) - 1;
        } else shot.life = 0;
        if (shot.explosive) {
          warning(w, "circle", shot.x, shot.y, 65, 0);
          const blast = w.hazards[w.hazards.length - 1];
          blast.damage = 0;
          blast.color = 0xbfff75;
          for (const enemy of targets)
            if (
              enemy.hp > 0 &&
              Math.hypot(shot.x - enemy.x, shot.y - enemy.y) < 65
            )
              hitTarget(w, enemy, shot.damage * 0.4);
        }
      }
      if (shot.life > 0 && (shot.bounces ?? 0) > 0) {
        if (shot.x < 20 || shot.x > 880) {
          shot.vx *= -1;
          shot.x = clamp(shot.x, 20, 880);
          shot.bounces = 0;
        } else if (shot.y < 20 || shot.y > 540) {
          shot.vy *= -1;
          shot.y = clamp(shot.y, 20, 540);
          shot.bounces = 0;
        }
      }
    }
  }
  for (const shot of w.bullets)
    if (
      arena.terrain.some(
        (t) =>
          t.kind === "cover" &&
          Math.hypot(shot.x - t.x, shot.y - t.y) < t.radius + shot.radius,
      )
    )
      shot.life = 0;
  w.bullets = w.bullets.filter(
    (shot) =>
      shot.life > 0 &&
      shot.x > -20 &&
      shot.x < 920 &&
      shot.y > -20 &&
      shot.y < 580,
  );
  for (const h of w.hazards) {
    h.timer -= dt;
    if (h.timer <= 0) {
      h.active -= dt;
      const dist = Math.hypot(p.x - h.x, p.y - h.y);
      const hit =
        h.kind === "line"
          ? pointToSegment(p, h, { x: h.x2, y: h.y2 }) < h.radius
          : h.kind === "ring"
            ? dist < h.radius && dist > h.safeRadius
            : dist < h.radius;
      if (hit && h.damage) hurt(w, h.damage);
    }
  }
  w.hazards = w.hazards.filter((h) => h.active > 0);
  if (patrol || w.campaign?.pacingVersion) {
    const dead = w.enemies.filter((enemy) => enemy.hp <= 0).length;
    if (w.campaign) w.campaign.enemyKills += dead;
    const splits = w.enemies.filter(
      (enemy) => enemy.hp <= 0 && enemy.kind === "splitter" && !enemy.spawned,
    );
    w.enemies = w.enemies.filter((enemy) => enemy.hp > 0);
    for (const split of splits)
      for (let i = 0; i < 2; i++) {
        if (w.enemies.length >= 30) break;
        w.enemies.push({
          ...split,
          id: 10000 + split.id * 2 + i,
          kind: "runner",
          spawned: true,
          x: clamp(split.x + (i ? 20 : -20), 30, 870),
          hp: 10,
          maxHp: 10,
          speed: 100,
          timer: 1.5,
          poison: 0,
        });
      }
    if (
      !w.campaign?.pacingVersion &&
      !w.enemies.length &&
      !w.campaign?.objective &&
      (w.campaign?.wave ?? 1) < (w.campaign?.totalWaves ?? 1)
    ) {
      w.campaign!.wave = (w.campaign!.wave ?? 1) + 1;
      spawnWave(w, w.campaign!.difficulty === "volatile" ? 1.25 : 1);
      w.player.invulnerable = Math.max(w.player.invulnerable, 0.8);
      w.message = `Wave ${w.campaign!.wave}/${w.campaign!.totalWaves}. A different patrol joins the room.`;
    }
  }
  if (w.campaign?.pacingVersion) {
    stepJourney(w, dt);
    return;
  }
  const objective = w.campaign?.objective;
  if (objective && w.stage === "fight") {
    if (objective.kind === "relay") {
      objective.progress +=
        dt *
        (Math.hypot(p.x - objective.x, p.y - objective.y) < 165 ? 1 : 0.35);
      const elapsed = w.time - (w.campaign!.roomStartedAt ?? 0);
      const expected = Math.min(6, Math.floor(elapsed / 6));
      if (objective.spawned < expected && w.enemies.length < 8) {
        objective.spawned++;
        const id = 20000 + objective.spawned;
        w.enemies.push({
          id,
          kind: objective.spawned % 2 ? "runner" : "sentry",
          x: objective.spawned % 2 ? 70 : 830,
          y: 100,
          hp: 32 + sector(w) * 3,
          maxHp: 32 + sector(w) * 3,
          timer: 1.2,
          poison: 0,
          speed: 90,
        });
      }
      if (objective.hp <= 0) {
        w.stage = "lost";
        w.message = "The relay was overwhelmed. Keep the next signal alive.";
      }
    } else {
      if (Math.hypot(p.x - objective.x, p.y - objective.y) < 42) {
        objective.progress++;
        const next = [
          [750, 430],
          [750, 130],
          [150, 130],
        ][objective.progress - 1];
        if (next) [objective.x, objective.y] = next;
        w.message = `Beacon ${objective.progress}/4 reached. Read the next moving margin.`;
      }
      const elapsed = w.time - (w.campaign!.roomStartedAt ?? 0);
      if (Math.floor(elapsed / 2.5) > objective.spawned) {
        objective.spawned = Math.floor(elapsed / 2.5);
        warning(w, "line", 20, p.y, 21, 1.2, 880, p.y);
        warning(w, "circle", p.x, p.y, 62, 1.6);
      }
    }
  }
  if (
    w.stage === "fight" &&
    (objective
      ? objective.progress >= objective.target
      : patrol
        ? w.enemies.length === 0
        : b.hp <= 0)
  )
    combatCleared(w);
}
