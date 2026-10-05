import { describe, expect, it } from "vitest";
import {
  levelSchema,
  starterLevel,
  type LevelData,
  type LevelObject,
} from "./schema";
import {
  FIXED_STEP,
  initialPlayer,
  stepPlayer,
  replayInputs,
  objectPolygon,
  convexCollision,
  runtimeObject,
  MAX_EXPLOSIONS_PER_TICK,
  MAX_CHAIN_DEPTH,
  MAX_ACTIVE_EXPLOSIVES,
  advanceExplosives,
} from "./physics";
const id = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
function object(
  type: LevelObject["type"],
  number: number,
  patch: Partial<LevelObject> = {},
): LevelObject {
  return {
    id: id(number),
    type,
    x: 300,
    y: 400,
    width: 60,
    height: 40,
    rotation: 0,
    layer: 0,
    ...patch,
  };
}
function level(objects: LevelObject[], spawn = { x: 40, y: 472 }): LevelData {
  return levelSchema.parse({
    ...starterLevel(),
    schemaVersion: 2,
    spawn,
    objects: [starterLevel().objects[0], ...objects],
  });
}
const tick = (
  value: LevelData,
  state = initialPlayer(value),
  keys: string[] = [],
) => stepPlayer(value, state, new Set(keys), FIXED_STEP);

describe("Creator opt-in convex geometry", () => {
  it("climbs a real triangular slope and completes using deterministic inputs", () => {
    const value = level([
      object("slope", 10, { x: 140, y: 400, width: 240, height: 100 }),
      object("finish", 11, { x: 700, y: 400, height: 100 }),
    ]);
    const midway = replayInputs(value, [{ keys: ["ArrowRight"], ticks: 90 }]);
    expect(midway.x).toBeGreaterThan(250);
    expect(midway.y).toBeLessThan(440);
    expect(midway.grounded).toBe(true);
    const frames = [{ keys: ["ArrowRight"], ticks: 240 }];
    const completed = replayInputs(value, frames);
    expect(completed.won).toBe(true);
    expect(replayInputs(value, frames)).toEqual(completed);
  });
  it("follows a downward slope without treating the enclosing rectangle as its surface", () => {
    const slope = object("slope", 10, {
      x: 100,
      y: 360,
      width: 240,
      height: 140,
      slopeDirection: "left",
    });
    const value = level([slope], { x: 105, y: 346 });
    let state: ReturnType<typeof initialPlayer> = {
      ...initialPlayer(value),
      grounded: true,
      supportId: slope.id,
      y: 360 + (25 / 240) * 140 - 28,
    };
    for (let index = 0; index < 40; index++)
      state = tick(value, state, ["ArrowRight"]);
    expect(state.x).toBeGreaterThan(220);
    expect(state.y).toBeGreaterThan(395);
    expect(state.grounded).toBe(true);
  });
  it("tests rotated geometry rather than falsely colliding in its bounding-box corner", () => {
    const angled = object("angled-platform", 10, {
      x: 300,
      y: 300,
      width: 120,
      height: 12,
      rotation: 45,
    });
    expect(
      convexCollision(
        { x: 315, y: 320, width: 20, height: 28 },
        objectPolygon(angled),
      ),
    ).toBeNull();
    expect(
      convexCollision(
        { x: 350, y: 298, width: 20, height: 28 },
        objectPolygon(angled),
      ),
    ).not.toBeNull();
    const value = level([angled], { x: 315, y: 320 });
    const state = tick(value);
    expect(state.x).toBe(315);
    expect(state.grounded).toBe(false);
    expect(state.y).toBeGreaterThan(320);
  });
  it("supports convex polygons and rejects concave, crossing, degenerate and oversized shapes", () => {
    const polygon = object("polygon-platform", 10, {
      vertices: [
        { x: 0.2, y: 0 },
        { x: 0.8, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    });
    expect(level([polygon]).objects).toContainEqual(polygon);
    for (const vertices of [
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0.5, y: 0.2 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      [
        { x: 0, y: 0 },
        { x: 0.01, y: 0 },
        { x: 0, y: 0.01 },
      ],
      Array.from({ length: 9 }, (_, index) => ({
        x: 0.5 + 0.5 * Math.cos((index * 2 * Math.PI) / 9),
        y: 0.5 + 0.5 * Math.sin((index * 2 * Math.PI) / 9),
      })),
    ])
      expect(() => level([{ ...polygon, vertices }])).toThrow();
  });
  it("jumps through a one-way platform from below and lands on its upper face", () => {
    const platform = object("one-way-platform", 10, {
      x: 20,
      y: 430,
      width: 140,
      height: 12,
    });
    const value = level([platform]);
    let state = { ...initialPlayer(value), grounded: true };
    state = tick(value, state, [" "]);
    let lowestFeet = state.y + 28;
    for (let index = 0; index < 42; index++) {
      state = tick(value, state);
      lowestFeet = Math.min(lowestFeet, state.y + 28);
    }
    expect(lowestFeet).toBeLessThan(platform.y);
    expect(state.grounded).toBe(true);
    expect(state.supportId).toBe(platform.id);
    expect(state.y).toBe(402);
  });
  it("rotates and moves hazards with exact collision and bounded speeds", () => {
    const hazard = object("rotating-hazard", 10, {
      x: 300,
      y: 300,
      width: 120,
      height: 12,
      rotationSpeed: 60,
    });
    const value = level([hazard], { x: 350, y: 345 });
    const before = tick(value);
    expect(before.deaths).toBe(0);
    const after = tick(value, { ...initialPlayer(value), elapsedTime: 1.5 });
    expect(after.deaths).toBe(1);
    const moving = object("moving-hazard", 11, {
      motion: { axis: "x", distance: 200, periodSeconds: 2 },
    });
    const movingLevel = level([moving], { x: 500, y: 400 });
    expect(
      tick(movingLevel, { ...initialPlayer(movingLevel), elapsedTime: 1 })
        .deaths,
    ).toBe(1);
    expect(() =>
      level([{ ...moving, motion: { ...moving.motion!, distance: 301 } }]),
    ).toThrow();
    expect(() => level([{ ...hazard, width: 241 }])).toThrow();
  });
  it("resumes legacy attempt JSON without the new state fields", () => {
    const value = starterLevel();
    const state = initialPlayer(value);
    const old = { ...state } as Partial<typeof state>;
    delete old.vehicleId;
    delete old.vehicleVelocity;
    delete old.interactionHeld;
    delete old.explosiveFuses;
    delete old.explosions;
    delete old.impulseX;
    expect(tick(value, old as typeof state)).toMatchObject({
      vehicleId: null,
      vehicleVelocity: {},
      interactionHeld: false,
      explosiveFuses: {},
      explosions: [],
      impulseX: 0,
    });
  });
});

describe("Creator bounded rail carts", () => {
  it("uses an edge-triggered driver seat, bounded acceleration and completion", () => {
    const cart = object("cart", 10, {
      x: 40,
      y: 476,
      width: 64,
      height: 24,
      cartSpeed: 180,
    });
    const value = level(
      [cart, object("finish", 11, { x: 480, y: 400, height: 100 })],
      { x: 58, y: 448 },
    );
    let state = tick(value, initialPlayer(value), ["e"]);
    expect(state.vehicleId).toBe(cart.id);
    state = tick(value, state, ["e", "ArrowRight"]);
    expect(state.vehicleId).toBe(cart.id);
    for (let index = 0; index < 60; index++)
      state = tick(value, state, ["ArrowRight"]);
    expect(state.vehicleVelocity[cart.id]).toBeLessThanOrEqual(180);
    expect(state.x).toBeGreaterThan(180);
    expect(state.y).toBe(448);
    for (let index = 0; index < 180 && !state.won; index++)
      state = tick(value, state, ["ArrowRight"]);
    expect(state.won).toBe(true);
  });
  it("stops against solids, permits leaving, and never crosses the level edge", () => {
    const cart = object("cart", 10, { x: 40, y: 476, width: 64, height: 24 });
    const wall = object("destructible", 11, {
      x: 240,
      y: 400,
      width: 20,
      height: 100,
    });
    const value = level([cart, wall], { x: 58, y: 448 });
    let state = tick(value, initialPlayer(value), ["e"]);
    for (let index = 0; index < 180; index++)
      state = tick(value, state, ["ArrowRight"]);
    expect(runtimeObject(cart, state).x + cart.width).toBeLessThanOrEqual(
      240.001,
    );
    expect(state.vehicleVelocity[cart.id]).toBe(0);
    state = tick(value, state, ["e"]);
    expect(state.vehicleId).toBeNull();
    expect(state.y).toBeLessThan(448);
  });
  it("resets the driven cart after player death and limits authored/spawned vehicles", () => {
    const cart = object("cart", 10, { x: 40, y: 476, width: 64, height: 24 });
    const hazard = object("moving-hazard", 11, {
      x: 220,
      y: 440,
      motion: { axis: "y", distance: 0, periodSeconds: 2 },
    });
    const value = level([cart, hazard], { x: 58, y: 448 });
    let state = tick(value, initialPlayer(value), ["e"]);
    for (let index = 0; index < 150 && state.deaths === 0; index++)
      state = tick(value, state, ["ArrowRight"]);
    expect(state.deaths).toBe(1);
    expect(state.vehicleId).toBeNull();
    expect(runtimeObject(cart, state).x).toBe(cart.x);
    expect(() =>
      level(
        Array.from({ length: 17 }, (_, index) => object("cart", index + 100)),
      ),
    ).toThrow();
  });
});

describe("Creator explosions", () => {
  it("runs contact fuses, chain blasts, destructible removal and enemy-destruction logic", () => {
    const first = object("explosive", 10, {
      x: 80,
      y: 460,
      width: 24,
      height: 24,
      explosive: {
        radius: 100,
        damage: 10,
        force: 100,
        fuseSeconds: 0.25,
        trigger: "contact",
      },
    });
    const second = object("explosive", 11, {
      x: 160,
      y: 460,
      width: 24,
      height: 24,
    });
    const wall = object("destructible", 12, {
      x: 230,
      y: 400,
      width: 20,
      height: 100,
    });
    const enemy = object("enemy", 13, { x: 205, y: 460, health: 3 });
    const value = {
      ...level([first, second, wall, enemy], { x: 75, y: 472 }),
      logic: [
        {
          id: id(50),
          label: "Enemy objective",
          event: { type: "enemy-defeated" as const, objectId: enemy.id },
          actions: [{ type: "objective" as const, text: "Barrier cleared" }],
        },
      ],
    };
    let state = initialPlayer(value);
    for (let index = 0; index < 20; index++) state = tick(value, state);
    expect(state.destroyed).toEqual(
      expect.arrayContaining([first.id, second.id, wall.id, enemy.id]),
    );
    expect(state.enemies[enemy.id]).toBe(0);
    expect(state.objective).toBe("Barrier cleared");
    expect(state.health).toBeLessThan(100);
    expect(Math.abs(state.impulseX)).toBeGreaterThan(0);
  });
  it("only arms an interactive explosive on a fresh E press nearby", () => {
    const bomb = object("explosive", 10, { x: 60, y: 460 });
    const value = level([bomb]);
    const state = tick(value);
    expect(state.explosiveFuses).toEqual({});
    const armed = tick(value, state, ["e"]);
    expect(armed.explosiveFuses[bomb.id]).toBeLessThan(1);
    expect(tick(value, armed, ["e"]).explosiveFuses[bomb.id]).toBeLessThan(
      armed.explosiveFuses[bomb.id],
    );
  });
  it("strictly bounds long chains per tick and defers remaining fuses", () => {
    const bombs = Array.from({ length: 32 }, (_, index) =>
      object("explosive", index + 10, {
        x: 50 + index * 25,
        y: 460,
        width: 16,
        height: 16,
        explosive: {
          radius: 40,
          damage: 1,
          force: 0,
          fuseSeconds: 0.25,
          trigger: "interact",
        },
      }),
    );
    const value = level(bombs, { x: 20, y: 100 });
    const state = initialPlayer(value);
    state.explosiveFuses[bombs[0].id] = 0;
    const firstTick = tick(value, state);
    expect(firstTick.explosions.length).toBeLessThanOrEqual(
      MAX_EXPLOSIONS_PER_TICK,
    );
    expect(firstTick.destroyed.length).toBe(MAX_CHAIN_DEPTH + 1);
    expect(Object.values(firstTick.explosiveFuses)).toContain(0);
    let final = firstTick;
    for (let index = 0; index < 8; index++) {
      const before = final.destroyed.length;
      final = tick(value, final);
      expect(final.destroyed.length - before).toBeLessThanOrEqual(
        MAX_EXPLOSIONS_PER_TICK,
      );
    }
    expect(final.destroyed).toHaveLength(32);
    expect(final.explosiveFuses).toEqual({});
  });
  it("rejects oversized blast parameters, executable fields and excessive active explosives", () => {
    const bomb = object("explosive", 10);
    expect(() =>
      level([
        {
          ...bomb,
          explosive: {
            radius: 241,
            damage: 100,
            force: 500,
            fuseSeconds: 1,
            trigger: "interact",
          },
        },
      ]),
    ).toThrow();
    expect(() =>
      level(
        Array.from({ length: 33 }, (_, index) =>
          object("explosive", index + 10),
        ),
      ),
    ).toThrow();
    expect(
      levelSchema.safeParse({
        ...level([bomb]),
        objects: [{ ...bomb, onExplode: "fetch(secret)" }],
      }).success,
    ).toBe(false);
  });
  it("keeps the active fuse limit throughout a chain with spawned explosives", () => {
    const source = object("explosive", 10, {
      x: 400,
      y: 440,
      width: 16,
      height: 16,
    });
    const distant = Array.from({ length: 31 }, (_, index) =>
      object("explosive", index + 20, { x: 900, y: 440 }),
    );
    const value = level([source, ...distant], { x: 20, y: 100 });
    const state = initialPlayer(value);
    state.spawns = Array.from({ length: 32 }, (_, index) => ({
      ...source,
      id: id(index + 100),
      templateId: source.id,
    }));
    state.explosiveFuses = Object.fromEntries(
      value.objects
        .filter((entry) => entry.type === "explosive")
        .map((entry) => [entry.id, entry.id === source.id ? 0 : 10]),
    );
    const observedCounts: number[] = [];
    advanceExplosives(
      value,
      state,
      [...value.objects, ...state.spawns],
      FIXED_STEP,
      () => observedCounts.push(Object.keys(state.explosiveFuses).length),
    );
    expect(state.destroyed).toHaveLength(MAX_CHAIN_DEPTH + 1);
    expect(Math.max(...observedCounts)).toBeLessThanOrEqual(
      MAX_ACTIVE_EXPLOSIVES,
    );
    expect(Object.keys(state.explosiveFuses)).toHaveLength(
      MAX_ACTIVE_EXPLOSIVES,
    );
    for (const bomb of distant)
      expect(state.explosiveFuses[bomb.id]).toBeGreaterThan(9);
  });
});
