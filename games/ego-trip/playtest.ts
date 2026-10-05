import {
  chooseMod,
  chooseRoute,
  eventChoice,
  newCampaignWorld,
  nextEncounter,
  pointToSegment,
  shop,
  shopCost,
  stepWorld,
  type Input,
  type World,
} from "./engine";
import { arenaFor } from "./arena";
import { isPatrol, type Difficulty } from "./campaign";
import { bosses, type WeaponId } from "./content";

export interface RoomMeasurement {
  index: number;
  kind: string;
  name: string;
  district: number;
  weapon: WeaponId;
  complete: boolean;
  bossName: string | null;
  bossPhasesSeen: number[];
  bossAttacks: number;
  enemyKindsSeen: string[];
  seconds: number;
  damageDealt: number;
  incomingDamage: number;
  healing: number;
  healthAtStart: number;
  healthRemaining: number;
  maxHealth: number;
  resourcesAtStart: number;
  resources: number;
  resourcesNet: number;
  upgrades: number;
  upgradesGained: string[];
  damagePerSecond: number;
  stateBytes: number;
}
const utf8 = new TextEncoder();
const stateBytes = (w: World) => utf8.encode(JSON.stringify(w)).length;
const round = (value: number) => +value.toFixed(3);
function profile(samples: number[]) {
  const sorted = samples.slice().sort((a, b) => a - b);
  const percentile = (p: number) =>
    round(
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0,
    );
  return {
    samples: sorted.length,
    meanMs: round(
      samples.reduce((sum, value) => sum + value, 0) / (samples.length || 1),
    ),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: round(sorted.at(-1) ?? 0),
  };
}
function riskAt(w: World, x: number, y: number) {
  let score = 0;
  const position = { x, y };
  for (const h of w.hazards) {
    if (!h.damage || h.timer > 0.65 || h.active <= 0) continue;
    const dist = Math.hypot(x - h.x, y - h.y);
    const inside =
      h.kind === "line"
        ? pointToSegment(position, h, { x: h.x2, y: h.y2 }) < h.radius + 20
        : h.kind === "ring"
          ? dist < h.radius + 18 && dist > h.safeRadius - 18
          : dist < h.radius + 20;
    if (inside) score += h.timer > 0 ? 25 : 100;
  }
  for (const b of w.bullets) {
    if (!b.enemy) continue;
    const future = { x: b.x + b.vx * 0.3, y: b.y + b.vy * 0.3 };
    if (pointToSegment(position, b, future) < b.radius + 25) score += 35;
  }
  for (const terrain of arenaFor(w.bossIndex).terrain) {
    const distance = Math.hypot(x - terrain.x, y - terrain.y);
    if (terrain.kind === "cover" && distance < terrain.radius + 17) score += 40;
    if (
      terrain.kind === "heat" &&
      w.time % 6 < 2 &&
      distance < terrain.radius + 20
    )
      score += 25;
  }
  if (x < 40 || x > 860 || y < 40 || y > 520) score += 10;
  return score;
}
/** A deterministic heuristic player. It reads visible combat geometry and uses ordinary controls only. */
export function playtestInput(w: World): Input {
  const p = w.player;
  const liveEnemies = w.enemies.filter((e) => e.hp > 0);
  const targets =
    liveEnemies.length || isPatrol(w) ? liveEnemies : [w.boss];
  const target =
    targets
      .slice()
      .sort(
        (a, b) =>
          Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(p.x - b.x, p.y - b.y),
      )[0] ?? w.boss;
  const reach = {
    pulse: 230,
    scatter: 95,
    blade: 72,
    comet: 210,
    lance: 118,
    boomerang: 150,
    prism: 155,
  }[w.weapon];
  const objective = w.campaign?.objective;
  const journeyObjective =
    objective && ["parcel", "ward", "escort"].includes(objective.kind);
  const goal =
    objective &&
    ((journeyObjective && !liveEnemies.length) ||
      (!journeyObjective &&
        (objective.kind === "beacons" ||
          Math.hypot(p.x - objective.x, p.y - objective.y) > 130)))
      ? objective
      : target;
  const goalReach =
    goal === objective
      ? journeyObjective || objective!.kind === "beacons"
        ? 0
        : 80
      : reach;
  let best = { x: 0, y: 0, score: Infinity };
  for (const dx of [-1, 0, 1])
    for (const dy of [-1, 0, 1]) {
      const length = Math.max(1, Math.hypot(dx, dy));
      const x = Math.max(20, Math.min(880, p.x + (dx / length) * 230 * 0.3));
      const y = Math.max(20, Math.min(540, p.y + (dy / length) * 230 * 0.3));
      let score =
        riskAt(w, x, y) +
        Math.abs(Math.hypot(x - goal.x, y - goal.y) - goalReach) * 0.04;
      // Projectiles respect visible cover. Move around a blocked firing line;
      // otherwise the heuristic can safely fire into one pillar indefinitely.
      if (
        goal === target &&
        target.hp > 0 &&
        ["pulse", "scatter", "comet", "boomerang"].includes(w.weapon)
      ) {
        for (const terrain of arenaFor(w.bossIndex).terrain)
          if (terrain.kind === "cover")
            score +=
              Math.max(
                0,
                terrain.radius + 7 - pointToSegment(terrain, { x, y }, target),
              ) * 1.0;
      }
      for (const enemy of targets)
        if (Math.hypot(x - enemy.x, y - enemy.y) < 55) score += 25;
      if (!dx && !dy && (p.stillTime ?? 0) > 1.8) score += 5;
      if (score < best.score) best = { x: dx / length, y: dy / length, score };
    }
  return {
    x: best.x,
    y: best.y,
    aimX: target.x,
    aimY: target.y,
    attack: true,
    alternate: true,
    dash: riskAt(w, p.x, p.y) > 30 && best.score < 20,
  };
}

export function runCampaignPlaytest(options: {
  seed: number;
  weapon: WeaponId;
  difficulty?: Difficulty;
  maxSeconds?: number;
  routeStrategy?: "safer" | "objectives";
}) {
  const w = newCampaignWorld(options.weapon, options.seed, {
    difficulty: options.difficulty,
  });
  const rooms: RoomMeasurement[] = [];
  const started = performance.now();
  const initialHeap =
    typeof process === "undefined" ? null : process.memoryUsage().heapUsed;
  let maxStateBytes = 0,
    maxBullets = 0,
    maxHazards = 0,
    maxEnemies = 0,
    measuredRoom = -1,
    ticks = 0,
    iterations = 0,
    resourceCapSeconds = 0;
  let observedHeapMax = initialHeap;
  const stepSamples: number[] = [],
    inputSamples: number[] = [];
  const shopPurchases: { room: number; kind: string; cost: number }[] = [];
  let roomStart = {
    time: 0,
    damageDealt: 0,
    damageTaken: 0,
    healing: 0,
    health: w.player.hp,
    resources: w.ego,
    upgrades: 0,
  };
  let enemyKinds = new Set<string>(),
    bossPhases = new Set<number>();
  let roomWeapon = options.weapon;
  function measureRoom(complete: boolean) {
    const c = w.campaign!;
    if (rooms.at(-1)?.index === c.roomIndex) return;
    const seconds = w.time - roomStart.time;
    const dealt = w.telemetry!.damageDealt - roomStart.damageDealt;
    const bytes = stateBytes(w);
    maxStateBytes = Math.max(maxStateBytes, bytes);
    rooms.push({
      index: c.roomIndex,
      kind: c.room.kind,
      name: c.room.name,
      district: Math.floor(c.roomIndex / 5) + 1,
      weapon: roomWeapon,
      complete,
      bossName: c.room.kind === "boss" ? bosses[w.bossIndex].name : null,
      bossPhasesSeen: [...bossPhases].sort(),
      bossAttacks: ["boss", "miniboss"].includes(c.room.kind)
        ? w.boss.attackIndex
        : 0,
      enemyKindsSeen: [...enemyKinds].sort(),
      seconds: round(seconds),
      damageDealt: round(dealt),
      incomingDamage: round(w.telemetry!.damageTaken - roomStart.damageTaken),
      healing: round(w.telemetry!.healing - roomStart.healing),
      healthAtStart: round(roomStart.health),
      healthRemaining: round(w.player.hp),
      maxHealth: w.player.maxHp,
      resourcesAtStart: roomStart.resources,
      resources: w.ego,
      resourcesNet: w.ego - roomStart.resources,
      upgrades: w.mods.length,
      upgradesGained: w.mods.slice(roomStart.upgrades),
      damagePerSecond: seconds ? round(dealt / seconds) : 0,
      stateBytes: bytes,
    });
  }
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
  while (
    w.stage !== "won" &&
    w.stage !== "lost" &&
    w.time < (options.maxSeconds ?? 7200) &&
    iterations++ < Math.ceil((options.maxSeconds ?? 7200) * 25) + 1000
  ) {
    const c = w.campaign!;
    if (measuredRoom !== c.roomIndex) {
      measuredRoom = c.roomIndex;
      roomStart = {
        time: w.time,
        ...w.telemetry!,
        health: w.player.hp,
        resources: w.ego,
        upgrades: w.mods.length,
      };
      enemyKinds = new Set();
      bossPhases = new Set();
      roomWeapon = w.weapon;
    }
    for (const enemy of w.enemies) enemyKinds.add(enemy.kind);
    if (["boss", "miniboss"].includes(c.room.kind))
      bossPhases.add(w.boss.phase);
    if (w.stage === "fight") {
      const inputStarted = performance.now();
      const input = playtestInput(w);
      inputSamples.push(performance.now() - inputStarted);
      const stepStarted = performance.now();
      stepWorld(w, input, 0.04);
      stepSamples.push(performance.now() - stepStarted);
      ticks++;
      if (w.ego >= 250) resourceCapSeconds += 0.04;
    } else if (w.stage === "choice") {
      const mod = w.offered
        .slice()
        .sort(
          (a, b) =>
            (priority.includes(a) ? priority.indexOf(a) : 99) -
            (priority.includes(b) ? priority.indexOf(b) : 99),
        )[0];
      chooseMod(w, mod);
    } else if (w.stage === "shop") {
      if (w.player.hp < w.player.maxHp - 15) {
        const cost = shopCost(w, "heal");
        if (shop(w, "heal"))
          shopPurchases.push({ room: c.roomIndex, kind: "heal", cost });
      }
      if (!w.helper || w.helper.kind !== "medic") {
        const cost = shopCost(w, "helper");
        if (shop(w, "helper"))
          shopPurchases.push({ room: c.roomIndex, kind: "helper", cost });
      }
      nextEncounter(w);
    } else if (w.stage === "event")
      eventChoice(
        w,
        c.room.kind === "helper"
          ? "medic"
          : c.room.kind === "npc"
            ? "risk"
            : "safe",
      );
    const stageAfterAction = w.stage as World["stage"];
    if (
      stageAfterAction === "route" ||
      stageAfterAction === "won" ||
      stageAfterAction === "lost"
    ) {
      measureRoom(stageAfterAction !== "lost");
      if (stageAfterAction === "route") {
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
        if (options.routeStrategy === "objectives")
          order.unshift("protect", "trial");
        const route = c.routes
          .slice()
          .sort(
            (a, b) =>
              (order.includes(a.kind) ? order.indexOf(a.kind) : 99) -
              (order.includes(b.kind) ? order.indexOf(b.kind) : 99),
          )[0];
        chooseRoute(w, route.id);
      }
    }
    maxBullets = Math.max(maxBullets, w.bullets.length);
    maxHazards = Math.max(maxHazards, w.hazards.length);
    maxEnemies = Math.max(maxEnemies, w.enemies.length);
    if (ticks % 125 === 0) {
      maxStateBytes = Math.max(maxStateBytes, stateBytes(w));
      if (observedHeapMax !== null)
        observedHeapMax = Math.max(
          observedHeapMax,
          process.memoryUsage().heapUsed,
        );
    }
  }
  measureRoom(w.stage === "won");
  return {
    seed: options.seed,
    weapon: options.weapon,
    difficulty: options.difficulty ?? "standard",
    routeStrategy: options.routeStrategy ?? "safer",
    result: w.stage,
    timedOut: w.stage !== "won" && w.stage !== "lost",
    simulationSeconds: +w.time.toFixed(3),
    botWallClockMs: +(performance.now() - started).toFixed(2),
    heapDeltaBytes:
      initialHeap === null
        ? null
        : process.memoryUsage().heapUsed - initialHeap,
    observedHeapMaxBytes: observedHeapMax,
    fixedStepSeconds: 0.04,
    ticks,
    engineStepProfile: profile(stepSamples),
    botInputProfile: profile(inputSamples),
    roomsCleared: w.campaign!.cleared,
    bossesDefeated: w.kills,
    damageDealt: Math.round(w.telemetry!.damageDealt),
    incomingDamage: Math.round(w.telemetry!.damageTaken),
    healing: Math.round(w.telemetry!.healing),
    resources: w.ego,
    resourceCapSeconds: round(resourceCapSeconds),
    shopPurchases,
    upgrades: w.mods.length,
    finalMods: w.mods.slice(),
    maxStateBytes,
    finalStateBytes: stateBytes(w),
    maxBullets,
    maxHazards,
    maxEnemies,
    rooms,
  };
}
