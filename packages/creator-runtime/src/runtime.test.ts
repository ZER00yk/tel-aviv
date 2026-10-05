import { describe, expect, it } from "vitest";
import {
  actionSchema,
  levelSchema,
  normalizeLevel,
  starterLevel,
  type LevelData,
  type LevelObject,
  type LogicAction,
  type LogicBlock,
  type LogicCondition,
} from "./schema";
import {
  FIXED_STEP,
  initialPlayer,
  stepPlayer,
  replayInputs,
  doorIsOpen,
  MAX_SPAWNS,
  MAX_TOTAL_ACTIONS,
} from "./physics";
const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const makeObject = (
  value: number,
  type: LevelObject["type"],
  patch: Partial<LevelObject> = {},
): LevelObject => ({
  id: id(value),
  type,
  x: 300,
  y: 400,
  width: 40,
  height: 40,
  rotation: 0,
  layer: 0,
  ...patch,
});
const block = (
  value: number,
  event: LogicBlock["event"],
  actions: LogicAction[],
  condition?: LogicCondition,
): LogicBlock => ({
  id: id(value),
  label: `Rule ${value}`,
  event,
  actions,
  ...(condition ? { condition } : {}),
});
function level(
  logic: LogicBlock[] = [],
  objects: LevelObject[] = [],
): LevelData {
  return {
    ...starterLevel(),
    schemaVersion: 2,
    objects: [starterLevel().objects[0], ...objects],
    variables: [
      { name: "score", type: "number", initial: 0 },
      { name: "unlocked", type: "boolean", initial: false },
      { name: "message", type: "string", initial: "Ready" },
    ],
    logic,
    seed: 7,
  };
}
const tick = (value: LevelData, state = initialPlayer(value)) =>
  stepPlayer(value, state, new Set(), FIXED_STEP);
describe("Creator structured schema", () => {
  it("rejects motion actions that would push a platform path outside the level", () => {
    const platform = makeObject(50, "moving-platform", {
      x: 100,
      width: 100,
      height: 20,
      motion: { axis: "x", distance: 100, periodSeconds: 2 },
    });
    expect(
      levelSchema.safeParse(
        level(
          [
            block(51, { type: "level-start" }, [
              { type: "move", objectId: platform.id, x: 850, y: 400 },
            ]),
          ],
          [platform],
        ),
      ).success,
    ).toBe(false);
  });
  it("requires object event references to match their event and variable targets to include a value", () => {
    const decorative = makeObject(50, "decoration");
    expect(
      levelSchema.safeParse(
        level(
          [
            block(51, { type: "zone-enter", objectId: decorative.id }, [
              { type: "complete" },
            ]),
          ],
          [decorative],
        ),
      ).success,
    ).toBe(false);
    expect(
      levelSchema.safeParse(
        level([
          block(51, { type: "variable-reaches", variable: "score" }, [
            { type: "complete" },
          ]),
        ]),
      ).success,
    ).toBe(false);
  });
  it("converts a legacy level without changing geometry or source data", () => {
    const old = starterLevel();
    const converted = normalizeLevel(old);
    expect(converted).toMatchObject({
      schemaVersion: 2,
      variables: [],
      logic: [],
      seed: 1,
      objects: old.objects,
    });
    expect(old.schemaVersion).toBe(1);
  });
  it("accepts every supported safe action while rejecting executable fields", () => {
    expect(
      actionSchema.safeParse({
        type: "show-text",
        text: "<script>alert(1)</script>",
      }).success,
    ).toBe(true);
    expect(
      actionSchema.safeParse({
        type: "show-text",
        text: "Hi",
        script: "alert(1)",
      }).success,
    ).toBe(false);
    expect(
      levelSchema.safeParse({ ...level(), javascript: "run()" }).success,
    ).toBe(false);
  });
  it("rejects missing and wrongly typed variables, references and door actions", () => {
    expect(
      levelSchema.safeParse(
        level([
          block(10, { type: "level-start" }, [
            { type: "set-variable", variable: "score", value: "bad" },
          ]),
        ]),
      ).success,
    ).toBe(false);
    expect(
      levelSchema.safeParse(
        level([
          block(10, { type: "level-start" }, [
            { type: "set-variable", variable: "unknown", value: 1 },
          ]),
        ]),
      ).success,
    ).toBe(false);
    expect(
      levelSchema.safeParse(
        level([
          block(10, { type: "object-touched", objectId: id(99) }, [
            { type: "complete" },
          ]),
        ]),
      ).success,
    ).toBe(false);
    expect(
      levelSchema.safeParse(
        level([
          block(10, { type: "level-start" }, [
            { type: "open-door", objectId: id(1) },
          ]),
        ]),
      ).success,
    ).toBe(false);
  });
  it("rejects reserved names that could read inherited properties", () => {
    for (const name of [
      "constructor",
      "toString",
      "valueOf",
      "__proto__",
      "prototype",
    ])
      expect(
        levelSchema.safeParse({
          ...level(),
          variables: [{ name, type: "number", initial: 0 }],
        }).success,
      ).toBe(false);
  });
  it("rejects excessive nesting and excessive object, rule and payload sizes", () => {
    let condition: LogicCondition = {
      type: "health",
      operator: "gt",
      value: 0,
    };
    for (let depth = 0; depth < 5; depth++)
      condition = { type: "and", conditions: [condition] };
    expect(
      levelSchema.safeParse(
        level([
          block(10, { type: "level-start" }, [{ type: "complete" }], condition),
        ]),
      ).success,
    ).toBe(false);
    expect(
      levelSchema.safeParse({
        ...level(),
        objects: Array.from({ length: 301 }, (_, index) =>
          makeObject(index + 100, "decoration"),
        ),
      }).success,
    ).toBe(false);
    expect(
      levelSchema.safeParse({
        ...level(),
        logic: Array.from({ length: 65 }, (_, index) =>
          block(index + 100, { type: "level-start" }, [{ type: "complete" }]),
        ),
      }).success,
    ).toBe(false);
    expect(
      levelSchema.safeParse(
        level([
          block(10, { type: "level-start" }, [
            { type: "show-text", text: "x".repeat(301) },
          ]),
        ]),
      ).success,
    ).toBe(false);
  });
  it("validates complete teleporter destinations and rejects dangling/self links", () => {
    const a = makeObject(3, "teleporter", { targetId: id(4) }),
      b = makeObject(4, "teleporter", { x: 500 });
    expect(levelSchema.safeParse(level([], [a, b])).success).toBe(true);
    expect(levelSchema.safeParse(level([], [a])).success).toBe(false);
    expect(
      levelSchema.safeParse(level([], [{ ...a, targetId: a.id }])).success,
    ).toBe(false);
  });
});
describe("Creator deterministic bounded event runtime", () => {
  it("preserves dense legacy scenes without queuing unused interaction events", () => {
    const value = {
      ...starterLevel(),
      objects: [
        starterLevel().objects[0],
        ...Array.from({ length: 90 }, (_, index) =>
          makeObject(index + 100, "decoration", { x: 32, y: 420 }),
        ),
      ],
    };
    const player = tick(value);
    expect(player.logicHalted).toBe(false);
    expect(player.touching.length).toBeGreaterThan(64);
  });
  it("runs level-start once and propagates typed variable and custom events", () => {
    const value = level([
      block(10, { type: "level-start" }, [
        { type: "add-variable", variable: "score", amount: 2 },
        { type: "trigger", event: "unlock" },
      ]),
      block(11, { type: "variable-reaches", variable: "score", value: 2 }, [
        { type: "set-variable", variable: "unlocked", value: true },
      ]),
      block(12, { type: "custom", name: "unlock" }, [
        { type: "show-text", text: "Gate ready" },
      ]),
    ]);
    let player = tick(value);
    expect(player.variables).toMatchObject({ score: 2, unlocked: true });
    expect(player.text).toBe("Gate ready");
    player = tick(value, player);
    expect(player.variables.score).toBe(2);
  });
  it("evaluates grouped health, item, variable, object, door and player conditions", () => {
    const door = makeObject(3, "door");
    const value = level(
      [
        block(10, { type: "level-start" }, [
          { type: "give-item", item: "key", count: 1 },
          { type: "open-door", objectId: door.id },
          { type: "trigger", event: "check" },
        ]),
        block(
          11,
          { type: "custom", name: "check" },
          [{ type: "set-variable", variable: "unlocked", value: true }],
          {
            type: "and",
            conditions: [
              { type: "item", item: "key", count: 1 },
              { type: "health", operator: "gte", value: 50 },
              { type: "door-open", objectId: door.id, value: true },
              { type: "object-active", objectId: door.id, value: true },
              {
                type: "or",
                conditions: [
                  { type: "player-count", operator: "eq", value: 1 },
                  {
                    type: "variable",
                    variable: "score",
                    operator: "gt",
                    value: 100,
                  },
                ],
              },
            ],
          },
        ),
      ],
      [door],
    );
    expect(tick(value).variables.unlocked).toBe(true);
  });
  it("expires a timer once after deterministic fixed steps", () => {
    const value = level([
      block(10, { type: "level-start" }, [
        { type: "set-timer", timer: "alarm", seconds: 0.1 },
      ]),
      block(11, { type: "timer-starts", timer: "alarm" }, [
        { type: "show-text", text: "Tick" },
      ]),
      block(12, { type: "timer-expires", timer: "alarm" }, [
        { type: "add-variable", variable: "score", amount: 1 },
      ]),
    ]);
    let player = tick(value);
    expect(player.text).toBe("Tick");
    expect(player.variables.score).toBe(0);
    for (let index = 0; index < 20; index++) player = tick(value, player);
    expect(player.variables.score).toBe(1);
    expect(player.timers.alarm.state).toBe("expired");
  });
  it("uses identical bounded randomness for the same seed", () => {
    const value = level([
      block(
        10,
        { type: "level-start" },
        [{ type: "show-text", text: "Lucky" }],
        { type: "chance", percent: 50 },
      ),
    ]);
    const first = tick(value, initialPlayer(value, 1234));
    expect(tick(value, initialPlayer(value, 1234))).toEqual(first);
    expect(first.rng).not.toBe(1234);
  });
  it("halts recursive custom-event cycles without freezing physics", () => {
    const value = level([
      block(10, { type: "level-start" }, [{ type: "trigger", event: "loop" }]),
      block(11, { type: "custom", name: "loop" }, [
        { type: "add-variable", variable: "score", amount: 1 },
        { type: "trigger", event: "loop" },
      ]),
    ]);
    const player = tick(value);
    expect(player.logicHalted).toBe(true);
    expect(player.logicWarning).toMatch(/limit/);
    expect(player.actionCount).toBeLessThanOrEqual(256);
    expect(tick(value, player).elapsedTime).toBeGreaterThan(player.elapsedTime);
  });
  it("bounds spawning for the entire attempt including inactive templates", () => {
    const template = makeObject(3, "enemy", { active: false });
    const spawn: LogicAction = { type: "spawn", objectId: template.id };
    const value = level(
      [
        block(10, { type: "level-start" }, [
          ...Array.from({ length: 15 }, () => spawn),
          { type: "trigger", event: "next" },
        ]),
        block(11, { type: "custom", name: "next" }, [
          ...Array.from({ length: 15 }, () => spawn),
          { type: "trigger", event: "last" },
        ]),
        block(
          12,
          { type: "custom", name: "last" },
          Array.from({ length: 16 }, () => spawn),
        ),
      ],
      [template],
    );
    const player = tick(value);
    expect(player.spawns).toHaveLength(MAX_SPAWNS);
    expect(new Set(player.spawns.map((object) => object.id)).size).toBe(
      MAX_SPAWNS,
    );
    expect(player.logicWarning).toMatch(/spawn limit/);
    expect(player.spawns.every((object) => object.active)).toBe(true);
  });
  it("enforces a total action cap across an otherwise valid long run", () => {
    const value = level([
      block(10, { type: "level-start" }, [
        { type: "add-variable", variable: "score", amount: 1 },
        { type: "add-variable", variable: "score", amount: 1 },
      ]),
    ]);
    const player = tick(value, {
      ...initialPlayer(value),
      actionCount: MAX_TOTAL_ACTIONS - 1,
    });
    expect(player.variables.score).toBe(1);
    expect(player.logicHalted).toBe(true);
  });
  it("does not mutate the previous state and remains identical after JSON storage", () => {
    const value = level([
      block(10, { type: "level-start" }, [
        { type: "set-timer", timer: "alarm", seconds: 2 },
        { type: "give-item", item: "key", count: 1 },
      ]),
    ]);
    const initial = initialPlayer(value);
    const snapshot = JSON.stringify(initial);
    const first = tick(value, initial);
    expect(JSON.stringify(initial)).toBe(snapshot);
    expect(tick(value, JSON.parse(JSON.stringify(first)))).toEqual(
      tick(value, first),
    );
  });
  it("replays compressed inputs identically to individual fixed ticks", () => {
    const value = level();
    const frames = [
      { keys: ["ArrowRight"], ticks: 60 },
      { keys: [], ticks: 30 },
    ];
    let direct = initialPlayer(value);
    for (let index = 0; index < 90; index++)
      direct = stepPlayer(
        value,
        direct,
        new Set(index < 60 ? ["ArrowRight"] : []),
        FIXED_STEP,
      );
    expect(replayInputs(value, frames)).toEqual(direct);
  });
  it("rejects invalid or excessive replay input before executing it", () => {
    const value = level();
    expect(() => replayInputs(value, [{ keys: ["script"], ticks: 1 }])).toThrow(
      /Invalid/,
    );
    expect(() => replayInputs(value, [{ keys: [], ticks: 0 }])).toThrow(
      /Invalid/,
    );
    expect(() =>
      replayInputs(value, [{ keys: [], ticks: 100 }], { maxFrames: 99 }),
    ).toThrow(/tick limit/);
  });
});
describe("Creator object interactions and action effects", () => {
  it("emits zone entry once and exit after moving out", () => {
    const zone = makeObject(3, "trigger-zone", {
      x: 20,
      y: 400,
      width: 50,
      height: 100,
    });
    const value = level(
      [
        block(10, { type: "zone-enter", objectId: zone.id }, [
          { type: "add-variable", variable: "score", amount: 1 },
        ]),
        block(11, { type: "zone-exit", objectId: zone.id }, [
          { type: "show-text", text: "Exited" },
        ]),
      ],
      [zone],
    );
    let player = tick(value);
    player = tick(value, player);
    expect(player.variables.score).toBe(1);
    player = tick(value, { ...player, x: 100 });
    expect(player.text).toBe("Exited");
  });
  it("collects a key only once and triggers its authored event", () => {
    const key = makeObject(3, "collectible", {
      x: 32,
      y: 420,
      item: "gold_key",
    });
    const value = level(
      [
        block(10, { type: "collectible-obtained", objectId: key.id }, [
          { type: "add-variable", variable: "score", amount: 10 },
        ]),
      ],
      [key],
    );
    let player = tick(value);
    expect(player.items.gold_key).toBe(1);
    expect(player.variables.score).toBe(10);
    expect(player.destroyed).toContain(key.id);
    player = tick(value, player);
    expect(player.items.gold_key).toBe(1);
  });
  it("toggles switches and resolves pressure plates through legacy door controls", () => {
    const door = makeObject(3, "door"),
      control = makeObject(4, "switch", {
        x: 32,
        y: 440,
        width: 50,
        height: 20,
        targetIds: [door.id],
      });
    const value = level([], [door, control]);
    let player = tick(value, { ...initialPlayer(value), y: 412 });
    expect(doorIsOpen(value, door.id, player)).toBe(true);
    player = tick(value, { ...player, x: 150 });
    expect(doorIsOpen(value, door.id, player)).toBe(true);
  });
  it("teleports to the destination and prevents immediate return loops", () => {
    const first = makeObject(3, "teleporter", {
        x: 32,
        y: 420,
        targetId: id(4),
      }),
      second = makeObject(4, "teleporter", { x: 600, targetId: id(3) });
    const value = level([], [first, second]);
    let player = tick(value);
    expect(player.x).toBe(600);
    expect(player.teleporterCooldown).toBeGreaterThan(0);
    player = tick(value, player);
    expect(player.x).toBe(600);
  });
  it("stomps enemies, emits defeat and all-defeated events", () => {
    const enemy = makeObject(3, "enemy", { x: 32, y: 450, health: 1 });
    const value = level(
      [
        block(10, { type: "enemy-defeated", objectId: enemy.id }, [
          { type: "add-variable", variable: "score", amount: 1 },
        ]),
        block(11, { type: "all-enemies-defeated" }, [
          { type: "show-text", text: "Cleared" },
        ]),
      ],
      [enemy],
    );
    const player = tick(value, { ...initialPlayer(value), y: 421, vy: 120 });
    expect(player.enemies[enemy.id]).toBe(0);
    expect(player.destroyed).toContain(enemy.id);
    expect(player.variables.score).toBe(1);
    expect(player.text).toBe("Cleared");
  });
  it("damages players on enemy contact with an invulnerability interval", () => {
    const enemy = makeObject(3, "enemy", { x: 32, y: 420 });
    const value = level([], [enemy]);
    const player = tick(value);
    expect(player.health).toBe(75);
    expect(tick(value, player).health).toBe(75);
  });
  it("shows signs as safe text and supports objective and sound actions", () => {
    const sign = makeObject(3, "sign", {
      x: 32,
      y: 420,
      text: "<img onerror=evil()>",
    });
    const value = level(
      [
        block(10, { type: "level-start" }, [
          { type: "objective", text: "Collect the key" },
          { type: "sound", sound: "beep" },
        ]),
      ],
      [sign],
    );
    const player = tick(value);
    expect(player.text).toBe(sign.text);
    expect(player.objective).toBe("Collect the key");
    expect(player.sounds).toContain("beep");
  });
  it("retains variables and obtained items across checkpoint respawns", () => {
    const hazard = makeObject(3, "spikes", { x: 32, y: 420 });
    const value = level(
      [
        block(10, { type: "level-start" }, [
          { type: "set-variable", variable: "score", value: 5 },
          { type: "give-item", item: "key", count: 1 },
        ]),
        block(11, { type: "player-dies" }, [
          { type: "add-variable", variable: "score", amount: 1 },
        ]),
      ],
      [hazard],
    );
    const player = tick(value);
    expect(player.deaths).toBe(1);
    expect(player.variables.score).toBe(6);
    expect(player.items.key).toBe(1);
    expect(player.health).toBe(100);
  });
  it("supports authored movement, disabling, text, completion and failure", () => {
    const object = makeObject(3, "decoration");
    const value = level(
      [
        block(10, { type: "level-start" }, [
          { type: "move", objectId: object.id, x: 500, y: 300 },
          { type: "disable", objectId: object.id },
          { type: "complete" },
        ]),
      ],
      [object],
    );
    const player = tick(value);
    expect(player.positions[object.id]).toEqual({ x: 500, y: 300 });
    expect(player.active[object.id]).toBe(false);
    expect(player.won).toBe(true);
    expect(tick(value, player)).toBe(player);
    const failed = tick(
      level([block(11, { type: "level-start" }, [{ type: "fail" }])]),
    );
    expect(failed.failed).toBe(true);
  });
});
