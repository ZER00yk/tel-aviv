import { GameRuleError } from "./rules";
import { randomInt, randomUUID } from "node:crypto";
import {
  TOWER_DEFS,
  ENEMY_DEFS,
  TOWER_MAPS,
  waveKinds,
  towerMap,
  pathLength,
  pathPosition,
  pathTile,
  type TowerKind,
  type TowerMapId,
  type TowerMode,
  type TowerTarget,
  type EnemyKind,
} from "../config/tower";
export interface Tower {
  id: string;
  kind: TowerKind;
  x: number;
  y: number;
  level: number;
  target?: TowerTarget;
}
export interface WaveEvent {
  time: number;
  type: "kill" | "leak" | "shot" | "shield-break";
  x: number;
  y?: number;
  enemyId: number;
  towerId?: string;
  enemyKind?: EnemyKind;
}
export interface EnemyPoint {
  time: number;
  x: number;
  y: number;
  hp: number;
  shield: number;
}
export interface WaveEnemy {
  id: number;
  kind: EnemyKind;
  route: number;
  spawn: number;
  maxHp: number;
  bossName?: string;
  points: EnemyPoint[];
  endTime?: number;
  end?: "kill" | "leak";
}
export interface TowerState {
  runId?: string;
  runStartedAt?: number;
  map?: TowerMapId;
  mode?: TowerMode;
  seed?: number;
  clearedMaps?: TowerMapId[];
  phase: "build" | "wave" | "upgrade" | "lost" | "won";
  wave: number;
  lives: number;
  cash: number;
  towers: Tower[];
  kills: number;
  upgrades: string[];
  offeredUpgrades: string[];
  nextId: number;
  lastWave?: {
    kills: number;
    leaks: number;
    reward: number;
    events: WaveEvent[];
    enemies?: WaveEnemy[];
    synergyHits?: number;
  };
}
export const MAX_WAVE_ENEMIES = 160;
export const MAX_WAVE_TICKS = 1500;
export const MAX_WAVE_EVENTS = 800;
export const BOSS_NAMES = [
  "Iron Ram",
  "Prism Keeper",
  "Brood Engine",
  "Overseer",
] as const;
export function newTower(
  options: {
    map?: TowerMapId;
    mode?: TowerMode;
    clearedMaps?: TowerMapId[];
  } = {},
): TowerState {
  return {
    runId: randomUUID(),
    runStartedAt: Date.now(),
    map: options.map ?? "boulevard",
    mode: options.mode ?? "campaign",
    seed: randomInt(0, 0x7fffffff),
    clearedMaps: [...(options.clearedMaps ?? [])],
    phase: "build",
    wave: 0,
    lives: 20,
    cash: 150,
    towers: [],
    kills: 0,
    upgrades: [],
    offeredUpgrades: [],
    nextId: 1,
  };
}
export { waveKinds } from "../config/tower";

export interface TowerWaveEnemy extends WaveEnemy {
  hp: number;
  shield: number;
  progress: number;
  x: number;
  y: number;
  speed: number;
  slowUntil: number;
  burnUntil: number;
  burnPower: number;
  markedUntil: number;
  dead: boolean;
  sampleAt: number;
  sampleInterval: number;
  children: number;
  nextChild: number;
}
/** Serializable fixed-step combat state shared by solo replays and live rooms. */
export interface TowerWaveSimulation {
  wave: number;
  tick: number;
  enemies: TowerWaveEnemy[];
  nextEnemyId: number;
  cooldowns: Record<string, number>;
  events: WaveEvent[];
  kills: number;
  leaks: number;
  synergyHits: number;
  shotEvents: number;
  finished: boolean;
}
function spawnWaveEnemy(state: TowerState, simulation: TowerWaveSimulation) {
  const { wave, enemies } = simulation,
    map = towerMap(state.map),
    scale = Math.min(wave, 500),
    bossIndex = (Math.floor(wave / 5) - 1) % 4;
  const spawn = (
    kind: EnemyKind,
    route: number,
    time: number,
    progress = 0,
  ) => {
    if (enemies.length >= MAX_WAVE_ENEMIES) return;
    const definition = ENEMY_DEFS[kind];
    const hp =
      (15 + scale * 6) * definition.hp + (kind === "boss" ? scale * 12 : 0);
    const position = pathPosition(map.routes[route], progress);
    enemies.push({
      id: simulation.nextEnemyId++,
      kind,
      route,
      spawn: time,
      maxHp: hp,
      hp,
      shield:
        kind === "shield"
          ? 10 + scale * 2
          : kind === "boss" && bossIndex === 1
            ? 30 + scale * 4
            : 0,
      progress,
      ...position,
      speed: (0.42 + Math.min(scale, 80) * 0.006) * definition.speed,
      slowUntil: 0,
      burnUntil: 0,
      burnPower: 0,
      markedUntil: 0,
      dead: false,
      points: [],
      sampleAt: time,
      sampleInterval: 2,
      children: 0,
      nextChild: time + 4,
      bossName: kind === "boss" ? BOSS_NAMES[bossIndex] : undefined,
    });
  };
  return spawn;
}
export function beginTowerWave(state: TowerState): TowerWaveSimulation {
  const simulation: TowerWaveSimulation = {
    wave: state.wave + 1,
    tick: 0,
    enemies: [],
    nextEnemyId: 0,
    cooldowns: {},
    events: [],
    kills: 0,
    leaks: 0,
    synergyHits: 0,
    shotEvents: 0,
    finished: false,
  };
  const spawn = spawnWaveEnemy(state, simulation);
  waveKinds(simulation.wave).forEach((kind, index) =>
    spawn(kind, index % towerMap(state.map).routes.length, index * 0.8),
  );
  state.phase = "wave";
  return simulation;
}
/** Advance at most a caller-selected number of 200 ms ticks; never trust client time. */
export function advanceTowerWave(
  state: TowerState,
  simulation: TowerWaveSimulation,
  steps = 1,
) {
  if (simulation.finished) return true;
  if (!Number.isInteger(steps) || steps < 1 || steps > MAX_WAVE_TICKS)
    throw new GameRuleError("Invalid defense simulation step budget.");
  const { wave, enemies, events } = simulation,
    map = towerMap(state.map),
    scale = Math.min(wave, 500),
    bossIndex = (Math.floor(wave / 5) - 1) % 4,
    spawn = spawnWaveEnemy(state, simulation);
  const power =
    1 + state.upgrades.filter((value) => value === "power").length * 0.2;
  const speed =
    1 + state.upgrades.filter((value) => value === "speed").length * 0.2;
  const range =
    state.upgrades.filter((value) => value === "range").length * 0.35;
  const event = (value: WaveEvent) => {
    if (events.length < MAX_WAVE_EVENTS) events.push(value);
    else if (value.type === "kill" || value.type === "leak") {
      const disposable = events.findIndex(
        (item) => item.type === "shot" || item.type === "shield-break",
      );
      if (disposable >= 0) events[disposable] = value;
    }
  };
  const sample = (enemy: TowerWaveEnemy, time: number, force = false) => {
    if (!force && time < enemy.sampleAt) return;
    if (enemy.points.length >= 16) {
      enemy.points = enemy.points.filter(
        (_, index) => index === 0 || index % 2 === 0,
      );
      enemy.sampleInterval *= 2;
    }
    enemy.points.push({
      time,
      x: enemy.x,
      y: enemy.y,
      hp: Math.max(0, enemy.hp),
      shield: Math.max(0, enemy.shield),
    });
    enemy.sampleAt = time + enemy.sampleInterval;
  };
  const defeat = (enemy: TowerWaveEnemy, time: number) => {
    if (enemy.dead) return;
    enemy.dead = true;
    enemy.end = "kill";
    enemy.endTime = time;
    simulation.kills++;
    sample(enemy, time, true);
    event({
      time,
      type: "kill",
      x: enemy.x,
      y: enemy.y,
      enemyId: enemy.id,
      enemyKind: enemy.kind,
    });
    if (enemy.kind === "splitter")
      for (let index = 0; index < 2; index++)
        spawn(
          "runner",
          enemy.route,
          time + 0.2,
          Math.max(0, enemy.progress - 0.15 * index),
        );
  };
  const hit = (
    enemy: TowerWaveEnemy,
    damage: number,
    tower: Tower,
    time: number,
  ) => {
    const armor = ["heavy", "sniper", "burn"].includes(tower.kind)
      ? 0
      : ENEMY_DEFS[enemy.kind].armor;
    let received = damage * (1 - armor);
    if (enemy.shield > 0 && tower.kind !== "burn") {
      const absorbed = Math.min(enemy.shield, received);
      enemy.shield -= absorbed;
      received -= absorbed;
      if (enemy.shield === 0)
        event({
          time,
          type: "shield-break",
          x: enemy.x,
          y: enemy.y,
          enemyId: enemy.id,
          enemyKind: enemy.kind,
        });
    }
    enemy.hp -= received;
    if (enemy.hp <= 0) defeat(enemy, time);
  };
  const endTick = Math.min(MAX_WAVE_TICKS, simulation.tick + steps);
  for (
    ;
    simulation.tick < endTick && enemies.some((enemy) => !enemy.dead);
    simulation.tick++
  ) {
    const tick = simulation.tick;
    const time = tick * 0.2;
    for (const enemy of enemies) {
      if (enemy.dead || enemy.spawn > time) continue;
      if (enemy.burnUntil > time)
        enemy.hp -= enemy.burnPower * 0.2 * (enemy.slowUntil > time ? 2 : 1);
      else if (enemy.kind === "regen")
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + (1 + scale * 0.06) * 0.2);
      if (enemy.hp <= 0) {
        defeat(enemy, time);
        continue;
      }
      if (enemy.kind === "healer" || (enemy.kind === "boss" && bossIndex === 3))
        for (const ally of enemies)
          if (
            !ally.dead &&
            ally.spawn <= time &&
            Math.hypot(enemy.x - ally.x, enemy.y - ally.y) < 1.4
          )
            ally.hp = Math.min(ally.maxHp, ally.hp + (1 + scale * 0.12) * 0.2);
      if (enemy.kind === "boss" && bossIndex === 1 && enemy.burnUntil <= time)
        enemy.shield = Math.min(30 + scale * 4, enemy.shield + 0.8);
      if (
        enemy.kind === "boss" &&
        bossIndex === 2 &&
        time >= enemy.nextChild &&
        enemy.children < 6
      ) {
        spawn("runner", enemy.route, time, Math.max(0, enemy.progress - 0.2));
        enemy.children++;
        enemy.nextChild = time + 4;
      }
      const enraged =
        enemy.kind === "boss" &&
        (bossIndex === 0 || bossIndex === 3) &&
        enemy.hp < enemy.maxHp * 0.5
          ? 1.5
          : 1;
      enemy.progress +=
        enemy.speed * 0.2 * (enemy.slowUntil > time ? 0.5 : 1) * enraged;
      const position = pathPosition(map.routes[enemy.route], enemy.progress);
      enemy.x = position.x;
      enemy.y = position.y;
      if (enemy.progress >= pathLength(map.routes[enemy.route])) {
        enemy.dead = true;
        enemy.end = "leak";
        enemy.endTime = time;
        simulation.leaks++;
        sample(enemy, time, true);
        event({
          time,
          type: "leak",
          x: enemy.x,
          y: enemy.y,
          enemyId: enemy.id,
          enemyKind: enemy.kind,
        });
      } else sample(enemy, time);
    }
    for (const tower of state.towers) {
      const def = TOWER_DEFS[tower.kind];
      if (!def.damage || (simulation.cooldowns[tower.id] ?? 0) > time) continue;
      const nearby = state.towers
        .filter(
          (other) =>
            other.kind === "support" &&
            Math.hypot(other.x - tower.x, other.y - tower.y) <= 2.5,
        )
        .slice(0, 4);
      const bonus = map.bonusTiles.find(
        (tile) => tile.x === tower.x && tile.y === tower.y,
      );
      const effectiveRange =
        def.range +
        range +
        nearby.length * 0.15 +
        (bonus?.kind === "high-ground" ? 0.6 : 0);
      const candidates = enemies.filter(
        (enemy) =>
          !enemy.dead &&
          enemy.spawn <= time &&
          (enemy.kind !== "stealth" ||
            tower.kind === "sniper" ||
            nearby.length > 0) &&
          Math.hypot(enemy.x - tower.x, enemy.y - tower.y) <= effectiveRange,
      );
      candidates.sort((a, b) =>
        tower.target === "strongest"
          ? b.hp + b.shield - a.hp - a.shield
          : tower.target === "support"
            ? Number(["healer", "disruptor"].includes(b.kind)) -
                Number(["healer", "disruptor"].includes(a.kind)) ||
              b.progress / pathLength(map.routes[b.route]) -
                a.progress / pathLength(map.routes[a.route])
            : b.progress / pathLength(map.routes[b.route]) -
              a.progress / pathLength(map.routes[a.route]),
      );
      const target = candidates[0];
      if (!target) continue;
      let damage =
        def.damage *
        (1 + (tower.level - 1) * 0.65) *
        power *
        (1 +
          nearby.reduce(
            (sum, other) => sum + 0.15 + (other.level - 1) * 0.025,
            0,
          )) *
        (bonus?.kind === "power-node" ? 1.15 : 1);
      if (["heavy", "splash"].includes(tower.kind) && target.slowUntil > time) {
        damage *= 1.35;
        simulation.synergyHits++;
      }
      if (tower.kind === "sniper" && target.markedUntil > time) {
        damage *= 1.4;
        simulation.synergyHits++;
      }
      const disrupted = enemies.some(
        (enemy) =>
          !enemy.dead &&
          enemy.spawn <= time &&
          (enemy.kind === "disruptor" ||
            (enemy.kind === "boss" && bossIndex === 3)) &&
          Math.hypot(enemy.x - tower.x, enemy.y - tower.y) < 2,
      );
      simulation.cooldowns[tower.id] =
        time + (def.interval / speed) * (disrupted ? 1.35 : 1);
      if (simulation.shotEvents < 450) {
        simulation.shotEvents++;
        event({
          time,
          type: "shot",
          x: target.x,
          y: target.y,
          enemyId: target.id,
          towerId: tower.id,
          enemyKind: target.kind,
        });
      }
      if (tower.kind === "slow") target.slowUntil = time + 2;
      if (tower.kind === "rapid") target.markedUntil = time + 2;
      if (tower.kind === "burn") {
        target.burnUntil = time + 3;
        target.burnPower = 4 * (1 + (tower.level - 1) * 0.4) * power;
      }
      hit(target, damage, tower, time);
      if (tower.kind === "splash")
        for (const enemy of enemies)
          if (
            !enemy.dead &&
            enemy.spawn <= time &&
            enemy.id !== target.id &&
            Math.hypot(enemy.x - target.x, enemy.y - target.y) < 0.9
          )
            hit(enemy, damage * 0.5, tower, time);
    }
  }
  if (simulation.tick < MAX_WAVE_TICKS && enemies.some((enemy) => !enemy.dead))
    return false;
  for (const enemy of enemies)
    if (!enemy.dead) {
      enemy.dead = true;
      enemy.end = "leak";
      enemy.endTime = MAX_WAVE_TICKS * 0.2;
      simulation.leaks++;
      sample(enemy, enemy.endTime, true);
      event({
        time: enemy.endTime,
        type: "leak",
        x: enemy.x,
        y: enemy.y,
        enemyId: enemy.id,
        enemyKind: enemy.kind,
      });
    }
  state.wave = wave;
  state.kills += simulation.kills;
  state.lives = Math.max(0, state.lives - simulation.leaks);
  const reward =
    25 +
    simulation.kills * 4 +
    state.towers
      .filter((tower) => tower.kind === "economy")
      .reduce((sum, tower) => sum + 12 * tower.level, 0);
  state.cash = Math.min(1_000_000, state.cash + reward);
  state.lastWave = {
    kills: simulation.kills,
    leaks: simulation.leaks,
    reward,
    events: events.sort((a, b) => a.time - b.time),
    synergyHits: simulation.synergyHits,
    enemies: enemies.map((enemy) => ({
      id: enemy.id,
      kind: enemy.kind,
      route: enemy.route,
      spawn: enemy.spawn,
      maxHp: enemy.maxHp,
      bossName: enemy.bossName,
      points: enemy.points,
      end: enemy.end,
      endTime: enemy.endTime,
    })),
  };
  state.phase =
    state.lives <= 0
      ? "lost"
      : (state.mode ?? "campaign") === "campaign" && wave >= 20
        ? "won"
        : wave % 3 === 0
          ? "upgrade"
          : "build";
  if (state.phase === "won")
    state.clearedMaps = [
      ...new Set([...(state.clearedMaps ?? []), state.map ?? "boulevard"]),
    ];
  if (state.phase === "upgrade") {
    const choices = ["power", "speed", "range", "fortify", "funding"];
    const offset = ((state.seed ?? 1) + wave * 7) % choices.length;
    state.offeredUpgrades = [
      choices[offset],
      choices[(offset + 1) % choices.length],
      choices[(offset + 2) % choices.length],
    ];
  }
  simulation.finished = true;
  return true;
}

export function simulateWave(state: TowerState) {
  const simulation = beginTowerWave(state);
  advanceTowerWave(state, simulation, MAX_WAVE_TICKS);
  return state;
}

/** Live waves accept only ordinary build commands; no reward/outcome fields. */
export function actTowerDuringWave(
  state: TowerState,
  action: string,
  payload: Record<string, unknown>,
) {
  if (
    state.phase !== "wave" ||
    !["place", "upgrade", "sell", "target"].includes(action)
  )
    throw new GameRuleError("This command is unavailable during a wave.");
  state.phase = "build";
  try {
    return actTower(state, action, payload);
  } finally {
    state.phase = "wave";
  }
}
export function actTower(
  state: TowerState,
  action: string,
  payload: Record<string, unknown>,
) {
  if (action === "state") return state;
  if (action === "start") {
    const map = payload.map ?? "boulevard",
      mode = payload.mode ?? "campaign";
    if (typeof map !== "string" || !Object.hasOwn(TOWER_MAPS, map))
      throw new GameRuleError("Choose an available defense map.");
    if (mode !== "campaign" && mode !== "endless")
      throw new GameRuleError("Choose campaign or endless mode.");
    return newTower({
      map: map as TowerMapId,
      mode,
      clearedMaps: state.clearedMaps,
    });
  }
  if (state.phase === "lost" || state.phase === "won")
    throw new GameRuleError("The defense is complete. Start a new map.");
  if (action === "choose") {
    if (
      state.phase !== "upgrade" ||
      !state.offeredUpgrades.includes(String(payload.upgrade))
    )
      throw new GameRuleError("Choose one of the offered upgrades.");
    const upgrade = String(payload.upgrade);
    state.upgrades.push(upgrade);
    if (upgrade === "fortify") state.lives = Math.min(200, state.lives + 5);
    if (upgrade === "funding")
      state.cash = Math.min(1_000_000, state.cash + 100);
    state.phase = "build";
    state.offeredUpgrades = [];
    return state;
  }
  if (state.phase !== "build")
    throw new GameRuleError("Choose your wave reward first.");
  if (action === "wave") {
    if (!state.towers.length) throw new GameRuleError("Place a tower first.");
    if (state.wave >= 10_000)
      throw new GameRuleError(
        "This defense reached its simulation limit. Start a new run.",
      );
    return simulateWave(state);
  }
  if (action === "place") {
    const kind = payload.kind as TowerKind;
    if (!Object.hasOwn(TOWER_DEFS, kind))
      throw new GameRuleError("Unknown tower.");
    const x = Number(payload.x),
      y = Number(payload.y);
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      x > 7 ||
      y < 0 ||
      y > 4 ||
      pathTile(towerMap(state.map), x, y)
    )
      throw new GameRuleError(
        "Place towers on the 8×5 grid, away from this map's path.",
      );
    if (state.towers.some((tower) => tower.x === x && tower.y === y))
      throw new GameRuleError("This tile is occupied.");
    if (state.cash < TOWER_DEFS[kind].cost)
      throw new GameRuleError("Not enough cash.");
    state.cash -= TOWER_DEFS[kind].cost;
    state.towers.push({
      id: String(state.nextId++),
      kind,
      x,
      y,
      level: 1,
      target: "first",
    });
    return state;
  }
  const tower = state.towers.find((tower) => tower.id === payload.towerId);
  if (!tower) throw new GameRuleError("Tower not found.");
  if (action === "target") {
    if (!["first", "strongest", "support"].includes(String(payload.target)))
      throw new GameRuleError("Choose a supported targeting priority.");
    tower.target = payload.target as TowerTarget;
    return state;
  }
  if (action === "upgrade") {
    if (tower.level >= 5)
      throw new GameRuleError("This tower is fully upgraded.");
    const cost = Math.ceil(TOWER_DEFS[tower.kind].cost * tower.level * 0.8);
    if (state.cash < cost) throw new GameRuleError("Not enough cash.");
    state.cash -= cost;
    tower.level++;
    return state;
  }
  if (action === "sell") {
    const base = TOWER_DEFS[tower.kind].cost;
    const invested =
      base +
      Array.from({ length: tower.level - 1 }, (_, index) =>
        Math.ceil(base * (index + 1) * 0.8),
      ).reduce((sum, cost) => sum + cost, 0);
    state.cash += Math.floor(invested * 0.6);
    state.towers = state.towers.filter((other) => other.id !== tower.id);
    return state;
  }
  throw new GameRuleError("Unknown tower defense action.");
}
