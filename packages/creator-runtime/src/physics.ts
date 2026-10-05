import type { LevelData, LevelObject, LogicEvent } from "./schema";
import {
  initialPlayer,
  clonePlayer,
  doorIsOpen,
  runtimeObjects,
  runtimeObject,
  objectIsActive,
  eventObjectId,
  respawn,
  FIXED_STEP,
  INPUT_KEYS,
  type PlayerState,
} from "./state";
import { runLogic, queueEvent } from "./logic";
import {
  convexCollision,
  objectPolygon,
  preciseSolidTypes,
  surfaceY,
} from "./geometry";
import { driveCart, resetDrivenCart } from "./vehicles";
import {
  advanceExplosives,
  armExplosive,
  DEFAULT_EXPLOSIVE,
} from "./explosives";
export * from "./state";
export * from "./geometry";
export * from "./explosives";
export function objectBounds(object: LevelObject) {
  const radians = (object.rotation * Math.PI) / 180;
  const width =
    Math.abs(object.width * Math.cos(radians)) +
    Math.abs(object.height * Math.sin(radians));
  const height =
    Math.abs(object.height * Math.cos(radians)) +
    Math.abs(object.width * Math.sin(radians));
  return {
    x: object.x + (object.width - width) / 2,
    y: object.y + (object.height - height) / 2,
    width,
    height,
  };
}

function overlap(
  player: PlayerState,
  object: { x: number; y: number; width: number; height: number },
) {
  return (
    player.x + 20 > object.x &&
    player.x < object.x + object.width &&
    player.y + 28 > object.y &&
    player.y < object.y + object.height
  );
}

function pressesButton(player: PlayerState, object: LevelObject) {
  const bounds = objectBounds(object);
  // Include feet touching a pressure plate after landing on it.
  return overlap(player, {
    ...bounds,
    y: bounds.y - 1,
    height: bounds.height + 1,
  });
}

export function stepPlayer(
  level: LevelData,
  player: PlayerState,
  keys: Set<string>,
  dt: number,
): PlayerState {
  if (player.won || player.failed) return player;
  const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.05)) : 0;
  if (step === 0) return player;
  const next = clonePlayer(player, step);
  const events: LogicEvent[] = [];
  const emit = (event: LogicEvent) => queueEvent(next, events, event, level);
  const logicBudget = { events: 0, actions: 0 };
  if (!next.started) {
    next.started = true;
    events.push({ type: "level-start" });
  }
  for (const [name, timer] of Object.entries(next.timers))
    if (timer.state === "running") {
      timer.remaining = Math.max(0, timer.remaining - step);
      if (timer.remaining <= 1e-9) {
        timer.state = "expired";
        emit({ type: "timer-expires", timer: name });
      }
    }
  runLogic(level, next, events, logicBudget);
  if (next.won || next.failed) return next;
  events.length = 0;
  const objects = runtimeObjects(level, next);
  const support = objects.find(
    (object) =>
      object.id === player.supportId &&
      object.type === "moving-platform" &&
      objectIsActive(object, next),
  );
  if (support && player.grounded) {
    const before = runtimeObject(support, player);
    const after = runtimeObject(support, next);
    next.x += after.x - before.x;
    next.y += after.y - before.y;
  }
  const interact = keys.has("e") && !player.interactionHeld;
  next.interactionHeld = keys.has("e");
  const interactionUsed = driveCart(level, next, objects, keys, interact, step);
  if (interact && !interactionUsed) {
    const nearby = objects.find((object) => {
      if (
        object.type !== "explosive" ||
        !objectIsActive(object, next) ||
        (object.explosive ?? DEFAULT_EXPLOSIVE).trigger !== "interact"
      )
        return false;
      const bomb = runtimeObject(object, next);
      return (
        Math.hypot(
          next.x + 10 - bomb.x - bomb.width / 2,
          next.y + 14 - bomb.y - bomb.height / 2,
        ) <= 80
      );
    });
    if (nearby) armExplosive(nearby, next);
  }
  if (!next.vehicleId) {
    next.vx =
      (keys.has("ArrowRight") || keys.has("d") ? 200 : 0) -
      (keys.has("ArrowLeft") || keys.has("a") ? 200 : 0) +
      next.impulseX;
    if (
      (keys.has(" ") || keys.has("ArrowUp") || keys.has("w")) &&
      next.grounded
    ) {
      next.vy = -390;
      next.grounded = false;
    }
  }
  const previousX = next.x,
    previousY = next.y,
    previousBottom = next.y + 28;
  if (!next.vehicleId) {
    next.vy = Math.min(700, next.vy + 950 * step);
    next.x = Math.max(0, Math.min(level.width - 20, next.x + next.vx * step));
    next.y += next.vy * step;
    next.grounded = false;
    next.supportId = null;
  }

  next.pressedButtons = objects
    .filter(
      (object) =>
        ["button", "switch", "pressure-plate"].includes(object.type) &&
        objectIsActive(object, next) &&
        pressesButton(next, runtimeObject(object, next)),
    )
    .map((object) => object.id);
  for (const object of objects) {
    if (
      next.pressedButtons.includes(object.id) &&
      !player.pressedButtons.includes(object.id)
    ) {
      emit({
        type: "button-pressed",
        objectId: eventObjectId(object),
      });
      if (object.buttonMode === "toggle" || object.type === "switch")
        next.toggledButtons = next.toggledButtons.includes(object.id)
          ? next.toggledButtons.filter((id) => id !== object.id)
          : [...next.toggledButtons, object.id];
    }
  }

  const touched: string[] = [];
  let died = false;
  for (const source of objects) {
    if (!objectIsActive(source, next)) continue;
    const object = runtimeObject(source, next);
    const bounds = objectBounds(object);
    const preciseSolid =
      preciseSolidTypes.includes(object.type) && object.id !== next.vehicleId;
    const preciseHazard = ["moving-hazard", "rotating-hazard"].includes(
      object.type,
    );
    const polygon =
      preciseSolid || preciseHazard ? objectPolygon(object) : null;
    const collision = polygon
      ? convexCollision({ ...next, width: 20, height: 28 }, polygon)
      : null;
    let snappedToSlope = false;
    if (
      preciseSolid &&
      polygon &&
      player.grounded &&
      player.supportId === object.id &&
      next.vy >= 0 &&
      !next.vehicleId
    ) {
      const surfaces = [next.x + 0.01, next.x + 10, next.x + 19.99]
        .map((x) => surfaceY(polygon, x))
        .filter((y): y is number => y !== null);
      const top = surfaces.length ? Math.min(...surfaces) : null;
      if (top !== null && Math.abs(next.y + 28 - top) <= 12) {
        next.y = top - 28;
        next.vy = 0;
        next.grounded = true;
        next.supportId = object.id;
        snappedToSlope = true;
      }
    }
    if (preciseSolid && collision && !snappedToSlope && !next.vehicleId) {
      next.x += collision.normal.x * (collision.depth + 1e-6);
      next.y += collision.normal.y * (collision.depth + 1e-6);
      if (collision.normal.y < -0.35 && next.vy >= 0) {
        next.vy = 0;
        next.grounded = true;
        next.supportId = object.id;
      } else if (collision.normal.y > 0.35 && next.vy < 0) next.vy = 0;
      if (Math.abs(collision.normal.x) > 0.9) next.vx = 0;
    }
    let landedOneWay = false;
    if (
      object.type === "one-way-platform" &&
      next.vy >= 0 &&
      previousBottom <= bounds.y + 1e-6 &&
      next.y + 28 >= bounds.y &&
      next.x + 20 > bounds.x &&
      next.x < bounds.x + bounds.width &&
      !next.vehicleId
    ) {
      next.y = bounds.y - 28;
      next.vy = 0;
      next.grounded = true;
      next.supportId = object.id;
      landedOneWay = true;
    }
    if (
      polygon
        ? !collision && !snappedToSlope
        : !overlap(next, bounds) && !landedOneWay
    )
      continue;
    touched.push(object.id);
    if (!player.touching.includes(object.id))
      emit({
        type: object.type === "trigger-zone" ? "zone-enter" : "object-touched",
        objectId: eventObjectId(object),
      });
    if (object.type === "door") {
      if (doorIsOpen(level, object.id, next)) continue;
      if (previousX + 20 <= bounds.x) {
        next.x = bounds.x - 20;
        next.vx = 0;
      } else if (previousX >= bounds.x + bounds.width) {
        next.x = bounds.x + bounds.width;
        next.vx = 0;
      } else if (next.vy >= 0 && previousBottom <= bounds.y + 5) {
        next.y = bounds.y - 28;
        next.vy = 0;
        next.grounded = true;
        next.supportId = object.id;
      } else if (previousY >= bounds.y + bounds.height) {
        next.y = bounds.y + bounds.height;
        next.vy = Math.max(0, next.vy);
      } else {
        // Handles a spawn or a toggle closing inside a door without trapping the player.
        next.x =
          previousX + 10 < bounds.x + bounds.width / 2
            ? bounds.x - 20
            : bounds.x + bounds.width;
        next.vx = 0;
      }
    }
    if (
      [
        "platform",
        "moving-platform",
        "button",
        "switch",
        "pressure-plate",
      ].includes(object.type) &&
      next.vy >= 0 &&
      previousBottom <= bounds.y + 5
    ) {
      next.y = bounds.y - 28;
      next.vy = 0;
      next.grounded = true;
      next.supportId = object.id;
    }
    if (
      object.type === "spring" &&
      next.vy >= 0 &&
      previousBottom <= bounds.y + 8
    ) {
      next.y = bounds.y - 28;
      next.vy = -580;
    }
    if (object.type === "checkpoint" && !player.touching.includes(object.id)) {
      next.checkpoint = { x: object.x, y: Math.max(0, object.y - 30) };
      emit({
        type: "checkpoint-reached",
        objectId: eventObjectId(object),
      });
    }
    if (object.type === "finish") next.won = true;
    if (object.type === "spikes") {
      died = true;
      break;
    }
    if (preciseHazard) {
      died = true;
      break;
    }
    if (
      object.type === "explosive" &&
      (object.explosive ?? DEFAULT_EXPLOSIVE).trigger === "contact"
    )
      armExplosive(source, next);
    if (object.type === "collectible" && !next.destroyed.includes(object.id)) {
      const item = object.item ?? "key";
      if (Object.keys(next.items).length < 32 || item in next.items)
        next.items[item] = Math.min(999, (next.items[item] ?? 0) + 1);
      next.destroyed.push(object.id);
      emit({
        type: "collectible-obtained",
        objectId: eventObjectId(object),
      });
      next.sounds.push("success");
    }
    if (object.type === "sign") next.text = object.text ?? "";
    if (
      object.type === "teleporter" &&
      object.targetId &&
      next.teleporterCooldown === 0
    ) {
      const target = objects.find(
        (entry) => entry.id === object.targetId && objectIsActive(entry, next),
      );
      if (target) {
        next.x = Math.min(level.width - 20, target.x);
        next.y = Math.max(0, target.y - 30);
        next.vy = 0;
        next.teleporterCooldown = 0.6;
      }
    }
    if (object.type === "enemy" && (next.enemies[object.id] ?? 0) > 0) {
      if (next.vy > 0 && previousBottom <= bounds.y + 8) {
        next.enemies[object.id]--;
        next.vy = -320;
        next.y = bounds.y - 28;
        if (next.enemies[object.id] <= 0) {
          next.destroyed.push(object.id);
          emit({
            type: "enemy-defeated",
            objectId: eventObjectId(object),
          });
          emit({
            type: "object-destroyed",
            objectId: eventObjectId(object),
          });
        }
      } else if (next.damageCooldown === 0) {
        next.health = Math.max(0, next.health - 25);
        next.damageCooldown = 0.8;
        next.vy = -200;
        next.sounds.push("danger");
      }
    }
  }
  advanceExplosives(level, next, objects, step, emit);
  for (const id of player.touching)
    if (
      !touched.includes(id) &&
      objects.find((object) => object.id === id)?.type === "trigger-zone"
    )
      emit({
        type: "zone-exit",
        objectId: eventObjectId(objects.find((object) => object.id === id)!),
      });
  next.touching = touched;
  const enemies = objects.filter(
    (object) =>
      object.type === "enemy" &&
      (object.active !== false ||
        next.active[object.id] === true ||
        next.destroyed.includes(object.id)),
  );
  const allDefeated =
    enemies.length > 0 &&
    enemies.every(
      (object) =>
        (next.enemies[object.id] ?? 0) <= 0 ||
        next.destroyed.includes(object.id),
    );
  if (allDefeated && !next.allEnemiesDefeated)
    emit({ type: "all-enemies-defeated" });
  next.allEnemiesDefeated = allDefeated;
  runLogic(level, next, events, logicBudget);
  if (died || next.y > level.height + 120 || next.health <= 0) {
    next.won = false;
    resetDrivenCart(next, objects);
    respawn(next);
    runLogic(level, next, [{ type: "player-dies" }], logicBudget);
  }
  next.x = Math.max(0, Math.min(level.width - 20, next.x));
  next.sounds = next.sounds.slice(0, 8);
  return next;
}

export const objectColors: Record<LevelObject["type"], string> = {
  platform: "#82a3dc",
  "moving-platform": "#76d4ef",
  spikes: "#fa849a",
  spring: "#e5c572",
  checkpoint: "#b29cff",
  finish: "#79e8b3",
  door: "#c998ee",
  button: "#ffa972",
  decoration: "#6e778e",
  "trigger-zone": "#89d7cb",
  collectible: "#ffe07d",
  enemy: "#fa7197",
  sign: "#a8bbc9",
  teleporter: "#cc87f4",
  switch: "#ffb17a",
  "pressure-plate": "#ffa972",
  slope: "#75b8d8",
  "angled-platform": "#789fcf",
  "polygon-platform": "#84b3db",
  "one-way-platform": "#8bd5f0",
  "moving-hazard": "#ff6f92",
  "rotating-hazard": "#ff7b91",
  cart: "#d9ad64",
  explosive: "#f69452",
  destructible: "#a4a281",
};

export type InputFrame = { keys: string[]; ticks: number };
export function replayInputs(
  level: LevelData,
  frames: InputFrame[],
  options: {
    maxFrames?: number;
    seed?: number;
    initialState?: PlayerState;
  } = {},
) {
  const maxTicks = options.maxFrames ?? 18_000;
  let total = 0;
  let state = options.initialState ?? initialPlayer(level, options.seed);
  for (const frame of frames) {
    if (
      !Number.isInteger(frame.ticks) ||
      frame.ticks < 1 ||
      frame.ticks > 300 ||
      frame.keys.length > INPUT_KEYS.length ||
      frame.keys.some((key) => !(INPUT_KEYS as readonly string[]).includes(key))
    )
      throw new Error("Invalid bounded Creator input frame");
    total += frame.ticks;
    if (total > maxTicks)
      throw new Error("Creator input replay exceeds its tick limit");
    const keys = new Set(frame.keys);
    for (
      let tick = 0;
      tick < frame.ticks && !state.won && !state.failed;
      tick++
    )
      state = stepPlayer(level, state, keys, FIXED_STEP);
  }
  return state;
}
