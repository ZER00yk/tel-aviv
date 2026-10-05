/**
 * Shared campaign encounter definitions. Every checkpoint is a visible place to
 * reach under combat pressure; no encounter advances merely because time passed.
 * Missing pacingVersion in a saved campaign retains its original encounters.
 */
export const JOURNEY_PACING_VERSION = 1 as const;
export const JOURNEY_REVISION = "journey-1";
export const JOURNEY_MOD_LIMIT = 8;
export const JOURNEY_PHASE_COUNT = 3;

export type JourneyStageKind = "courier" | "ward" | "escort";
export type JourneyEnemyKind =
  | "runner"
  | "sentry"
  | "anchor"
  | "weaver"
  | "splitter"
  | "bulwark";
export interface JourneyPoint {
  x: number;
  y: number;
}
export interface JourneyStageDefinition {
  kind: JourneyStageKind;
  squad: readonly JourneyEnemyKind[];
  checkpoints: readonly JourneyPoint[];
}

/** Include this complete, bounded definition in the authoritative ranked hash. */
export const JOURNEY_RULES = {
  revision: JOURNEY_REVISION,
  pacingVersion: JOURNEY_PACING_VERSION,
  modLimit: JOURNEY_MOD_LIMIT,
  bossPhases: JOURNEY_PHASE_COUNT,
  sustain: {
    stageHealing: 20,
    incomingDamage: { standard: 0.6, volatile: 0.8 },
  },
  movement: {
    normalSpeed: 230,
    slowedSpeed: 165,
    carryingSpeed: 185,
    slowedCarryingSpeed: 145,
    checkpointRadius: 32,
  },
  buildStackLimits: { tempo: 2, shield: 2, dash: 2 },
  pressure: {
    shieldedBossCadence: 0.35,
    escortAmbushRoles: ["runner", "weaver"] as const,
    escortAmbushHealth: 28,
    escortAmbushHealthPerDistrict: 2,
    escortAmbushRunnerSpeed: 85,
    escortAmbushWeaverSpeed: 65,
    crossingWarningInterval: 2.8,
    crossingWarningRadius: 15,
    crossingWarningDelay: 1.4,
  },
  stageCounts: {
    ordinary: 3,
    elite: 4,
    challenge: 4,
    environment: 4,
    survival: 5,
    miniboss: 3,
    bossPerPhase: 2,
  },
  stageKinds: ["courier", "ward", "escort"] as const,
  roomStageOffsets: {
    battle: 0,
    combat: 0,
    elite: 1,
    challenge: 1,
    environment: 2,
    survival: 2,
    protect: 2,
    trial: 1,
    miniboss: 1,
    boss: 0,
  },
  // These outer landmarks stay clear of every district's blocking cover. Long
  // crossings change firing positions instead of asking players to orbit a dot.
  landmarks: [
    { x: 90, y: 80 },
    { x: 810, y: 480 },
    { x: 810, y: 80 },
    { x: 90, y: 480 },
  ],
  // Alternate diagonals and opposite edges, rather than a clockwise lap.
  checkpointOrders: [
    [0, 1, 2, 3, 2, 0, 1],
    [1, 0, 3, 2, 3, 1, 0],
    [2, 3, 0, 1, 0, 2, 3],
    [3, 2, 1, 0, 1, 3, 2],
  ],
  checkpointCounts: { courier: 4, ward: 3, escort: 4 },
  squads: [
    ["runner", "sentry", "anchor", "weaver", "splitter", "bulwark", "runner", "sentry"],
    ["weaver", "anchor", "runner", "bulwark", "sentry", "splitter", "weaver", "runner"],
    ["sentry", "runner", "splitter", "anchor", "bulwark", "weaver", "sentry", "anchor"],
  ] as const,
  extraEnemiesFromDistrict: 3,
  maximumSquadSize: 10,
  // Co-op maps these identities onto its own authoritative enemy archetypes.
  cooperativeRoles: {
    runner: "chaser",
    sentry: "shooter",
    anchor: "shooter",
    weaver: "shooter",
    splitter: "splitter",
    bulwark: "brute",
  },
} as const;

const boundedIndex = (value: number, maximum: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.floor(value))) : 0;

/** A boss runs this many mechanic stages separately in each of its three phases. */
export function journeyStageCount(roomKind: string, district: number) {
  // Validate/clamp the district even though this revision holds counts stable;
  // later districts change composition and mechanics, never add unseen rooms.
  boundedIndex(district, 7);
  const counts = JOURNEY_RULES.stageCounts;
  switch (roomKind) {
    case "boss":
      return counts.bossPerPhase;
    case "miniboss":
      return counts.miniboss;
    case "elite":
      return counts.elite;
    case "challenge":
      return counts.challenge;
    case "environment":
      return counts.environment;
    case "survival":
      return counts.survival;
    default:
      return counts.ordinary;
  }
}

/** Pure seeded-by-itinerary missions shared by solo/ranked and cooperative play. */
export function journeyStageDefinition(
  roomKind: string,
  district: number,
  stage: number,
  phase = 1,
): JourneyStageDefinition {
  const districtIndex = boundedIndex(district, 7);
  const stageIndex = boundedIndex(stage, journeyStageCount(roomKind, districtIndex) - 1);
  const phaseIndex = Math.max(1, boundedIndex(phase, JOURNEY_PHASE_COUNT)) - 1;
  const roomOffset = Object.hasOwn(JOURNEY_RULES.roomStageOffsets, roomKind)
    ? JOURNEY_RULES.roomStageOffsets[roomKind as keyof typeof JOURNEY_RULES.roomStageOffsets]
    : 0;
  const kindIndex = (districtIndex + stageIndex + phaseIndex + roomOffset) % JOURNEY_RULES.stageKinds.length;
  const kind = JOURNEY_RULES.stageKinds[kindIndex];
  const order = JOURNEY_RULES.checkpointOrders[
    (districtIndex + stageIndex + phaseIndex) % JOURNEY_RULES.checkpointOrders.length
  ];
  const checkpoints = order
    .slice(0, JOURNEY_RULES.checkpointCounts[kind])
    .map((index) => ({ ...JOURNEY_RULES.landmarks[index] }));
  const squad: JourneyEnemyKind[] = [...JOURNEY_RULES.squads[kindIndex]];
  if (districtIndex >= JOURNEY_RULES.extraEnemiesFromDistrict)
    squad.push(kind === "escort" ? "runner" : "weaver");
  if (districtIndex >= 6 || (roomKind === "boss" && phaseIndex >= 1))
    squad.push(kind === "ward" ? "bulwark" : "anchor");
  return { kind, squad: squad.slice(0, JOURNEY_RULES.maximumSquadSize), checkpoints };
}
