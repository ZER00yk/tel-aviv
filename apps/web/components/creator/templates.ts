import {
  starterLevel,
  type LevelData,
  type LevelObject,
} from "../../../../packages/creator-runtime/src/schema";

function object(
  type: LevelObject["type"],
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<LevelObject> = {},
): LevelObject {
  return {
    id: crypto.randomUUID(),
    type,
    x,
    y,
    width,
    height,
    rotation: 0,
    layer: 0,
    ...extra,
  };
}
export const templateChoices = [
  { id: "starter", title: "Platformer", category: "platformer" },
  { id: "key-door", title: "Collect a key", category: "puzzle" },
  { id: "timer", title: "Timed gate", category: "challenge" },
  { id: "moving", title: "Moving platforms", category: "platformer" },
  {
    id: "geometry",
    title: "Slopes & precise geometry",
    category: "platformer",
  },
  { id: "cart-blast", title: "Rail cart & chain reaction", category: "action" },
] as const;
export function levelTemplate(id: string): LevelData {
  const level = starterLevel();
  if (id === "geometry")
    return {
      ...level,
      schemaVersion: 2,
      objects: [
        ...level.objects,
        object("slope", 220, 420, 160, 80, {
          label: "Rising ramp",
          slopeDirection: "right",
        }),
        object("angled-platform", 430, 420, 140, 16, {
          label: "Angled bridge",
          rotation: -18,
        }),
        object("one-way-platform", 610, 430, 140, 12, {
          label: "Jump-through ledge",
        }),
        object("polygon-platform", 420, 460, 140, 40, {
          label: "Convex footing",
          vertices: [
            { x: 0.15, y: 0 },
            { x: 0.85, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
        }),
        object("rotating-hazard", 680, 260, 100, 12, {
          label: "Rotating arm",
          rotationSpeed: 60,
        }),
      ],
      logic: [
        {
          id: crypto.randomUUID(),
          label: "Explain geometry",
          event: { type: "level-start" },
          actions: [
            {
              type: "objective",
              text: "Climb the ramp, jump through the ledge and reach the finish. Collision follows the visible shapes.",
            },
          ],
        },
      ],
    };
  if (id === "cart-blast") {
    const wall = object("destructible", 280, 420, 24, 80, {
      label: "Breakable barrier",
    });
    const blast = {
      radius: 100,
      damage: 10,
      force: 0,
      fuseSeconds: 0.75,
      trigger: "contact" as const,
    };
    return {
      ...level,
      schemaVersion: 2,
      spawn: { x: 82, y: 448 },
      objects: [
        ...level.objects,
        object("cart", 60, 476, 64, 24, { label: "Rail cart", cartSpeed: 150 }),
        object("explosive", 205, 460, 24, 24, {
          label: "Fuse charge",
          explosive: blast,
        }),
        object("explosive", 245, 460, 24, 24, {
          label: "Chain charge",
          explosive: blast,
        }),
        wall,
      ],
      logic: [
        {
          id: crypto.randomUUID(),
          label: "Explain the rail",
          event: { type: "level-start" },
          actions: [
            {
              type: "objective",
              text: "Press E to board the cart, then drive right. The contact charges break the barrier. E leaves the seat.",
            },
          ],
        },
        {
          id: crypto.randomUUID(),
          label: "Barrier cleared",
          event: { type: "object-destroyed", objectId: wall.id },
          actions: [
            {
              type: "objective",
              text: "The barrier is gone. Drive to the finish!",
            },
            { type: "sound", sound: "success" },
          ],
        },
      ],
    };
  }
  if (id === "key-door") {
    const key = object("collectible", 240, 458, 24, 24, {
      label: "Gate key",
      item: "key",
    });
    const door = object("door", 640, 340, 24, 160, { label: "Locked gate" });
    return {
      ...level,
      schemaVersion: 2,
      objects: [...level.objects, key, door],
      variables: [{ name: "foundKey", type: "boolean", initial: false }],
      logic: [
        {
          id: crypto.randomUUID(),
          label: "Explain the goal",
          event: { type: "level-start" },
          actions: [
            { type: "objective", text: "Collect the key to open the gate." },
          ],
        },
        {
          id: crypto.randomUUID(),
          label: "Unlock the gate",
          event: { type: "collectible-obtained", objectId: key.id },
          actions: [
            { type: "set-variable", variable: "foundKey", value: true },
            { type: "open-door", objectId: door.id },
            { type: "sound", sound: "success" },
            { type: "objective", text: "The gate is open. Reach the finish." },
          ],
        },
      ],
    };
  }
  if (id === "timer") {
    const door = object("door", 500, 340, 24, 160, { label: "Timed gate" });
    return {
      ...level,
      schemaVersion: 2,
      objects: [...level.objects, door],
      logic: [
        {
          id: crypto.randomUUID(),
          label: "Start countdown",
          event: { type: "level-start" },
          actions: [
            { type: "set-timer", timer: "gate", seconds: 3 },
            { type: "objective", text: "The gate opens after three seconds." },
          ],
        },
        {
          id: crypto.randomUUID(),
          label: "Open timed gate",
          event: { type: "timer-expires", timer: "gate" },
          actions: [
            { type: "open-door", objectId: door.id },
            { type: "show-text", text: "Go!" },
          ],
        },
      ],
    };
  }
  if (id === "moving")
    return {
      ...level,
      objects: [
        ...level.objects,
        object("moving-platform", 300, 400, 120, 18, {
          label: "Shuttle",
          motion: { axis: "x", distance: 250, periodSeconds: 3 },
        }),
        object("spring", 160, 480, 32, 20, { label: "Jump boost" }),
      ],
    };
  return level;
}
