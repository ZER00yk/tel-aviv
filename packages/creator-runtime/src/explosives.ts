import type { LevelData, LevelObject, LogicEvent } from "./schema";
import { distanceToPolygon, objectPolygon } from "./geometry";
import {
  eventObjectId,
  objectIsActive,
  runtimeObject,
  type PlayerState,
} from "./state";

export const MAX_ACTIVE_EXPLOSIVES = 32;
export const MAX_EXPLOSIONS_PER_TICK = 16;
export const MAX_EXPLOSION_TARGETS = 64;
export const MAX_CHAIN_DEPTH = 8;
export const DEFAULT_EXPLOSIVE = {
  radius: 120,
  damage: 40,
  force: 220,
  fuseSeconds: 1,
  trigger: "interact" as const,
};

export function armExplosive(object: LevelObject, player: PlayerState) {
  if (!objectIsActive(object, player)) return false;
  if (object.id in player.explosiveFuses) return true;
  if (Object.keys(player.explosiveFuses).length >= MAX_ACTIVE_EXPLOSIVES)
    return false;
  player.explosiveFuses[object.id] = (
    object.explosive ?? DEFAULT_EXPLOSIVE
  ).fuseSeconds;
  return true;
}

export function advanceExplosives(
  level: LevelData,
  next: PlayerState,
  objects: LevelObject[],
  step: number,
  emit: (event: LogicEvent) => void,
) {
  const queue: { object: LevelObject; depth: number }[] = [];
  const scheduled = new Set<string>();
  for (const [id, remaining] of Object.entries(next.explosiveFuses)) {
    const object = objects.find(
      (entry) => entry.id === id && entry.type === "explosive",
    );
    if (!object || !objectIsActive(object, next)) {
      delete next.explosiveFuses[id];
      continue;
    }
    next.explosiveFuses[id] = Math.max(0, remaining - step);
    if (remaining <= step + 1e-8) {
      queue.push({ object, depth: 0 });
      scheduled.add(id);
    }
  }
  let processed = 0;
  for (
    let cursor = 0;
    cursor < queue.length && processed < MAX_EXPLOSIONS_PER_TICK;
    cursor++
  ) {
    const { object: source, depth } = queue[cursor];
    if (!objectIsActive(source, next)) continue;
    processed++;
    const object = runtimeObject(source, next);
    const blast = object.explosive ?? DEFAULT_EXPLOSIVE;
    const center = {
      x: object.x + object.width / 2,
      y: object.y + object.height / 2,
    };
    next.destroyed.push(object.id);
    delete next.explosiveFuses[object.id];
    emit({ type: "object-destroyed", objectId: eventObjectId(source) });
    next.sounds.push("danger");
    next.explosions.push({ ...center, radius: blast.radius, remaining: 0.3 });
    const nearX = Math.max(next.x, Math.min(next.x + 20, center.x));
    const nearY = Math.max(next.y, Math.min(next.y + 28, center.y));
    if (Math.hypot(center.x - nearX, center.y - nearY) <= blast.radius) {
      next.health = Math.max(0, next.health - blast.damage);
      const dx = next.x + 10 - center.x,
        dy = next.y + 14 - center.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      next.impulseX = Math.max(
        -500,
        Math.min(500, next.impulseX + (dx / distance) * blast.force),
      );
      next.vy = Math.max(
        -700,
        Math.min(
          700,
          next.vy + (dy / distance) * blast.force - blast.force * 0.25,
        ),
      );
      if (blast.force > 0) {
        next.grounded = false;
        // A force ejects the driver; the cart remains where it was struck.
        next.vehicleId = null;
      }
    }
    let affected = 0;
    for (const target of objects) {
      if (
        target.id === source.id ||
        !objectIsActive(target, next) ||
        !["explosive", "destructible", "enemy"].includes(target.type)
      )
        continue;
      if (
        distanceToPolygon(center, objectPolygon(runtimeObject(target, next))) >
        blast.radius
      )
        continue;
      if (affected++ >= MAX_EXPLOSION_TARGETS) break;
      if (target.type === "explosive") {
        // A chain cannot bypass the fuse cap by inserting a zero fuse after
        // arming was refused. Existing armed targets can still be accelerated.
        if (!armExplosive(target, next)) continue;
        next.explosiveFuses[target.id] = 0;
        if (!scheduled.has(target.id) && depth < MAX_CHAIN_DEPTH) {
          queue.push({ object: target, depth: depth + 1 });
          scheduled.add(target.id);
        }
        // Beyond depth eight, an armed zero-fuse bomb is deferred to the next
        // fixed tick. No recursion or unbounded continuation executes here.
      } else if (target.type === "destructible") {
        next.destroyed.push(target.id);
        emit({ type: "object-destroyed", objectId: eventObjectId(target) });
      } else {
        next.enemies[target.id] = Math.max(
          0,
          (next.enemies[target.id] ?? target.health ?? 3) - blast.damage,
        );
        if (next.enemies[target.id] === 0) {
          next.destroyed.push(target.id);
          emit({ type: "enemy-defeated", objectId: eventObjectId(target) });
          emit({ type: "object-destroyed", objectId: eventObjectId(target) });
        }
      }
    }
  }
  next.explosions = next.explosions.slice(-MAX_EXPLOSIONS_PER_TICK);
  // Runtime-spawned templates still obey the active-fuse cap.
  if (Object.keys(next.explosiveFuses).length > MAX_ACTIVE_EXPLOSIVES)
    next.explosiveFuses = Object.fromEntries(
      Object.entries(next.explosiveFuses).slice(0, MAX_ACTIVE_EXPLOSIVES),
    );
  void level;
}
