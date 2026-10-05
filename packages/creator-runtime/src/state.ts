import type { LevelData, LevelObject, Scalar } from "./schema";
export const FIXED_STEP = 1 / 60;
// Change when verification behavior changes. Rankings compare this identifier;
// old attempts remain readable without mixing their times into a new runtime.
export const CREATOR_RUNTIME_REVISION = "creator-geometry-1";
export const MAX_SPAWNS = 32;
export const MAX_EVENTS_PER_TICK = 64;
export const MAX_ACTIONS_PER_TICK = 256;
export const MAX_TOTAL_ACTIONS = 20_000;
export const INPUT_KEYS = [
  "ArrowRight",
  "ArrowLeft",
  "ArrowUp",
  " ",
  "d",
  "a",
  "w",
  "e",
] as const;
export type PlayerState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  won: boolean;
  deaths: number;
  checkpoint: { x: number; y: number };
  elapsedTime: number;
  pressedButtons: string[];
  toggledButtons: string[];
  supportId: string | null;
  health: number;
  failed: boolean;
  started: boolean;
  rng: number;
  variables: Record<string, Scalar>;
  items: Record<string, number>;
  timers: Record<
    string,
    { remaining: number; state: "running" | "expired" | "idle" }
  >;
  active: Record<string, boolean>;
  doors: Record<string, boolean>;
  positions: Record<string, { x: number; y: number }>;
  enemies: Record<string, number>;
  destroyed: string[];
  touching: string[];
  spawns: (LevelObject & { templateId: string })[];
  text: string;
  objective: string;
  sounds: string[];
  teleporterCooldown: number;
  damageCooldown: number;
  actionCount: number;
  logicHalted: boolean;
  logicWarning: string;
  allEnemiesDefeated: boolean;
  vehicleId: string | null;
  vehicleVelocity: Record<string, number>;
  interactionHeld: boolean;
  explosiveFuses: Record<string, number>;
  explosions: { x: number; y: number; radius: number; remaining: number }[];
  impulseX: number;
};
export function initialPlayer(
  level: LevelData,
  seed = level.seed ?? 1,
): PlayerState {
  return {
    ...level.spawn,
    vx: 0,
    vy: 0,
    grounded: false,
    won: false,
    deaths: 0,
    checkpoint: { ...level.spawn },
    elapsedTime: 0,
    pressedButtons: [],
    toggledButtons: [],
    supportId: null,
    health: 100,
    failed: false,
    started: false,
    rng: seed >>> 0,
    variables: Object.fromEntries(
      (level.variables ?? []).map((variable) => [
        variable.name,
        variable.initial,
      ]),
    ),
    items: {},
    timers: {},
    active: {},
    doors: {},
    positions: {},
    enemies: Object.fromEntries(
      level.objects
        .filter((object) => object.type === "enemy")
        .map((object) => [object.id, object.health ?? 3]),
    ),
    destroyed: [],
    touching: [],
    spawns: [],
    text: "",
    objective: "",
    sounds: [],
    teleporterCooldown: 0,
    damageCooldown: 0,
    actionCount: 0,
    logicHalted: false,
    logicWarning: "",
    allEnemiesDefeated: false,
    vehicleId: null,
    vehicleVelocity: {},
    interactionHeld: false,
    explosiveFuses: {},
    explosions: [],
    impulseX: 0,
  };
}
export function clonePlayer(player: PlayerState, step: number): PlayerState {
  return {
    ...player,
    checkpoint: { ...player.checkpoint },
    elapsedTime: player.elapsedTime + step,
    pressedButtons: [...player.pressedButtons],
    toggledButtons: [...player.toggledButtons],
    variables: { ...player.variables },
    items: { ...player.items },
    timers: Object.fromEntries(
      Object.entries(player.timers).map(([name, timer]) => [
        name,
        { ...timer },
      ]),
    ),
    active: { ...player.active },
    doors: { ...player.doors },
    positions: { ...player.positions },
    enemies: { ...player.enemies },
    destroyed: [...player.destroyed],
    touching: [...player.touching],
    spawns: [...player.spawns],
    sounds: [],
    teleporterCooldown: Math.max(0, player.teleporterCooldown - step),
    damageCooldown: Math.max(0, player.damageCooldown - step),
    // Attempts made before geometry/vehicles shipped can still be resumed.
    vehicleId: player.vehicleId ?? null,
    vehicleVelocity: { ...player.vehicleVelocity },
    interactionHeld: player.interactionHeld ?? false,
    explosiveFuses: { ...player.explosiveFuses },
    explosions: (player.explosions ?? [])
      .map((blast) => ({ ...blast, remaining: blast.remaining - step }))
      .filter((blast) => blast.remaining > 0),
    impulseX: (player.impulseX ?? 0) * Math.max(0, 1 - step * 4),
  };
}
export function objectIsActive(object: LevelObject, player: PlayerState) {
  return (
    !player.destroyed.includes(object.id) &&
    (player.active[object.id] ?? object.active ?? true)
  );
}
export function runtimeObjects(level: LevelData, player: PlayerState) {
  return [...level.objects, ...player.spawns];
}
export function eventObjectId(object: LevelObject) {
  return "templateId" in object && typeof object.templateId === "string"
    ? object.templateId
    : object.id;
}
export function objectAtTime(
  object: LevelObject,
  elapsedTime: number,
): LevelObject {
  if (object.type === "rotating-hazard") {
    const speed = object.rotationSpeed ?? 60;
    const angle = (Math.max(0, elapsedTime) % (360 / Math.abs(speed))) * speed;
    object = { ...object, rotation: (object.rotation + angle) % 360 };
  }
  if (!object.motion) return object;
  const phase =
    (Math.max(0, elapsedTime) % object.motion.periodSeconds) /
    object.motion.periodSeconds;
  const offset =
    (object.motion.distance * (1 - Math.cos(phase * Math.PI * 2))) / 2;
  return {
    ...object,
    [object.motion.axis]: object[object.motion.axis] + offset,
  };
}
export function runtimeObject(
  object: LevelObject,
  player: PlayerState,
): LevelObject {
  const position = player.positions[object.id];
  return objectAtTime(
    position ? { ...object, ...position } : object,
    player.elapsedTime,
  );
}
export function doorIsOpen(
  level: LevelData,
  doorId: string,
  player: PlayerState,
) {
  if (player.doors[doorId] !== undefined) return player.doors[doorId];
  return runtimeObjects(level, player).some(
    (object) =>
      ["button", "switch", "pressure-plate"].includes(object.type) &&
      objectIsActive(object, player) &&
      object.targetIds?.includes(doorId) &&
      (object.buttonMode === "toggle" || object.type === "switch"
        ? player.toggledButtons
        : player.pressedButtons
      ).includes(object.id),
  );
}
export function respawn(player: PlayerState) {
  player.x = player.checkpoint.x;
  player.y = player.checkpoint.y;
  player.vx = 0;
  player.vy = 0;
  player.grounded = false;
  player.health = 100;
  player.deaths++;
  player.supportId = null;
  player.pressedButtons = [];
  player.touching = [];
  player.damageCooldown = 1;
  player.vehicleId = null;
  player.impulseX = 0;
}
