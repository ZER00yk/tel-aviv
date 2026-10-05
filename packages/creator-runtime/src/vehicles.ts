import type { LevelData, LevelObject } from "./schema";
import { convexCollision, objectPolygon, preciseSolidTypes } from "./geometry";
import {
  doorIsOpen,
  objectIsActive,
  runtimeObject,
  type PlayerState,
} from "./state";

export function driveCart(
  level: LevelData,
  next: PlayerState,
  objects: LevelObject[],
  keys: Set<string>,
  interact: boolean,
  step: number,
) {
  let usedInteraction = false;
  let source = objects.find(
    (object) =>
      object.id === next.vehicleId &&
      object.type === "cart" &&
      objectIsActive(object, next),
  );
  if (next.vehicleId && !source) next.vehicleId = null;
  if (interact && source) {
    next.vehicleId = null;
    next.vehicleVelocity[source.id] = 0;
    next.y -= 4;
    next.vy = -150;
    next.grounded = false;
    source = undefined;
    usedInteraction = true;
  } else if (interact) {
    source = objects.find((object) => {
      if (object.type !== "cart" || !objectIsActive(object, next)) return false;
      const cart = runtimeObject(object, next);
      return (
        Math.abs(next.x + 10 - cart.x - cart.width / 2) <= 70 &&
        Math.abs(next.y + 28 - cart.y) <= 70
      );
    });
    if (source) {
      next.vehicleId = source.id;
      usedInteraction = true;
    }
  }
  if (!source || !next.vehicleId) return usedInteraction;
  const cart = runtimeObject(source, next);
  const direction =
    (keys.has("ArrowRight") || keys.has("d") ? 1 : 0) -
    (keys.has("ArrowLeft") || keys.has("a") ? 1 : 0);
  const oldSpeed = next.vehicleVelocity[source.id] ?? 0;
  const limit = source.cartSpeed ?? 150;
  let speed = direction
    ? Math.max(-limit, Math.min(limit, oldSpeed + direction * 420 * step))
    : Math.sign(oldSpeed) * Math.max(0, Math.abs(oldSpeed) - 540 * step);
  const desiredX = Math.max(
    0,
    Math.min(level.width - cart.width, cart.x + speed * step),
  );
  const obstacles = objects.filter(
    (object) =>
      object.id !== source.id &&
      objectIsActive(object, next) &&
      (["platform", "moving-platform", "door"].includes(object.type) ||
        preciseSolidTypes.includes(object.type)) &&
      !(object.type === "door" && doorIsOpen(level, object.id, next)),
  );
  const collides = (x: number) =>
    obstacles.some((object) =>
      convexCollision(
        { x, y: cart.y, width: cart.width, height: cart.height },
        objectPolygon(runtimeObject(object, next)),
      ),
    );
  // A rail cart is one horizontal body. Eight subdivisions bound stopping work
  // and prevent crossing a thin wall at its maximum fixed-step speed.
  let x = desiredX;
  if (collides(desiredX)) {
    let safe = 0,
      blocked = 1;
    for (let i = 0; i < 8; i++) {
      const fraction = (safe + blocked) / 2;
      if (collides(cart.x + (desiredX - cart.x) * fraction)) blocked = fraction;
      else safe = fraction;
    }
    x = cart.x + (desiredX - cart.x) * safe;
    speed = 0;
  }
  if (desiredX === 0 || desiredX === level.width - cart.width) speed = 0;
  next.positions[source.id] = { x, y: cart.y };
  next.vehicleVelocity[source.id] = speed;
  next.x = x + cart.width / 2 - 10;
  next.y = cart.y - 28;
  next.vx = speed;
  next.vy = 0;
  next.grounded = true;
  next.supportId = source.id;
  return usedInteraction;
}

export function resetDrivenCart(next: PlayerState, objects: LevelObject[]) {
  if (!next.vehicleId) return;
  const source = objects.find((object) => object.id === next.vehicleId);
  if (source) {
    delete next.positions[source.id];
    next.vehicleVelocity[source.id] = 0;
  }
}
