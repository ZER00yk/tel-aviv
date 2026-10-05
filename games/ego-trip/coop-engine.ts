import { z } from "zod";
import { bosses, weapons, type WeaponId } from "./content";
import { arenaFor, keepOutsideCover } from "./arena";
import {
  JOURNEY_PACING_VERSION,
  JOURNEY_PHASE_COUNT,
  JOURNEY_RULES,
  journeyStageCount,
  journeyStageDefinition,
  type JourneyEnemyKind,
} from "./journey";
import {
  campaignRoom,
  campaignRandom,
  COOP_CAMPAIGN_ROOMS,
  coopRewards,
  type CoopRoom,
  type CoopReward,
} from "./coop-campaign";

export const COOP_WIDTH = 900;
export const COOP_HEIGHT = 560;
export class CoopRuleError extends Error {}
interface Point {
  x: number;
  y: number;
}
export interface CoopInput {
  type: "coop:input";
  sequence: number;
  dx: number;
  dy: number;
  aimX: number;
  aimY: number;
  fire: boolean;
  alternate: boolean;
  dash: boolean;
  revive: boolean;
}
export interface CoopPlayer extends Point {
  hp: number;
  maxHp?: number;
  credits?: number;
  upgrades?: Partial<Record<CoopReward, number>>;
  helperCooldown?: number;
  helperKind?: "gunner" | "medic";
  helperHp?: number;
  helperChosenRoom?: number;
  modifiers?: ("glass" | "refraction" | "mercy")[];
  rewardClaimedRoom?: number;
  deaths?: number;
  departed?: boolean;
  stillTime?: number;
  status: "alive" | "downed" | "eliminated";
  weapon: WeaponId;
  damage: number;
  revives: number;
  reviveProgress: number;
  downedUntil: number;
  cooldown: number;
  alternateCooldown: number;
  dashCooldown: number;
  dashTime: number;
  dashX: number;
  dashY: number;
  invulnerable: number;
  input: CoopInput | null;
  inputAt: number;
  sequence: number;
}
interface CoopShot extends Point {
  id: number;
  vx: number;
  vy: number;
  life: number;
  radius: number;
  damage: number;
  ownerId: string | null;
  returnTime?: number;
  hitTargets?: string[];
  explosive?: boolean;
}
interface CoopHazard extends Point {
  id: number;
  kind: "circle" | "ring" | "line";
  x2: number;
  y2: number;
  radius: number;
  innerRadius: number;
  delay: number;
  life: number;
}
export interface CoopEnemy extends Point {
  id: number;
  kind: "chaser" | "shooter" | "brute" | "splitter";
  hp: number;
  maxHp: number;
  cooldown: number;
  radius: number;
}
export interface CoopCampaign {
  /** Missing on saved compact campaigns; only new campaigns opt into the journey. */
  pacingVersion?: 1;
  journey?: {
    stage: number;
    stages: number;
    bossPhase: number;
    completedStages: number;
  };
  objective?: {
    kind: "parcel" | "ward" | "escort";
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    progress: number;
    target: number;
    spawned: number;
    carrying?: boolean;
    carrierId?: string;
    guideId?: string;
    dropped?: boolean;
    ambushed?: boolean;
  };
  seed: number;
  room: CoopRoom;
  enemies: CoopEnemy[];
  votes: Record<string, number>;
  choiceUntil: number;
  clearedRooms: number;
  checkpointRoom: number;
  roomElapsed: number;
  environmentCooldown: number;
  signalKey?: boolean;
  refusals?: number;
  secrets?: string[];
  sharedEvent?: {
    resolved: boolean;
    until: number;
    votes: Record<string, number>;
    outcome: string;
  };
}
export interface CoopState {
  kind: "ego-trip";
  stage: "fight" | "intermission" | "choice" | "camp" | "won" | "lost";
  mode?: "gauntlet" | "campaign";
  campaign?: CoopCampaign;
  bossIndex: number;
  boss: Point & {
    hp: number;
    maxHp: number;
    phase: number;
    attack: number;
    cooldown: number;
    opening?: number;
    recoveryDelay?: number;
  };
  players: Record<string, CoopPlayer>;
  shots: CoopShot[];
  hazards: CoopHazard[];
  lastTick: number;
  startedAt: number;
  elapsed: number;
  nextId: number;
  intermissionUntil: number;
  continued: string[];
  result?: {
    winners: string[];
    scores: Record<string, number>;
    reason: string;
  };
}

const inputSchema = z
  .object({
    type: z.literal("coop:input"),
    sequence: z.number().int().min(0).max(1_000_000),
    dx: z.number().finite().min(-1).max(1),
    dy: z.number().finite().min(-1).max(1),
    aimX: z.number().finite().min(0).max(COOP_WIDTH),
    aimY: z.number().finite().min(0).max(COOP_HEIGHT),
    fire: z.boolean(),
    alternate: z.boolean(),
    dash: z.boolean(),
    revive: z.boolean(),
  })
  .strict();
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new CoopRuleError(message);
}
function newBoss(index: number, playerCount: number) {
  const hp = Math.round(bosses[index].hp * (0.8 + playerCount * 0.45));
  return { x: 450, y: 160, hp, maxHp: hp, phase: 1, attack: 0, cooldown: 2 };
}
export function createCoopState(
  ids: string[],
  now: number,
  mode: "gauntlet" | "campaign" = "gauntlet",
  seed = 1,
  campaignPacing: "journey" | "legacy" = "journey",
): CoopState {
  assert(ids.length >= 2 && ids.length <= 4, "Co-op needs 2–4 players");
  const state: CoopState = {
    kind: "ego-trip",
    mode,
    stage: "fight",
    bossIndex: 0,
    boss: newBoss(0, ids.length),
    players: Object.fromEntries(
      ids.map((id, i) => [
        id,
        {
          x: 395 + i * 38,
          y: 440,
          hp: 100,
          maxHp: 100,
          credits: 0,
          upgrades: {},
          helperCooldown: 0,
          rewardClaimedRoom: -1,
          deaths: 0,
          status: "alive",
          weapon: "pulse",
          damage: 0,
          revives: 0,
          reviveProgress: 0,
          downedUntil: 0,
          cooldown: 0,
          alternateCooldown: 0,
          dashCooldown: 0,
          dashTime: 0,
          dashX: 0,
          dashY: 0,
          invulnerable: 1,
          input: null,
          inputAt: 0,
          sequence: -1,
        },
      ]),
    ),
    shots: [],
    hazards: [],
    lastTick: now,
    startedAt: now,
    elapsed: 0,
    nextId: 1,
    intermissionUntil: 0,
    continued: [],
  };
  if (mode === "campaign") {
    state.campaign = {
      ...(campaignPacing === "journey"
        ? { pacingVersion: JOURNEY_PACING_VERSION }
        : {}),
      seed,
      room: campaignRoom(seed, 0),
      enemies: [],
      votes: {},
      choiceUntil: 0,
      clearedRooms: 0,
      checkpointRoom: 0,
      roomElapsed: 0,
      environmentCooldown: 3,
    };
    enterCampaignRoom(state, now);
  }
  return state;
}

export function applyCoopAction(
  s: CoopState,
  userId: string,
  payload: unknown,
  now: number,
) {
  const p = s.players[userId];
  assert(p, "Join this co-op room first");
  assert(!s.result, "This expedition ended");
  assert(!p.departed, "You left this expedition");
  const base = z.object({ type: z.string() }).passthrough().parse(payload);
  if (base.type === "coop:input") {
    const input = inputSchema.parse(payload);
    assert(
      input.sequence > p.sequence,
      "Stale input sequence; recover the room",
    );
    p.sequence = input.sequence;
    p.inputAt = now;
    p.input = input;
  } else if (base.type === "coop:continue") {
    z.object({ type: z.literal("coop:continue") })
      .strict()
      .parse(payload);
    assert(
      s.stage === "intermission" || s.stage === "camp",
      "Finish this encounter first",
    );
    if (!s.continued.includes(userId)) s.continued.push(userId);
  } else if (base.type === "coop:weapon") {
    const { weapon } = z
      .object({
        type: z.literal("coop:weapon"),
        weapon: z
          .string()
          .refine((value) => Object.hasOwn(weapons, value), "Unknown weapon"),
      })
      .strict()
      .parse(payload);
    assert(
      s.stage === "intermission" ||
        s.stage === "camp" ||
        s.stage === "choice" ||
        s.elapsed < 3,
      "Change weapons between encounters",
    );
    p.weapon = weapon as WeaponId;
  } else if (base.type === "coop:vote") {
    const { option } = z
      .object({
        type: z.literal("coop:vote"),
        option: z.number().int().min(0).max(2),
      })
      .strict()
      .parse(payload);
    assert(
      s.stage === "choice" && s.campaign?.room.options?.[option],
      "Choose an available shared route",
    );
    s.campaign.votes[userId] = option;
  } else if (base.type === "coop:event-vote") {
    const { option } = z
      .object({
        type: z.literal("coop:event-vote"),
        option: z.number().int().min(0).max(1),
      })
      .strict()
      .parse(payload);
    assert(
      s.stage === "camp" &&
        s.campaign?.sharedEvent &&
        !s.campaign.sharedEvent.resolved,
      "No shared event is awaiting votes",
    );
    assert(
      p.status !== "eliminated",
      "Spectators cannot vote on expedition rewards",
    );
    s.campaign.sharedEvent.votes[userId] = option;
  } else if (base.type === "coop:helper") {
    const { kind } = z
      .object({
        type: z.literal("coop:helper"),
        kind: z.enum(["gunner", "medic"]),
      })
      .strict()
      .parse(payload);
    assert(
      s.stage === "camp" &&
        s.campaign?.room.kind === "helper" &&
        p.status === "alive",
      "Choose a companion at a helper stop",
    );
    assert(
      p.helperChosenRoom !== s.campaign.room.index,
      "You already chose this room companion",
    );
    p.helperKind = kind;
    p.helperHp = 40 + 10 * (p.upgrades?.helper ?? 1);
    p.helperChosenRoom = s.campaign.room.index;
    p.helperCooldown = 0;
  } else if (base.type === "coop:reward" || base.type === "coop:buy") {
    const { reward } = z
      .object({
        type: z.enum(["coop:reward", "coop:buy"]),
        reward: z.enum(["power", "guard", "tempo", "helper"]),
      })
      .strict()
      .parse(payload);
    assert(
      s.campaign && (s.stage === "intermission" || s.stage === "camp"),
      "Rewards are available between campaign encounters",
    );
    assert(
      p.status !== "eliminated",
      "Spectators receive rewards at the next boss checkpoint",
    );
    const room = s.campaign.room;
    const upgrades = (p.upgrades ??= {});
    assert(
      (upgrades[reward] ?? 0) < 4,
      "This upgrade reached its four-stack limit",
    );
    if (base.type === "coop:buy") {
      assert(
        room.kind === "shop" && s.stage === "camp",
        "Find a campaign shop first",
      );
      assert((p.credits ?? 0) >= 18, "Not enough expedition shards");
      p.credits = (p.credits ?? 0) - 18;
    } else {
      assert(
        p.rewardClaimedRoom !== room.index,
        "You already claimed this room reward",
      );
      assert(room.kind !== "shop", "Use shards to buy at this shop");
      p.rewardClaimedRoom = room.index;
    }
    upgrades[reward] = (upgrades[reward] ?? 0) + 1;
    if (reward === "helper") {
      p.helperKind ??= "gunner";
      p.helperHp = 40 + 10 * upgrades.helper!;
    }
    if (reward === "guard") {
      p.maxHp = Math.min(140, (p.maxHp ?? 100) + 10);
      p.hp = Math.min(p.maxHp, p.hp + 20);
    }
  } else throw new CoopRuleError("Unknown co-op action");
}
function finish(s: CoopState, won: boolean, reason: string) {
  s.stage = won ? "won" : "lost";
  s.result = {
    winners: won
      ? Object.entries(s.players)
          .filter(([, p]) => !p.departed)
          .map(([id]) => id)
      : [],
    scores: Object.fromEntries(
      Object.entries(s.players).map(([id, p]) => [id, Math.round(p.damage)]),
    ),
    reason,
  };
  s.shots = [];
  s.hazards = [];
}
function hurt(p: CoopPlayer, damage: number, now: number, journey = false) {
  if (p.status !== "alive" || p.invulnerable > 0) return;
  p.hp = Math.max(
    0,
    p.hp -
      damage *
        (journey ? JOURNEY_RULES.sustain.incomingDamage.standard : 1) *
        (p.modifiers?.includes("glass") ? 1.2 : 1) *
        (1 - 0.06 * Math.sqrt(p.upgrades?.guard ?? 0)),
  );
  p.invulnerable = 0.7;
  if (!p.hp) {
    p.deaths = (p.deaths ?? 0) + 1;
    p.status = p.revives >= 2 ? "eliminated" : "downed";
    p.downedUntil = now + 30_000;
    p.reviveProgress = 0;
    p.input = null;
  }
}
function shoot(
  s: CoopState,
  point: Point,
  angle: number,
  ownerId: string | null,
  damage: number,
  speed: number,
  life = 3,
  radius = 5,
) {
  if (s.shots.length >= 240) return;
  s.shots.push({
    id: s.nextId++,
    ...point,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    ownerId,
    damage,
    life,
    radius,
  });
}
function hazard(
  s: CoopState,
  kind: CoopHazard["kind"],
  x: number,
  y: number,
  radius: number,
  delay = 1,
  x2 = x,
  y2 = y,
  innerRadius = 0,
) {
  if (s.hazards.length < 48)
    s.hazards.push({
      id: s.nextId++,
      kind,
      x,
      y,
      x2,
      y2,
      radius,
      innerRadius,
      delay,
      life: 0.35,
    });
}
function bossAttack(s: CoopState) {
  const b = s.boss;
  const living = Object.values(s.players).filter((p) => p.status === "alive");
  const target = living[b.attack % living.length];
  if (!target) return;
  const pattern = bosses[s.bossIndex].attacks[b.attack++ % 3];
  const angle = Math.atan2(target.y - b.y, target.x - b.x);
  b.cooldown = b.phase >= 2 ? 1.65 : 2.35;
  if (b.attack % 3 === 0) {
    b.opening = 0;
  }
  if (
    b.attack % 2 === 0 &&
    (Math.hypot(target.x - b.x, target.y - b.y) > 380 ||
      (target.stillTime ?? 0) > 3)
  )
    hazard(s, "circle", target.x, target.y, 70, 1.3);
  if (pattern === "rings") {
    hazard(s, "ring", 450, 280, 160, 1.1, 450, 280, 90);
    if (b.phase >= 2) hazard(s, "ring", 450, 280, 270, 1.7, 450, 280, 205);
  } else if (pattern === "fan" || pattern === "orbit") {
    const count = pattern === "orbit" ? 14 : 7 + b.phase * 2;
    for (let i = 0; i < count; i++)
      shoot(
        s,
        b,
        pattern === "orbit"
          ? s.elapsed + (i * Math.PI * 2) / count
          : angle + (i - (count - 1) / 2) * 0.18,
        null,
        12,
        170 + b.phase * 25,
        5,
        7,
      );
    if (pattern === "orbit") hazard(s, "circle", target.x, target.y, 75, 1.3);
  } else if (pattern === "cross" || pattern === "sniper") {
    hazard(s, "line", target.x, 20, 22, 1.15, target.x, 540);
    hazard(s, "line", 20, target.y, 22, 1.65, 880, target.y);
  } else if (pattern === "grid") {
    const safe = 100 + (b.attack % 4) * 180;
    for (let x = 80; x < 900; x += 120)
      if (Math.abs(x - safe) > 65) hazard(s, "line", x, 20, 27, 1.2, x, 540);
  } else if (pattern === "mines") {
    for (let i = 0; i < 4 + b.phase; i++)
      hazard(
        s,
        "circle",
        90 + ((i * 151 + b.attack * 53) % 710),
        90 + ((i * 97 + b.attack * 31) % 390),
        65,
        1.4 + i * 0.1,
      );
  } else if (pattern === "charge") {
    hazard(s, "line", b.x, b.y, 38, 0.9, target.x, target.y);
    for (let i = -1; i <= 1; i++)
      shoot(s, b, angle + i * 0.12, null, 18, 380, 2, 13);
  } else if (pattern === "walls") {
    const safe = 90 + (b.attack % 4) * 110;
    for (let y = 45; y < 560; y += 45)
      if (Math.abs(y - safe) > 75)
        shoot(s, { x: 20, y }, 0, null, 13, 155, 6, 10);
  } else {
    const p = target,
      phase = b.phase;
    if (pattern === "mirror") {
      const reflected = { x: COOP_WIDTH - p.x, y: p.y };
      hazard(
        s,
        "line",
        b.x,
        b.y,
        18 + phase * 2,
        1.1,
        reflected.x,
        reflected.y,
      );
      hazard(s, "line", COOP_WIDTH - b.x, b.y, 18, 1.5, p.x, p.y);
      if (phase >= 2) hazard(s, "circle", reflected.x, reflected.y, 70, 1.8);
    }
    if (pattern === "shatter") {
      for (let i = 0; i < 5 + phase; i++)
        hazard(
          s,
          "circle",
          100 + i * 110,
          100 + (i % 2) * 330,
          53,
          0.9 + i * 0.2,
        );
      hazard(s, "line", 30, 280, 22, 2.1, 870, 280);
    }
    if (pattern === "reflection") {
      hazard(s, "circle", p.x, p.y, 100, 1);
      hazard(s, "circle", COOP_WIDTH - p.x, COOP_HEIGHT - p.y, 100, 1.4);
      if (phase >= 2) hazard(s, "ring", 450, 280, 250, 1.9, 450, 280, 185);
    }
    if (pattern === "furnace") {
      const safeX = p.x < 450 ? 670 : 230;
      for (let x = 60; x < 900; x += 90)
        if (Math.abs(x - safeX) > 85) hazard(s, "line", x, 30, 32, 1.4, x, 530);
      if (phase >= 2) hazard(s, "circle", safeX, p.y, 60, 2.1);
    }
    if (pattern === "flare") {
      hazard(s, "circle", p.x, p.y, 95, 1.25);
      for (let i = 0; i < 3 + phase; i++)
        hazard(
          s,
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
    if (pattern === "solar") {
      hazard(s, "line", 30, 80, 24, 1.15, 870, 480);
      hazard(s, "line", 30, 480, 24, 1.75, 870, 80);
      if (phase >= 2) hazard(s, "line", 450, 30, 32, 2.2, 450, 530);
    }
    if (pattern === "index") {
      const rows = phase >= 2 ? [100, 250, 400] : [140, 380];
      for (const [i, y] of rows.entries())
        hazard(s, "line", 30, y, 24, 1.1 + i * 0.45, 870, y);
    }
    if (pattern === "binding") {
      for (let i = 0; i < 3; i++)
        hazard(
          s,
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
    if (pattern === "erasure") {
      const safeY = p.y < 280 ? 420 : 120;
      for (let y = 55; y < 550; y += 70)
        if (Math.abs(y - safeY) > 65) hazard(s, "line", 30, y, 24, 1.2, 870, y);
      if (phase >= 2) hazard(s, "circle", p.x, safeY, 60, 1.85);
    }
    if (pattern === "eclipse") {
      const safe = phase % 2 === 0 ? 120 : 225;
      hazard(s, "ring", 450, 280, 390, 1.5, 450, 280, safe);
      hazard(s, "circle", 450, 280, safe - 55, 1.5);
    }
    if (pattern === "echo") {
      for (let i = 0; i < phase + 1; i++)
        hazard(
          s,
          "line",
          b.x,
          b.y,
          18,
          1.0 + i * 0.45,
          p.x + (i - phase / 2) * 100,
          p.y,
        );
      hazard(s, "circle", COOP_WIDTH - p.x, COOP_HEIGHT - p.y, 80, 2);
    }
    if (pattern === "verdict") {
      const safeX =
        150 +
        campaignRandom(s.campaign?.seed ?? 1, s.bossIndex, b.attack) * 600;
      for (let x = 50; x < 900; x += 75)
        if (Math.abs(x - safeX) > 90) hazard(s, "line", x, 20, 27, 1.7, x, 540);
      hazard(s, "line", 20, 280, 20, 2.4, 880, 280);
    }
  }
  if (b.attack % 3 === 0) {
    b.recoveryDelay =
      Math.max(
        0,
        ...s.hazards.map((h) => Math.max(0, h.delay) + h.life),
        ...s.shots.filter((shot) => !shot.ownerId).map((shot) => shot.life),
      ) + 0.08;
    b.cooldown = b.recoveryDelay + 1.7;
  }
}
function distanceToSegment(p: Point, h: CoopHazard) {
  const dx = h.x2 - h.x,
    dy = h.y2 - h.y;
  const t = clamp(
    ((p.x - h.x) * dx + (p.y - h.y) * dy) / (dx * dx + dy * dy || 1),
    0,
    1,
  );
  return Math.hypot(p.x - h.x - t * dx, p.y - h.y - t * dy);
}
function step(
  s: CoopState,
  dt: number,
  now: number,
  connectedIds: Set<string>,
) {
  s.elapsed += dt;
  const arena = arenaFor(s.bossIndex);
  for (const [id, p] of Object.entries(s.players)) {
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.alternateCooldown = Math.max(0, p.alternateCooldown - dt);
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.dashTime = Math.max(0, p.dashTime - dt);
    p.invulnerable = Math.max(0, p.invulnerable - dt);
    if (p.status === "downed" && now >= p.downedUntil) p.status = "eliminated";
    const input =
      connectedIds.has(id) && now - p.inputAt <= 400 ? p.input : null;
    if (p.status !== "alive" || !input) continue;
    const length = Math.max(1, Math.hypot(input.dx, input.dy));
    const dx = input.dx / length,
      dy = input.dy / length;
    const carrying =
      s.campaign?.objective?.carrying && s.campaign.objective.carrierId === id;
    if (input.dash && !carrying && !p.dashCooldown && (dx || dy)) {
      p.dashTime = 0.18;
      p.dashCooldown = 1.3;
      p.invulnerable = 0.3;
      p.dashX = dx * 730;
      p.dashY = dy * 730;
    }
    const moveSpeed = hasJourney(s)
      ? carrying
        ? JOURNEY_RULES.movement.carryingSpeed
        : JOURNEY_RULES.movement.normalSpeed
      : 220;
    p.x = clamp(
      p.x + (p.dashTime > 0 ? p.dashX : dx * moveSpeed) * dt,
      20,
      880,
    );
    p.y = clamp(
      p.y + (p.dashTime > 0 ? p.dashY : dy * moveSpeed) * dt,
      20,
      540,
    );
    const slow = arena.terrain.some(
      (t) => t.kind === "slow" && Math.hypot(p.x - t.x, p.y - t.y) < t.radius,
    )
      ? 0.65
      : 1;
    if (slow < 1 && !p.dashTime) {
      const slowedSpeed = hasJourney(s)
        ? carrying
          ? JOURNEY_RULES.movement.slowedCarryingSpeed
          : JOURNEY_RULES.movement.slowedSpeed
        : moveSpeed * slow;
      p.x -= dx * (moveSpeed - slowedSpeed) * dt;
      p.y -= dy * (moveSpeed - slowedSpeed) * dt;
    }
    if (arena.conveyor)
      p.x = clamp(p.x + arena.conveyor * (p.y > 280 ? 1 : -1) * dt, 20, 880);
    keepOutsideCover(p, arena.terrain, 12);
    p.stillTime = dx || dy ? 0 : (p.stillTime ?? 0) + dt;
    for (const t of arena.terrain)
      if (
        t.kind === "heat" &&
        (s.boss.opening ?? 0) <= 0 &&
        s.elapsed % 6 < 2 &&
        Math.hypot(p.x - t.x, p.y - t.y) < t.radius
      )
        hurt(p, 8, now, hasJourney(s));
    const alt = input.alternate && !p.alternateCooldown;
    if ((input.fire && !p.cooldown) || alt) {
      const weapon = weapons[p.weapon];
      p.cooldown =
        weapon.interval / (1 + 0.12 * Math.sqrt(p.upgrades?.tempo ?? 0));
      if (alt) p.alternateCooldown = 3.8;
      const damage =
        weapon.damage *
        (alt ? 1.8 : 1) *
        (p.modifiers?.includes("glass") ? 1.25 : 1) *
        (1 + 0.14 * Math.sqrt(p.upgrades?.power ?? 0));
      const angle = Math.atan2(input.aimY - p.y, input.aimX - p.x);
      if (weapon.speed === 0) {
        const targets = combatTargets(s);
        const reach =
          p.weapon === "prism"
            ? 230
            : p.weapon === "lance"
              ? alt
                ? 225
                : 165
              : alt
                ? 145
                : 110;
        const hit = targets.filter((target) => {
          const distance = Math.hypot(p.x - target.x, p.y - target.y);
          return (
            distance < reach &&
            (p.weapon === "blade" ||
              Math.cos(Math.atan2(target.y - p.y, target.x - p.x) - angle) >
                (p.weapon === "lance" ? 0.92 : 0.82))
          );
        });
        const struck = p.weapon === "prism" ? hit.slice(0, 1) : hit;
        if (p.weapon === "prism" && struck[0])
          struck.push(
            ...targets
              .filter(
                (t) =>
                  t !== struck[0] &&
                  Math.hypot(t.x - struck[0].x, t.y - struck[0].y) <
                    (p.modifiers?.includes("refraction") ? 180 : 120),
              )
              .slice(
                0,
                (alt ? 3 : 2) + (p.modifiers?.includes("refraction") ? 1 : 0),
              ),
          );
        for (const target of struck) {
          const dealt = damageTarget(s, target, damage);
          p.damage += dealt;
        }
        if (p.weapon === "lance" && alt) {
          p.x = clamp(p.x + Math.cos(angle) * 55, 20, 880);
          p.y = clamp(p.y + Math.sin(angle) * 55, 20, 540);
          keepOutsideCover(p, arena.terrain, 12);
        }
      } else {
        const count = p.weapon === "scatter" ? (alt ? 9 : 5) : alt ? 3 : 1;
        for (let i = 0; i < count; i++) {
          shoot(
            s,
            p,
            angle + (i - (count - 1) / 2) * 0.1,
            id,
            damage,
            weapon.speed,
            p.weapon === "scatter" ? 0.9 : 3,
            p.weapon === "comet" ? 9 : 5,
          );
          const shot = s.shots.at(-1);
          if (shot?.ownerId === id) {
            if (p.weapon === "boomerang") {
              shot.returnTime = 0.5;
              shot.hitTargets = [];
            }
            if (p.weapon === "comet") shot.explosive = true;
          }
        }
      }
    }
  }
  for (const target of Object.values(s.players).filter(
    (p) => p.status === "downed",
  )) {
    const reviver = Object.entries(s.players).some(
      ([id, p]) =>
        p.status === "alive" &&
        connectedIds.has(id) &&
        now - p.inputAt <= 400 &&
        p.input?.revive &&
        Math.hypot(p.x - target.x, p.y - target.y) < 70,
    );
    target.reviveProgress = reviver ? target.reviveProgress + dt : 0;
    if (target.reviveProgress >= 2) {
      target.status = "alive";
      target.hp = 45;
      target.revives++;
      target.reviveProgress = 0;
      target.invulnerable = 2;
    }
  }
  if (!Object.values(s.players).some((p) => p.status === "alive")) {
    finish(s, false, "The whole team was downed");
    return;
  }
  if (s.campaign) tickCampaignEnemies(s, dt, now);
  const bossActive = !s.campaign || s.campaign.room.kind === "boss";
  const b = s.boss;
  if (bossActive && !hasJourney(s) && b.hp <= b.maxHp / 2 && b.phase === 1) {
    b.phase = 2;
    b.cooldown = Math.min(b.cooldown, 1.2);
    b.recoveryDelay = 0;
    b.opening = 0;
    hazard(s, "ring", b.x, b.y, 150, 1.1, b.x, b.y, 85);
  }
  if (bossActive && !hasJourney(s) && b.phase === 2 && b.hp <= b.maxHp * 0.22) {
    b.phase = 3;
    b.cooldown = 1.4;
    b.recoveryDelay = 0;
    b.opening = 0;
    hazard(s, "ring", b.x, b.y, 220, 1.2, b.x, b.y, 150);
  }
  if (bossActive) {
    const targetX = 450 + Math.sin(s.elapsed * 0.65 + s.bossIndex) * 150;
    const targetY = 155 + Math.cos(s.elapsed * 0.55) * 50;
    if ((b.opening ?? 0) > 0) {
      b.x += (targetX - b.x) * dt * 0.15;
      b.y += (targetY - b.y) * dt * 0.15;
    } else {
      b.x = targetX;
      b.y = targetY;
    }
    b.cooldown -=
      dt *
      (hasJourney(s) &&
      s.campaign!.journey!.stage <= s.campaign!.journey!.stages
        ? JOURNEY_RULES.pressure.shieldedBossCadence
        : 1);
    b.opening = Math.max(0, (b.opening ?? 0) - dt);
    if ((b.recoveryDelay ?? 0) > 0) {
      b.recoveryDelay = Math.max(0, b.recoveryDelay! - dt);
      if (b.recoveryDelay === 0) b.opening = 1.5;
    }
    keepOutsideCover(b, arena.terrain, 28);
    if (b.cooldown <= 0) bossAttack(s);
    for (const p of Object.values(s.players))
      if ((b.opening ?? 0) <= 0 && Math.hypot(p.x - b.x, p.y - b.y) < 42)
        hurt(p, 16, now, hasJourney(s));
  }
  for (const shot of s.shots) {
    if (shot.returnTime !== undefined && shot.ownerId) {
      const owner = s.players[shot.ownerId];
      const before = shot.returnTime;
      shot.returnTime -= dt;
      if (shot.returnTime <= 0) {
        if (!owner || owner.status !== "alive") {
          shot.life = 0;
          continue;
        }
        const angle = Math.atan2(owner.y - shot.y, owner.x - shot.x);
        shot.vx = Math.cos(angle) * 420;
        shot.vy = Math.sin(angle) * 420;
        if (before > 0) shot.hitTargets = [];
        if (
          shot.returnTime < -0.06 &&
          Math.hypot(shot.x - owner.x, shot.y - owner.y) < 18
        ) {
          shot.life = 0;
          continue;
        }
      }
    }
    const old = { x: shot.x, y: shot.y };
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    shot.life -= dt;
    // Segment collision prevents fast bullets from skipping targets between ticks.
    const segment = { ...old, x2: shot.x, y2: shot.y } as CoopHazard;
    if (
      arena.terrain.some(
        (t) =>
          t.kind === "cover" &&
          distanceToSegment(t, segment) < t.radius + shot.radius,
      )
    ) {
      shot.life = 0;
      continue;
    }
    if (shot.ownerId) {
      for (const target of combatTargets(s))
        if (
          distanceToSegment(target, segment) <
            shot.radius + ("radius" in target ? target.radius : 28) &&
          target.hp > 0 &&
          !(shot.hitTargets ?? []).includes(
            "id" in target ? String(target.id) : "boss",
          )
        ) {
          const dealt = damageTarget(
            s,
            target,
            shot.damage * (target === b && (b.opening ?? 0) > 0 ? 1.3 : 1),
          );
          s.players[shot.ownerId].damage += dealt;
          if (shot.returnTime !== undefined)
            shot.hitTargets = [
              ...(shot.hitTargets ?? []),
              "id" in target ? String(target.id) : "boss",
            ];
          else shot.life = 0;
          if (shot.explosive)
            for (const other of combatTargets(s))
              if (
                other !== target &&
                Math.hypot(other.x - shot.x, other.y - shot.y) < 65
              ) {
                const splash = damageTarget(s, other, shot.damage * 0.4);
                s.players[shot.ownerId].damage += splash;
              }
          break;
        }
    } else {
      const companion = Object.values(s.players).find(
        (p) =>
          p.status === "alive" &&
          (p.helperHp ?? 0) > 0 &&
          distanceToSegment({ x: p.x + 24, y: p.y - 20 }, segment) <
            shot.radius + 10,
      );
      if (companion) {
        companion.helperHp = Math.max(0, companion.helperHp! - shot.damage);
        shot.life = 0;
        continue;
      }
      for (const p of Object.values(s.players))
        if (
          p.status === "alive" &&
          distanceToSegment(p, segment) < shot.radius + 12
        ) {
          hurt(p, shot.damage, now, hasJourney(s));
          shot.life = 0;
          break;
        }
    }
  }
  s.shots = s.shots.filter(
    (shot) =>
      shot.life > 0 &&
      shot.x > -20 &&
      shot.x < 920 &&
      shot.y > -20 &&
      shot.y < 580,
  );
  for (const h of s.hazards) {
    h.delay -= dt;
    if (h.delay <= 0) {
      h.life -= dt;
      for (const p of Object.values(s.players)) {
        const dist = Math.hypot(p.x - h.x, p.y - h.y);
        const hit =
          h.kind === "line"
            ? distanceToSegment(p, h) < h.radius
            : h.kind === "ring"
              ? dist < h.radius && dist > h.innerRadius
              : dist < h.radius;
        if (hit) hurt(p, 20, now, hasJourney(s));
      }
    }
  }
  s.hazards = s.hazards.filter((h) => h.life > 0);
  if (s.campaign) {
    s.campaign.enemies = s.campaign.enemies.filter((e) => e.hp > 0);
    if (hasJourney(s)) {
      tickJourneyObjective(s, now, connectedIds);
      const journey = s.campaign.journey!;
      const clear = bossActive
        ? journey.bossPhase === JOURNEY_PHASE_COUNT &&
          journey.stage > journey.stages &&
          b.hp <= 0
        : journey.stage > journey.stages;
      if (clear) clearCampaignRoom(s, now);
      return;
    }
    const clear = bossActive
      ? b.hp <= 0
      : s.campaign.room.kind === "environment"
        ? s.campaign.roomElapsed >= 28
        : s.campaign.enemies.length === 0;
    if (clear) clearCampaignRoom(s, now);
    return;
  }
  if (b.hp <= 0) {
    s.shots = [];
    s.hazards = [];
    if (s.bossIndex === 3) finish(s, true, "Four signals restored together");
    else {
      s.stage = "intermission";
      s.intermissionUntil = now + 12_000;
      s.continued = [];
      for (const p of Object.values(s.players))
        if (p.status === "alive") p.hp = Math.min(100, p.hp + 25);
    }
  }
}
export function tickCoop(s: CoopState, now: number, connectedIds: string[]) {
  if (s.result || now <= s.lastTick) return false;
  if (s.campaign && !connectedIds.length) {
    // A durable checkpoint waits for players. Offline time cannot resolve fights or choices.
    const delta = now - s.lastTick;
    s.startedAt += delta;
    s.intermissionUntil += delta;
    s.campaign.choiceUntil += delta;
    if (s.campaign.sharedEvent) s.campaign.sharedEvent.until += delta;
    for (const player of Object.values(s.players))
      if (player.downedUntil) player.downedUntil += delta;
    s.lastTick = now;
    return true;
  }
  let elapsed = Math.min(500, now - s.lastTick);
  s.lastTick = now;
  if (s.campaign && s.stage === "choice") {
    const present = connectedIds.filter((id) => s.players[id]);
    if (
      now >= s.campaign.choiceUntil ||
      present.every((id) => s.campaign!.votes[id] !== undefined)
    ) {
      const counts = [0, 0, 0];
      for (const id of present) {
        const vote = s.campaign.votes[id];
        if (vote !== undefined) counts[vote]++;
      }
      const highest = Math.max(...counts);
      const tied = counts.flatMap((n, i) => (n === highest ? [i] : []));
      const chosen =
        tied[
          Math.floor(
            campaignRandom(s.campaign.seed, s.campaign.room.index, 99) *
              tied.length,
          )
        ];
      s.campaign.room = campaignRoom(
        s.campaign.seed,
        s.campaign.room.index,
        s.campaign.room.options![chosen],
      );
      enterCampaignRoom(s, now);
    }
    return true;
  }
  if (
    s.campaign &&
    s.stage === "camp" &&
    s.campaign.sharedEvent &&
    !s.campaign.sharedEvent.resolved
  ) {
    const event = s.campaign.sharedEvent;
    const voters = connectedIds.filter(
      (id) =>
        s.players[id]?.status !== "eliminated" && !s.players[id]?.departed,
    );
    if (
      now >= event.until ||
      (voters.length > 0 && voters.every((id) => event.votes[id] !== undefined))
    ) {
      const tally = [0, 0];
      for (const id of voters) {
        const vote = event.votes[id];
        if (vote !== undefined) tally[vote]++;
      }
      const risk =
        tally[1] > tally[0] ||
        (tally[1] === tally[0] &&
          campaignRandom(s.campaign.seed, s.campaign.room.index, 131) >= 0.5);
      resolveSharedEvent(s, risk);
    } else return true;
  }
  if (s.campaign && (s.stage === "intermission" || s.stage === "camp")) {
    const present = connectedIds.filter((id) => s.players[id]);
    if (
      now < s.intermissionUntil &&
      !present.every((id) => s.continued.includes(id))
    )
      return true;
    const next = s.campaign.room.index + 1;
    s.campaign.room = campaignRoom(
      s.campaign.seed,
      next,
      next % 5 === 2 &&
        (s.campaign.signalKey || (s.campaign.refusals ?? 0) >= 3)
        ? "secret"
        : undefined,
    );
    enterCampaignRoom(s, now);
    return true;
  }
  if (s.stage === "intermission") {
    if (
      now < s.intermissionUntil &&
      s.continued.length < Object.keys(s.players).length
    )
      return true;
    s.bossIndex++;
    s.boss = newBoss(s.bossIndex, Object.keys(s.players).length);
    s.stage = "fight";
    for (const [i, p] of Object.values(s.players).entries()) {
      p.x = 395 + i * 38;
      p.y = 440;
      p.invulnerable = 1;
      p.input = null;
      // A missed rescue remains meaningful for the rest of this gauntlet.
      if (p.status === "downed") p.status = "eliminated";
    }
  }
  const connected = new Set(connectedIds);
  while (elapsed > 0 && s.stage === "fight") {
    const ms = Math.min(40, elapsed);
    step(s, ms / 1000, now - elapsed + ms, connected);
    elapsed -= ms;
  }
  if (!s.result && now - s.startedAt >= (s.campaign ? 120 : 15) * 60 * 1000)
    finish(s, false, "Expedition time limit reached");
  return true;
}

export function coopView(s: CoopState, viewerId: string) {
  assert(s.players[viewerId], "Join this co-op room first");
  return {
    kind: s.kind,
    stage: s.stage,
    arena: arenaFor(s.bossIndex),
    mode: s.mode ?? "gauntlet",
    campaign: s.campaign
      ? {
          room: s.campaign.room,
          totalRooms: COOP_CAMPAIGN_ROOMS,
          enemies: s.campaign.enemies.map(
            ({ id, kind, x, y, hp, maxHp, radius }) => ({
              id,
              kind,
              x,
              y,
              hp,
              maxHp,
              radius,
            }),
          ),
          voted: Object.keys(s.campaign.votes),
          yourVote: s.campaign.votes[viewerId],
          choiceUntil: s.campaign.choiceUntil,
          clearedRooms: s.campaign.clearedRooms,
          checkpointRoom: s.campaign.checkpointRoom,
          pacingVersion: s.campaign.pacingVersion,
          journey: s.campaign.journey ? { ...s.campaign.journey } : undefined,
          objective: s.campaign.objective
            ? {
                kind: s.campaign.objective.kind,
                x: s.campaign.objective.x,
                y: s.campaign.objective.y,
                progress: s.campaign.objective.progress,
                target: s.campaign.objective.target,
                carrying: !!s.campaign.objective.carrying,
                carrierId: s.campaign.objective.carrierId,
                dropped: !!s.campaign.objective.dropped,
              }
            : undefined,
          rewards: coopRewards,
          signalKey: !!s.campaign.signalKey,
          refusals: s.campaign.refusals ?? 0,
          secrets: s.campaign.secrets ?? [],
          event: s.campaign.sharedEvent
            ? {
                resolved: s.campaign.sharedEvent.resolved,
                until: s.campaign.sharedEvent.until,
                votedCount: Object.keys(s.campaign.sharedEvent.votes).length,
                yourVote: s.campaign.sharedEvent.votes[viewerId],
                outcome: s.campaign.sharedEvent.outcome,
              }
            : undefined,
        }
      : undefined,
    bossIndex: s.bossIndex,
    boss: {
      x: s.boss.x,
      y: s.boss.y,
      hp: s.boss.hp,
      maxHp: s.boss.maxHp,
      phase: s.boss.phase,
      name: bosses[s.bossIndex].name,
      dialogue: bosses[s.bossIndex].dialogue,
      opening: (s.boss.opening ?? 0) > 0,
      color: bosses[s.bossIndex].color,
    },
    players: Object.entries(s.players).map(([id, p]) => ({
      id,
      x: p.x,
      y: p.y,
      hp: p.hp,
      maxHp: p.maxHp ?? 100,
      helper: (p.upgrades?.helper ?? 0) > 0 && (p.helperHp ?? 1) > 0,
      helperKind: p.helperKind ?? "gunner",
      helperHp:
        p.helperHp ??
        ((p.upgrades?.helper ?? 0) > 0 ? 40 + 10 * p.upgrades!.helper! : 0),
      deaths: p.deaths ?? 0,
      status: p.status,
      weapon: p.weapon,
      damage: Math.round(p.damage),
      revives: p.revives,
      reviveProgress: p.reviveProgress,
      dashCooldown: p.dashCooldown,
      alternateCooldown: p.alternateCooldown,
    })),
    shots: s.shots.map((shot) => ({
      id: shot.id,
      x: shot.x,
      y: shot.y,
      radius: shot.radius,
      enemy: !shot.ownerId,
    })),
    hazards: s.hazards.map((h) => ({
      id: h.id,
      kind: h.kind,
      x: h.x,
      y: h.y,
      x2: h.x2,
      y2: h.y2,
      radius: h.radius,
      innerRadius: h.innerRadius,
      delay: h.delay,
    })),
    yourSequence: s.players[viewerId].sequence,
    self: {
      credits: s.players[viewerId].credits ?? 0,
      upgrades: s.players[viewerId].upgrades ?? {},
      rewardClaimedRoom: s.players[viewerId].rewardClaimedRoom ?? -1,
      helperChosenRoom: s.players[viewerId].helperChosenRoom ?? -1,
      modifiers: s.players[viewerId].modifiers ?? [],
    },
    elapsed: s.elapsed,
    intermissionUntil: s.intermissionUntil,
    continued: s.continued,
    result: s.result,
  };
}
export type CoopView = ReturnType<typeof coopView>;

function combatTargets(s: CoopState): (CoopState["boss"] | CoopEnemy)[] {
  if (hasJourney(s)) {
    const enemies = s.campaign!.enemies.filter((e) => e.hp > 0);
    const journey = s.campaign!.journey!;
    return s.campaign!.room.kind === "boss" &&
      journey.stage > journey.stages &&
      s.boss.hp > 0
      ? [...enemies, s.boss]
      : enemies;
  }
  return s.campaign && s.campaign.room.kind !== "boss"
    ? s.campaign.enemies.filter((e) => e.hp > 0)
    : s.boss.hp > 0
      ? [s.boss]
      : [];
}
function hasJourney(s: CoopState) {
  return (
    s.campaign?.pacingVersion === JOURNEY_PACING_VERSION && !!s.campaign.journey
  );
}
/** Every damage path respects the same phase gate, including explosive splash. */
function damageTarget(
  s: CoopState,
  target: CoopState["boss"] | CoopEnemy,
  amount: number,
) {
  let floor = 0;
  if (target === s.boss && hasJourney(s)) {
    const journey = s.campaign!.journey!;
    if (journey.stage <= journey.stages) return 0;
    floor = s.boss.maxHp * (1 - journey.bossPhase / JOURNEY_PHASE_COUNT);
  }
  const dealt = Math.max(0, Math.min(amount, target.hp - floor));
  target.hp -= dealt;
  return dealt;
}
function journeyDefinition(s: CoopState) {
  const c = s.campaign!,
    journey = c.journey!;
  return journeyStageDefinition(
    c.room.kind,
    c.room.district,
    journey.stage - 1,
    journey.bossPhase,
  );
}
function journeyEnemyRole(kind: JourneyEnemyKind): CoopEnemy["kind"] {
  return JOURNEY_RULES.cooperativeRoles[kind];
}
function startJourneyStage(s: CoopState) {
  const c = s.campaign!,
    journey = c.journey!;
  delete c.objective;
  c.enemies = [];
  s.shots = [];
  s.hazards = [];
  c.environmentCooldown = 2.5;
  const definition = journeyDefinition(s);
  for (const [i, role] of definition.squad.entries()) {
    const kind = journeyEnemyRole(role);
    // Keep ordinary enemy durability; progression comes from distinct missions.
    const hp = Math.round(
      (kind === "brute" ? 90 : 36) *
        (1 + c.room.district * 0.13) *
        (0.7 +
          Object.values(s.players).filter((p) => !p.departed).length * 0.3),
    );
    const salt = journey.stage * 97 + journey.bossPhase * 431;
    const enemy: CoopEnemy = {
      id: s.nextId++,
      kind,
      x: 90 + campaignRandom(c.seed, c.room.index, i + salt) * 720,
      y: 65 + campaignRandom(c.seed, c.room.index, i + salt + 30) * 160,
      hp,
      maxHp: hp,
      cooldown: 1.2 + i * 0.2,
      radius: kind === "brute" ? 22 : 15,
    };
    keepOutsideCover(enemy, arenaFor(s.bossIndex).terrain, enemy.radius);
    c.enemies.push(enemy);
  }
}
function tickJourneyObjective(
  s: CoopState,
  now: number,
  connected: Set<string>,
) {
  const c = s.campaign!,
    journey = c.journey!;
  if (journey.stage > journey.stages) {
    if (
      c.room.kind === "boss" &&
      journey.bossPhase < JOURNEY_PHASE_COUNT &&
      s.boss.hp <=
        s.boss.maxHp * (1 - journey.bossPhase / JOURNEY_PHASE_COUNT) + 1e-8
    ) {
      journey.bossPhase++;
      journey.stage = 1;
      s.boss.phase = journey.bossPhase;
      s.boss.opening = 0;
      s.boss.recoveryDelay = 0;
      s.boss.cooldown = 1.4;
      startJourneyStage(s);
    }
    return;
  }
  if (c.enemies.length && !c.objective) return;
  const definition = journeyDefinition(s);
  const presentOwner = (id: string) => {
    const player = s.players[id];
    return player?.status === "alive" && !player.departed && connected.has(id);
  };
  const fresh = (id: string) => {
    const player = s.players[id];
    return (
      player?.status === "alive" &&
      !player.departed &&
      connected.has(id) &&
      !!player.input &&
      now - player.inputAt <= 400
    );
  };
  const objective = (c.objective ??= {
    kind: definition.kind === "courier" ? "parcel" : definition.kind,
    ...definition.checkpoints[0],
    hp: 1,
    maxHp: 1,
    progress: 0,
    target: definition.checkpoints.length,
    spawned: 0,
    carrying: false,
  });
  const ownerId = objective.guideId ?? objective.carrierId;
  if (ownerId && !presentOwner(ownerId)) {
    const carrier = s.players[ownerId];
    objective.x = carrier.x;
    objective.y = carrier.y;
    keepOutsideCover(objective, arenaFor(s.bossIndex).terrain, 25);
    objective.carrying = false;
    objective.dropped = true;
    delete objective.carrierId;
    delete objective.guideId;
  }
  if (c.enemies.length) return;
  const actor = Object.entries(s.players).find(
    ([id, player]) =>
      fresh(id) &&
      (!objective.carrierId || objective.carrierId === id) &&
      (!objective.guideId || objective.guideId === id) &&
      Math.hypot(player.x - objective.x, player.y - objective.y) <=
        JOURNEY_RULES.movement.checkpointRadius,
  );
  if (!actor) return;
  const [id] = actor;
  if (objective.dropped) {
    objective.dropped = false;
    if (objective.kind === "ward") objective.guideId = id;
    else {
      objective.carrying = true;
      objective.carrierId = id;
    }
    s.players[id].dashTime = 0;
    Object.assign(objective, definition.checkpoints[objective.progress]);
    return;
  }
  if (objective.kind === "ward") objective.guideId ??= id;
  else if (objective.kind === "escort" || objective.progress % 2 === 0) {
    objective.carrying = true;
    objective.carrierId = id;
    s.players[id].dashTime = 0;
  } else {
    objective.carrying = false;
    delete objective.carrierId;
  }
  objective.progress++;
  if (
    objective.kind === "escort" &&
    objective.progress === 2 &&
    !objective.ambushed
  ) {
    objective.ambushed = true;
    const actor = s.players[id];
    for (const [
      i,
      role,
    ] of JOURNEY_RULES.pressure.escortAmbushRoles.entries()) {
      const kind = journeyEnemyRole(role);
      const hp = Math.round(
        (JOURNEY_RULES.pressure.escortAmbushHealth +
          c.room.district *
            JOURNEY_RULES.pressure.escortAmbushHealthPerDistrict) *
          (0.7 +
            Object.values(s.players).filter((p) => !p.departed).length * 0.3),
      );
      const enemy: CoopEnemy = {
        id: s.nextId++,
        kind,
        x: actor.x < 450 ? 780 - i * 32 : 120 + i * 32,
        y: actor.y < 280 ? 470 : 90,
        hp,
        maxHp: hp,
        cooldown: 1.8 + i * 0.2,
        radius: 15,
      };
      keepOutsideCover(enemy, arenaFor(s.bossIndex).terrain, enemy.radius);
      c.enemies.push(enemy);
    }
  }
  if (objective.progress < objective.target) {
    Object.assign(objective, definition.checkpoints[objective.progress]);
    return;
  }
  journey.completedStages++;
  journey.stage++;
  delete c.objective;
  // A completed delivery earns a modest resupply, rather than healing for idle time.
  for (const player of Object.values(s.players))
    if (player.status === "alive" && !player.departed)
      player.hp = Math.min(
        player.maxHp ?? 100,
        player.hp + JOURNEY_RULES.sustain.stageHealing,
      );
  if (journey.stage <= journey.stages) startJourneyStage(s);
  else {
    s.shots = [];
    s.hazards = [];
    s.boss.cooldown = 1.2;
  }
}
function enterCampaignRoom(s: CoopState, now: number) {
  const c = s.campaign!;
  const room = c.room;
  s.shots = [];
  s.hazards = [];
  s.continued = [];
  c.votes = {};
  c.roomElapsed = 0;
  c.environmentCooldown = 3;
  c.enemies = [];
  delete c.objective;
  delete c.journey;
  delete c.sharedEvent;
  s.bossIndex = Math.min(room.bossIndex, bosses.length - 1);
  s.boss = newBoss(s.bossIndex, Object.keys(s.players).length);
  for (const [i, p] of Object.values(s.players).entries()) {
    p.x = 350 + i * 55;
    p.y = 450;
    p.input = null;
    p.invulnerable = 1.5;
  }
  if (room.kind === "choice") {
    s.stage = "choice";
    c.choiceUntil = now + 30_000;
    return;
  }
  if (
    ["shop", "helper", "shrine", "treasure", "npc", "curse", "secret"].includes(
      room.kind,
    ) &&
    !(c.pacingVersion === JOURNEY_PACING_VERSION && room.index % 5 === 1)
  ) {
    s.stage = "camp";
    s.intermissionUntil = now + 60_000;
    if (["npc", "curse", "secret"].includes(room.kind))
      c.sharedEvent = {
        resolved: false,
        until: now + 30_000,
        votes: {},
        outcome: "",
      };
    for (const p of Object.values(s.players)) {
      if (p.departed) continue;
      p.credits = Math.max(
        p.credits ?? 0,
        Math.min(250, (p.credits ?? 0) + room.reward),
      );
      if (room.kind === "helper") {
        p.upgrades ??= {};
        p.upgrades.helper = Math.min(4, (p.upgrades.helper ?? 0) + 1);
        p.helperKind ??= "gunner";
        p.helperHp = 40 + 10 * p.upgrades.helper;
      }
      if (room.kind === "shrine" && p.status === "alive")
        p.hp = Math.min(p.maxHp ?? 100, p.hp + 35);
    }
    c.clearedRooms = room.index + 1;
    return;
  }
  s.stage = "fight";
  if (c.pacingVersion === JOURNEY_PACING_VERSION) {
    c.journey = {
      stage: 1,
      stages: journeyStageCount(room.kind, room.district),
      bossPhase: 1,
      completedStages: 0,
    };
    startJourneyStage(s);
    return;
  }
  if (room.kind === "boss" || room.kind === "environment") return;
  const count = Math.min(
    24,
    3 +
      Math.floor(room.district / 2) +
      Object.keys(s.players).length +
      (room.kind === "challenge" ? 3 : 0),
  );
  for (let i = 0; i < count; i++) {
    const kind = (["chaser", "shooter", "brute", "splitter"] as const)[
      Math.floor(campaignRandom(c.seed, room.index, i) * 4)
    ];
    const elite = room.kind === "elite" ? 1.8 : 1;
    const hp = Math.round(
      (kind === "brute" ? 90 : 36) *
        (1 + room.district * 0.13) *
        (0.7 + Object.keys(s.players).length * 0.3) *
        elite,
    );
    c.enemies.push({
      id: s.nextId++,
      kind,
      x: 90 + campaignRandom(c.seed, room.index, i + 30) * 720,
      y: 65 + campaignRandom(c.seed, room.index, i + 60) * 160,
      hp,
      maxHp: hp,
      cooldown: 1.2 + i * 0.2,
      radius: kind === "brute" ? 22 : 15,
    });
  }
}
function clearCampaignRoom(s: CoopState, now: number) {
  const c = s.campaign!;
  c.clearedRooms = c.room.index + 1;
  s.shots = [];
  s.hazards = [];
  s.continued = [];
  for (const p of Object.values(s.players)) {
    if (p.departed) continue;
    p.credits = Math.max(
      p.credits ?? 0,
      Math.min(250, (p.credits ?? 0) + c.room.reward),
    );
    if (p.status === "alive")
      p.hp = Math.min(
        p.maxHp ?? 100,
        p.hp + 12 + (p.modifiers?.includes("mercy") ? 8 : 0),
      );
  }
  if (c.room.kind === "boss") {
    c.checkpointRoom = c.room.index + 1;
    for (const p of Object.values(s.players)) {
      if (p.status !== "alive" && !p.departed) {
        p.status = "alive";
        p.hp = Math.round((p.maxHp ?? 100) * 0.6);
        p.credits = Math.floor((p.credits ?? 0) / 2);
      }
      p.revives = 0;
      p.reviveProgress = 0;
      p.invulnerable = 2;
    }
  }
  if (c.clearedRooms >= COOP_CAMPAIGN_ROOMS) {
    finish(s, true, "All eight districts restored together");
    return;
  }
  s.stage = "intermission";
  s.intermissionUntil = now + 45_000;
}
function tickCampaignEnemies(s: CoopState, dt: number, now: number) {
  const c = s.campaign!;
  c.roomElapsed += dt;
  const living = Object.entries(s.players).filter(
    ([, p]) => p.status === "alive",
  );
  for (const enemy of c.enemies) {
    if (enemy.hp <= 0) continue;
    const target = [...living].sort(
      ([, a], [, b]) =>
        Math.hypot(a.x - enemy.x, a.y - enemy.y) -
        Math.hypot(b.x - enemy.x, b.y - enemy.y),
    )[0]?.[1];
    if (!target) continue;
    const dx = target.x - enemy.x,
      dy = target.y - enemy.y,
      dist = Math.max(1, Math.hypot(dx, dy));
    const speed =
      enemy.kind === "brute" ? 55 : enemy.kind === "shooter" ? 45 : 85;
    if (dist > (enemy.kind === "shooter" ? 220 : 18)) {
      enemy.x = clamp(enemy.x + (dx / dist) * speed * dt, 20, 880);
      enemy.y = clamp(enemy.y + (dy / dist) * speed * dt, 20, 540);
    }
    enemy.cooldown -= dt;
    if (enemy.kind === "shooter" && enemy.cooldown <= 0) {
      shoot(s, enemy, Math.atan2(dy, dx), null, 12, 200, 4, 6);
      enemy.cooldown = 1.8;
    }
    if (enemy.kind === "brute" && enemy.cooldown <= 0) {
      hazard(s, "circle", target.x, target.y, 70, 1.2);
      enemy.cooldown = 3.5;
    }
    if (enemy.kind === "splitter" && enemy.cooldown <= 0) {
      for (let i = -1; i <= 1; i++)
        shoot(s, enemy, Math.atan2(dy, dx) + i * 0.25, null, 9, 180, 3, 5);
      enemy.cooldown = 2.6;
    }
    for (const p of Object.values(s.players))
      if (Math.hypot(p.x - enemy.x, p.y - enemy.y) < enemy.radius + 12)
        hurt(p, enemy.kind === "brute" ? 20 : 12, now, hasJourney(s));
  }
  if (hasJourney(s) && c.objective) {
    c.environmentCooldown -= dt;
    if (c.environmentCooldown <= 0) {
      const objective = c.objective;
      const salt = objective.spawned++;
      const x = 120 + campaignRandom(c.seed, c.room.index, salt + 700) * 660;
      // Crossing beams are telegraphed away from the current pickup/delivery.
      if (Math.abs(x - objective.x) > 80)
        hazard(
          s,
          "line",
          x,
          30,
          JOURNEY_RULES.pressure.crossingWarningRadius,
          JOURNEY_RULES.pressure.crossingWarningDelay,
          x,
          530,
        );
      c.environmentCooldown = JOURNEY_RULES.pressure.crossingWarningInterval;
    }
  } else if (c.room.kind === "environment" || c.room.kind === "challenge") {
    c.environmentCooldown -= dt;
    if (c.environmentCooldown <= 0) {
      const salt = Math.floor(c.roomElapsed);
      const x = 70 + campaignRandom(c.seed, c.room.index, salt) * 760;
      hazard(s, "line", x, 20, 25, 1.4, x, 540);
      if (c.room.kind === "environment") hazard(s, "circle", 450, 280, 95, 1.6);
      c.environmentCooldown = 2.5;
    }
  }
  for (const [id, p] of living) {
    p.helperCooldown = Math.max(0, (p.helperCooldown ?? 0) - dt);
    if (
      (p.upgrades?.helper ?? 0) > 0 &&
      (p.helperHp ?? 1) > 0 &&
      !p.helperCooldown
    ) {
      if (p.helperKind === "medic") {
        p.hp = Math.min(p.maxHp ?? 100, p.hp + 4);
        p.helperCooldown = 5;
        continue;
      }
      const target = combatTargets(s)[0];
      if (target)
        shoot(
          s,
          { x: p.x + 24, y: p.y - 20 },
          Math.atan2(target.y - p.y, target.x - p.x),
          id,
          5 + 2 * Math.sqrt(p.upgrades!.helper!),
          420,
          3,
          4,
        );
      p.helperCooldown = 0.75;
    }
  }
}
/** Major event ownership is shared and voted. Mechanical rewards belong to each retained participant once. */
function resolveSharedEvent(s: CoopState, risk: boolean) {
  const c = s.campaign!,
    event = c.sharedEvent!;
  if (event.resolved) return;
  event.resolved = true;
  const players = Object.values(s.players).filter((p) => !p.departed);
  if (c.room.kind === "npc") {
    if (risk) {
      c.signalKey = true;
      event.outcome =
        "The party carries one signal key. The next district event stop opens the relay.";
    } else {
      c.refusals = (c.refusals ?? 0) + 1;
      for (const p of players)
        if (p.status === "alive") p.hp = Math.min(p.maxHp ?? 100, p.hp + 15);
      event.outcome =
        "The party refuses the bargain and each standing teammate recovers 15 health.";
    }
  } else if (c.room.kind === "curse") {
    if (risk) {
      for (const p of players) {
        p.modifiers = [...new Set([...(p.modifiers ?? []), "glass" as const])];
        p.credits = Math.max(
          p.credits ?? 0,
          Math.min(250, (p.credits ?? 0) + 25),
        );
      }
      event.outcome =
        "Shared Glass confidence: 25% more damage dealt and 20% more incoming damage for this expedition.";
    } else {
      c.refusals = (c.refusals ?? 0) + 1;
      for (const p of players)
        if (p.status === "alive") p.hp = Math.min(p.maxHp ?? 100, p.hp + 15);
      event.outcome =
        "The party declines the curse. Another refusal marks the pilgrim trail.";
    }
  } else if (c.room.kind === "secret") {
    if (risk && c.signalKey) {
      c.signalKey = false;
      c.secrets = [...new Set([...(c.secrets ?? []), "restored-relay"])];
      for (const p of players) {
        p.weapon = "prism";
        p.modifiers = [
          ...new Set([...(p.modifiers ?? []), "refraction" as const]),
        ];
      }
      event.outcome =
        "The shared key restores Prism argument and Prismatic memory for every retained teammate.";
    } else if (risk && (c.refusals ?? 0) >= 3) {
      c.refusals = 0;
      c.secrets = [...new Set([...(c.secrets ?? []), "pilgrims-refuge"])];
      for (const p of players) {
        p.modifiers = [...new Set([...(p.modifiers ?? []), "mercy" as const])];
        if (p.status === "alive") p.hp = Math.min(p.maxHp ?? 100, p.hp + 30);
      }
      event.outcome =
        "Three shared refusals open Held breath and a 30-health recovery.";
    } else
      event.outcome =
        "The party leaves the secret intact. Its carried key or refusal trail remains available.";
  }
}
/** A campaign teammate can leave without deleting the surviving team's canonical run. */
export function departCoop(s: CoopState, userId: string) {
  const p = s.players[userId];
  if (!p) return;
  p.status = "eliminated";
  p.departed = true;
  p.input = null;
  p.hp = 0;
  if (s.campaign) {
    delete s.campaign.votes[userId];
    if (s.campaign.sharedEvent) delete s.campaign.sharedEvent.votes[userId];
    s.continued = s.continued.filter((id) => id !== userId);
  }
}
