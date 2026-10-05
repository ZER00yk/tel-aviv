import { bosses, weapons, CLASSIC_BOSS_COUNT, type WeaponId } from "./content";
import type { World } from "./engine";
import { healPlayer, grantEgo } from "./telemetry";

export type RoomKind =
  | "battle"
  | "elite"
  | "miniboss"
  | "boss"
  | "shop"
  | "shrine"
  | "helper"
  | "treasure"
  | "trade"
  | "weapon"
  | "challenge"
  | "secret"
  | "environment"
  | "survival"
  | "npc"
  | "curse"
  | "rare"
  | "protect"
  | "trial";
export type CampaignMode = "normal" | "seeded" | "daily" | "endless";
export type Difficulty = "standard" | "volatile";
export interface Route {
  id: string;
  kind: RoomKind;
  name: string;
  description: string;
}
export interface CampaignState {
  version: 1;
  /** Absent in legacy checkpoints: their original twenty-room itinerary stays intact. */
  length?: number;
  contentVersion?: 2;
  /** Missing in existing twenty/forty-room saves: their compact encounters stay unchanged. */
  pacingVersion?: 1;
  journey?: { stage: number; stages: number; bossPhase: number; completedStages: number };
  wave?: number;
  totalWaves?: number;
  roomStartedAt?: number;
  roomDamage?: number;
  objective?: {
    kind: "relay" | "beacons" | "parcel" | "ward" | "escort";
    carrying?: boolean;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    progress: number;
    target: number;
    spawned: number;
  };
  refusals?: number;
  signalKey?: boolean;
  secrets?: string[];
  initialSeed: number;
  mode: CampaignMode;
  difficulty: Difficulty;
  roomIndex: number;
  room: Route;
  routes: Route[];
  cleared: number;
  enemyKills: number;
  path: string[];
  secretUnlocked: boolean;
  rewardMultiplier: number;
  eventResolved: boolean;
  lastEvent: string;
}

export const roomDefinitions: Record<RoomKind, Omit<Route, "id" | "kind">> = {
  protect: {
    name: "Hold the frequency",
    description:
      "Keep the relay alive while it charges. Stand nearby to accelerate its signal; incoming patrols target the relay.",
  },
  trial: {
    name: "The moving margins",
    description:
      "Touch four marked beacons in order while crossing position-locked beams. Movement solves this room; fire alone cannot.",
  },
  environment: {
    name: "The broken infrastructure",
    description:
      "Two patrol waves among district hazards. Read the environment, then claim a movement mod.",
  },
  survival: {
    name: "The long reception",
    description:
      "Three changing patrol waves. Hold your ground for extra Ego and a defensive mod.",
  },
  npc: {
    name: "The signal archivist",
    description:
      "An archivist offers a signal key. Carry it to an abandoned relay, or refuse it for healing.",
  },
  curse: {
    name: "The glass bargain",
    description:
      "Take Glass confidence: more damage dealt and taken. Refusing helps the pilgrim's hidden route.",
  },
  rare: {
    name: "The stranded relay",
    description:
      "A rare encounter: a vulnerable companion's transmitter, a signal key, and a choice of supplies.",
  },
  battle: {
    name: "The side street",
    description:
      "A patrol of Ink runners and Signal sentries. Mod and Ego on clear.",
  },
  elite: {
    name: "Loud company",
    description:
      "A stronger patrol with extra Ego. More bodies, faster attacks.",
  },
  miniboss: {
    name: "The gatekeeper",
    description: "Break a sector guardian. Its patterns change at half health.",
  },
  boss: {
    name: "The spotlight",
    description:
      "A character boss guards the next district. Unique reward on victory.",
  },
  shop: {
    name: "A quiet corner",
    description: "Spend Ego on healing, helpers, or a build mod.",
  },
  shrine: {
    name: "The confidence shrine",
    description: "Trade health for a rare mod, or rest safely.",
  },
  helper: {
    name: "A friendly frequency",
    description: "Choose a gunner or medic. Rescue them without paying Ego.",
  },
  treasure: {
    name: "Lost and found",
    description:
      "Take a modest cache, or open the trapped case for a larger reward.",
  },
  trade: {
    name: "The ink broker",
    description: "Sell a build mod for Ego or trade Ego for another mod.",
  },
  weapon: {
    name: "The abandoned workbench",
    description:
      "Swap your weapon for a different play style and take a supply cache.",
  },
  challenge: {
    name: "Noisy crossing",
    description: "A hostile patrol beneath pulsing beams. Double the reward.",
  },
  secret: {
    name: "The back channel",
    description:
      "A hidden signal. Pay health for an unusual mod, or take the safe cache.",
  },
};

export function campaignRandom(w: World) {
  w.seed = (Math.imul(w.seed, 1664525) + 1013904223) >>> 0;
  return w.seed / 4294967296;
}
export function routeFor(
  kind: RoomKind,
  roomIndex: number,
  variant = 0,
): Route {
  const room = roomDefinitions[kind];
  return { ...room, id: `${roomIndex}:${kind}:${variant}`, kind };
}
export function sector(w: World) {
  return Math.floor((w.campaign?.roomIndex ?? w.bossIndex * 5) / 5);
}
export function encounterName(w: World) {
  const c = w.campaign;
  if (!c || c.room.kind === "boss") return bosses[w.bossIndex].name;
  if (c.room.kind === "miniboss")
    return sector(w) % 2 === 0 ? "The Redactor" : "The Metronome";
  return c.room.name;
}
export function isPatrol(w: World) {
  return (
    !!w.campaign &&
    [
      "battle",
      "elite",
      "challenge",
      "environment",
      "survival",
      "protect",
      "trial",
    ].includes(w.campaign.room.kind)
  );
}
export function isCombatRoom(kind: RoomKind) {
  return [
    "battle",
    "elite",
    "challenge",
    "environment",
    "survival",
    "miniboss",
    "boss",
    "protect",
    "trial",
  ].includes(kind);
}
export function campaignLength(w: World) {
  return w.campaign?.length ?? CLASSIC_BOSS_COUNT * 5;
}
export function nextRoutes(w: World): Route[] {
  const c = w.campaign;
  if (!c) return [];
  const next = c.roomIndex + 1;
  if (c.mode !== "endless" && next >= campaignLength(w)) return [];
  const slot = next % 5;
  if (slot === 0)
    return c.contentVersion === 2
      ? [
          routeFor("battle", next),
          routeFor(next % 10 === 0 ? "protect" : "trial", next),
        ]
      : [routeFor("battle", next), routeFor("challenge", next)];
  if (slot === 2) return [routeFor("miniboss", next)];
  if (slot === 4) return [routeFor("boss", next)];
  const pool: RoomKind[] =
    slot === 1
      ? ["battle", "elite", "weapon", "challenge"]
      : ["shop", "shrine", "helper", "treasure", "trade"];
  if (c.contentVersion === 2) {
    if (slot === 1) pool.push("environment", "survival", "protect", "trial");
    else pool.push("npc", "curse");
    // Rare relay odds are disclosed by route presentation, never invisible interaction targets.
    if (slot === 3 && campaignRandom(w) < (c.secretUnlocked ? 0.4 : 0.18))
      pool.push("rare");
  }
  const secretReady =
    c.contentVersion === 2
      ? !!c.signalKey || (c.refusals ?? 0) >= 3
      : c.secretUnlocked;
  if (secretReady && slot === 3) pool.push("secret");
  // Sampling without replacement is stable across checkpoints and seeds.
  const result: Route[] = [];
  while (result.length < Math.min(3, pool.length)) {
    const index = Math.floor(campaignRandom(w) * pool.length);
    result.push(routeFor(pool.splice(index, 1)[0], next, result.length));
  }
  if (secretReady && slot === 3 && !result.some((r) => r.kind === "secret")) {
    result[result.length - 1] = routeFor("secret", next, 9);
  }
  if (c.contentVersion === 2)
    for (const r of result)
      if (r.kind === "secret") {
        r.name = c.signalKey ? "The abandoned relay" : "The pilgrim's refuge";
        r.description = c.signalKey
          ? "Your carried signal key answers the locked relay. Use it to restore a prism weapon and a rare upgrade."
          : "Three refused bargains left a trail. Claim Held breath and a quiet recovery.";
      }
  return result;
}
export function openRoutes(w: World) {
  if (!w.campaign) return;
  w.campaign.routes = nextRoutes(w);
  if (!w.campaign.routes.length) {
    w.stage = "won";
    w.message =
      "The last signal clears. You found a way through every district.";
  } else {
    w.stage = "route";
    w.message =
      "Choose the next room. Safety, resources, and reward all have a price.";
  }
}

export type EventChoice =
  "safe" | "risk" | "gunner" | "medic" | "sell" | "buy" | WeaponId;
/** Event mutations are run-local; they never mint platform currency. */
export function resolveEvent(
  w: World,
  choice: EventChoice,
  applyMod: (id: string) => void,
  canApplyMod: (id: string) => boolean = () => true,
) {
  const c = w.campaign;
  if (!c || w.stage !== "event" || c.eventResolved) return false;
  const kind = c.room.kind;
  let message = "";
  if (c.contentVersion === 2 && kind === "secret" && choice === "safe") {
    if (!c.signalKey && (c.refusals ?? 0) < 3) return false;
    const secret = c.signalKey ? "restored-relay" : "pilgrims-refuge";
    if (c.signalKey) {
      w.weapon = "prism";
      applyMod("refraction");
      c.signalKey = false;
    } else {
      applyMod("mercy");
      healPlayer(w, 35);
      c.refusals = 0;
    }
    c.secrets = [...new Set([...(c.secrets ?? []), secret])];
    message =
      secret === "restored-relay"
        ? "The signal key restores Prism argument and Prismatic memory. A real path led here."
        : "Three refusals opened the refuge. Held breath and 35 health are yours.";
  } else if (kind === "npc" && choice === "risk") {
    c.signalKey = true;
    message =
      "The archivist entrusts a signal key to you. Carry it to a district's event junction.";
  } else if (kind === "rare" && (choice === "safe" || choice === "risk")) {
    if (choice === "risk" && w.ego < 25) return false;
    c.signalKey = true;
    if (choice === "risk") {
      w.ego -= 25;
      w.helper = { kind: "gunner", hp: 65, timer: 0 };
      applyMod("guardian");
    } else grantEgo(w, 30);
    message =
      choice === "risk"
        ? "A companion and Companion bond join you; the transmitter yields a signal key."
        : "You take 30 Ego and the signal key, leaving the transmitter intact.";
  } else if ((kind === "npc" || kind === "curse") && choice === "safe") {
    c.refusals = (c.refusals ?? 0) + 1;
    healPlayer(w, 15);
    message = `You refuse the bargain and recover 15 health. ${c.refusals}/3 refusals mark the pilgrim's trail.`;
  } else if (kind === "curse" && choice === "risk") {
    if (w.mods.includes("glass") || (c.pacingVersion && !canApplyMod("glass"))) return false;
    applyMod("glass");
    grantEgo(w, 35);
    message =
      "Glass confidence: 25% more damage dealt, 20% more taken, and 35 Ego. The risk lasts this run.";
  } else if (kind === "helper" && choice === "safe") {
    healPlayer(w, 10);
    message = "You leave the companion in safety and recover 10 health.";
  } else if (kind === "helper" && (choice === "gunner" || choice === "medic")) {
    w.helper = { kind: choice, hp: choice === "gunner" ? 40 : 50, timer: 0 };
    message =
      choice === "gunner"
        ? "Signal companion joins your run."
        : "A field medic joins your run.";
  } else if (
    (kind === "shrine" || (kind === "secret" && c.contentVersion !== 2)) &&
    choice === "risk"
  ) {
    const price = kind === "secret" ? 30 : 20;
    if (w.player.hp <= price || (c.pacingVersion && !canApplyMod(kind === "secret" ? "ricochet" : "critical"))) return false;
    w.player.hp -= price;
    applyMod(kind === "secret" ? "ricochet" : "critical");
    message = `${price} health traded for ${kind === "secret" ? "Echoing ink" : "Perfect emphasis"}.`;
  } else if ((kind === "shrine" || kind === "secret") && choice === "safe") {
    if (kind === "secret") grantEgo(w, 25);
    else {
      healPlayer(w, 18);
      if (c.contentVersion === 2) c.refusals = (c.refusals ?? 0) + 1;
    }
    message =
      kind === "secret"
        ? "The safe cache contains 25 Ego."
        : "A quiet breath restores 18 health.";
  } else if (kind === "treasure" && (choice === "safe" || choice === "risk")) {
    if (choice === "risk" && (w.player.hp <= 18 || (c.pacingVersion && !canApplyMod("split")))) return false;
    grantEgo(w, choice === "risk" ? 55 : 25);
    if (choice === "risk") {
      w.player.hp -= 18;
      applyMod("split");
    }
    message =
      choice === "risk"
        ? "The trap takes 18 health. A split mod and 55 Ego survive."
        : "The small cache contains 25 Ego.";
  } else if (kind === "trade" && choice === "sell") {
    // Shield cannot be sold: its maximum-health mutation would need an inverse.
    const index = w.mods.findIndex(
      (id) => id !== "shield" && id !== "helper" && id !== "promise",
    );
    if (index < 0) return false;
    const [sold] = w.mods.splice(index, 1);
    grantEgo(w, 35);
    message = `${sold} sold for 35 Ego.`;
  } else if (kind === "trade" && choice === "buy") {
    if (w.ego < 25) return false;
    const available = ["venom", "tempo"].filter((id) => !c.pacingVersion || canApplyMod(id));
    if (!available.length) return false;
    const selected = available[Math.floor(campaignRandom(w) * available.length)];
    w.ego -= 25;
    applyMod(selected);
    message = "The broker trades a mod for 25 Ego.";
  } else if (kind === "trade" && choice === "safe") {
    message = "You keep your current build.";
  } else if (kind === "weapon" && choice in weapons) {
    w.weapon = choice as WeaponId;
    grantEgo(w, 15);
    message = `${weapons[w.weapon].name} equipped. A supply cache adds 15 Ego.`;
  } else if (kind === "weapon" && choice === "safe") {
    grantEgo(w, 20);
    message = "You keep your weapon and take 20 Ego.";
  } else return false;
  c.eventResolved = true;
  c.cleared++;
  c.lastEvent = message;
  w.message = message;
  openRoutes(w);
  w.message =
    message +
    (w.ego >= 250 && c.contentVersion === 2
      ? " Resource satchel is full (250 Ego); spend at the next shop."
      : "");
  return true;
}

export function seedFromText(text: string) {
  let hash = 2166136261;
  for (const char of text)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
export function dailySeed(date = new Date()) {
  return seedFromText(`ego-trip:${date.toISOString().slice(0, 10)}`);
}
