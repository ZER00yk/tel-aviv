import { z } from "zod";

const uuid = z.string().uuid();
export const identifierSchema = z
  .string()
  .trim()
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/,
    "Use a letter followed by up to 39 letters, numbers, underscores or hyphens",
  )
  .refine(
    (value) => !(value in Object.prototype) && value !== "prototype",
    "Choose a name that is not reserved by the runtime",
  );
const scalar = z.union([
  z.boolean(),
  z.number().finite().min(-1_000_000).max(1_000_000),
  z.string().max(120),
]);
export type Scalar = z.infer<typeof scalar>;
export const variableSchema = z
  .object({
    name: identifierSchema,
    type: z.enum(["boolean", "number", "string"]),
    initial: scalar,
  })
  .strict()
  .superRefine((variable, context) => {
    if (typeof variable.initial !== variable.type)
      context.addIssue({
        code: "custom",
        message: "Variable initial value must match its type",
      });
  });
export type Variable = z.infer<typeof variableSchema>;

const objectEvents = [
  "zone-enter",
  "zone-exit",
  "object-touched",
  "button-pressed",
  "object-destroyed",
  "enemy-defeated",
  "checkpoint-reached",
  "collectible-obtained",
] as const;
export const eventSchema = z.union([
  z
    .object({
      type: z.enum(["level-start", "player-dies", "all-enemies-defeated"]),
    })
    .strict(),
  z.object({ type: z.enum(objectEvents), objectId: uuid }).strict(),
  z
    .object({
      type: z.enum(["timer-starts", "timer-expires"]),
      timer: identifierSchema,
    })
    .strict(),
  z
    .object({
      type: z.enum(["variable-changed", "variable-reaches"]),
      variable: identifierSchema,
      value: scalar.optional(),
    })
    .strict(),
  z.object({ type: z.literal("custom"), name: identifierSchema }).strict(),
]);
export type LogicEvent = z.infer<typeof eventSchema>;
const operator = z.enum(["eq", "ne", "gt", "gte", "lt", "lte"]);
const leafConditionSchema = z.union([
  z
    .object({
      type: z.literal("variable"),
      variable: identifierSchema,
      operator,
      value: scalar,
    })
    .strict(),
  z
    .object({
      type: z.literal("item"),
      item: identifierSchema,
      count: z.number().int().min(1).max(999),
    })
    .strict(),
  z
    .object({
      type: z.literal("health"),
      operator,
      value: z.number().int().min(0).max(100),
    })
    .strict(),
  z
    .object({
      type: z.enum(["object-active", "door-open", "enemy-alive"]),
      objectId: uuid,
      value: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("player-count"),
      operator,
      value: z.number().int().min(0).max(4),
    })
    .strict(),
  z
    .object({
      type: z.literal("timer"),
      timer: identifierSchema,
      state: z.enum(["running", "expired", "idle"]),
    })
    .strict(),
  z
    .object({ type: z.literal("chance"), percent: z.number().min(0).max(100) })
    .strict(),
]);
export type LogicCondition =
  | z.infer<typeof leafConditionSchema>
  | { type: "and" | "or"; conditions: LogicCondition[] };
// Construct a finite-depth schema rather than recursive parsing of arbitrary input.
function groupedCondition(
  child: z.ZodType<LogicCondition>,
): z.ZodType<LogicCondition> {
  return z.union([
    leafConditionSchema,
    z
      .object({
        type: z.enum(["and", "or"]),
        conditions: z.array(child).min(1).max(8),
      })
      .strict(),
  ]);
}
export const conditionSchema = groupedCondition(
  groupedCondition(groupedCondition(leafConditionSchema)),
);
export const actionSchema = z.union([
  z
    .object({
      type: z.enum([
        "enable",
        "disable",
        "toggle",
        "open-door",
        "close-door",
        "destroy",
        "activate-checkpoint",
      ]),
      objectId: uuid,
    })
    .strict(),
  z
    .object({
      type: z.literal("move"),
      objectId: uuid,
      x: z.number().min(0).max(2400),
      y: z.number().min(0).max(1400),
    })
    .strict(),
  z
    .object({
      type: z.literal("teleport"),
      x: z.number().min(0).max(2380),
      y: z.number().min(0).max(1372),
    })
    .strict(),
  z.object({ type: z.literal("spawn"), objectId: uuid }).strict(),
  z
    .object({
      type: z.enum(["damage", "heal"]),
      amount: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.enum(["give-item", "remove-item"]),
      item: identifierSchema,
      count: z.number().int().min(1).max(999),
    })
    .strict(),
  z
    .object({
      type: z.enum(["show-text", "objective"]),
      text: z.string().max(300),
    })
    .strict(),
  z
    .object({
      type: z.literal("sound"),
      sound: z.enum(["beep", "success", "danger"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("set-variable"),
      variable: identifierSchema,
      value: scalar,
    })
    .strict(),
  z
    .object({
      type: z.literal("add-variable"),
      variable: identifierSchema,
      amount: z.number().finite().min(-10000).max(10000),
    })
    .strict(),
  z
    .object({
      type: z.literal("set-timer"),
      timer: identifierSchema,
      seconds: z
        .number()
        .min(1 / 60)
        .max(600),
    })
    .strict(),
  z.object({ type: z.literal("trigger"), event: identifierSchema }).strict(),
  z.object({ type: z.enum(["complete", "fail"]) }).strict(),
]);
export type LogicAction = z.infer<typeof actionSchema>;
export const logicBlockSchema = z
  .object({
    id: uuid,
    label: z.string().trim().max(80),
    event: eventSchema,
    condition: conditionSchema.optional(),
    actions: z.array(actionSchema).min(1).max(16),
    enabled: z.boolean().optional(),
  })
  .strict();
export type LogicBlock = z.infer<typeof logicBlockSchema>;

export const objectTypes = [
  "platform",
  "moving-platform",
  "spikes",
  "spring",
  "checkpoint",
  "finish",
  "door",
  "button",
  "decoration",
  "trigger-zone",
  "collectible",
  "enemy",
  "sign",
  "teleporter",
  "switch",
  "pressure-plate",
  "slope",
  "angled-platform",
  "polygon-platform",
  "one-way-platform",
  "moving-hazard",
  "rotating-hazard",
  "cart",
  "explosive",
  "destructible",
] as const;
export const levelObjectSchema = z
  .object({
    id: uuid,
    type: z.enum(objectTypes),
    label: z.string().trim().max(80).optional(),
    active: z.boolean().optional(),
    x: z.number().finite().min(0).max(2400),
    y: z.number().finite().min(0).max(1400),
    width: z.number().finite().min(8).max(2400),
    height: z.number().finite().min(8).max(500),
    rotation: z.number().finite().min(-360).max(360).default(0),
    layer: z.number().int().min(0).max(5).default(0),
    motion: z
      .object({
        axis: z.enum(["x", "y"]),
        distance: z.number().finite().min(-800).max(800),
        periodSeconds: z.number().finite().min(1).max(30),
      })
      .strict()
      .optional(),
    targetIds: z.array(uuid).max(16).optional(),
    buttonMode: z.enum(["hold", "toggle"]).optional(),
    targetId: uuid.optional(),
    item: identifierSchema.optional(),
    text: z.string().max(300).optional(),
    health: z.number().int().min(1).max(20).optional(),
    slopeDirection: z.enum(["left", "right"]).optional(),
    // Coordinates are normalized to the object's dimensions, so resizing a
    // authored polygon preserves its shape. Only bounded convex shapes run.
    vertices: z
      .array(
        z
          .object({
            x: z.number().finite().min(0).max(1),
            y: z.number().finite().min(0).max(1),
          })
          .strict(),
      )
      .min(3)
      .max(8)
      .optional(),
    rotationSpeed: z.number().finite().min(-180).max(180).optional(),
    cartSpeed: z.number().finite().min(40).max(180).optional(),
    explosive: z
      .object({
        radius: z.number().finite().min(40).max(240),
        damage: z.number().int().min(1).max(100),
        force: z.number().finite().min(0).max(500),
        fuseSeconds: z.number().finite().min(0.25).max(10),
        trigger: z.enum(["contact", "interact"]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((object, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (
      ["moving-platform", "moving-hazard"].includes(object.type) !==
      Boolean(object.motion)
    )
      issue("Moving platforms and moving hazards require motion settings");
    if (
      !["button", "switch", "pressure-plate"].includes(object.type) &&
      (object.targetIds !== undefined || object.buttonMode !== undefined)
    )
      issue("Only controls can contain door connections");
    if (
      object.targetIds &&
      new Set(object.targetIds).size !== object.targetIds.length
    )
      issue("Control connections must be unique");
    if (object.targetId !== undefined && object.type !== "teleporter")
      issue("Only teleporters can contain a destination");
    if (object.health !== undefined && object.type !== "enemy")
      issue("Only enemies have health");
    if (object.slopeDirection !== undefined && object.type !== "slope")
      issue("Only slopes have a slope direction");
    if ((object.type === "polygon-platform") !== Boolean(object.vertices))
      issue("Only polygon platforms require a polygon shape");
    if (object.vertices) {
      let sign = 0;
      let area = 0;
      for (let i = 0; i < object.vertices.length; i++) {
        const a = object.vertices[i],
          b = object.vertices[(i + 1) % object.vertices.length],
          c = object.vertices[(i + 2) % object.vertices.length];
        area += a.x * b.y - b.x * a.y;
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (Math.hypot(b.x - a.x, b.y - a.y) < 0.02 || Math.abs(cross) < 0.0001)
          issue("Polygon edges must be distinct and have nonzero turns");
        const current = Math.sign(cross);
        if (sign && sign !== current)
          issue("Polygon must be convex with consistently ordered vertices");
        sign ||= current;
      }
      if (Math.abs(area) < 0.02) issue("Polygon area is too small");
      // A consistently turning star can still intersect itself; reject every
      // non-neighboring edge pair rather than relying on turn signs alone.
      const cross = (
        a: { x: number; y: number },
        b: { x: number; y: number },
        c: { x: number; y: number },
      ) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      for (let i = 0; i < object.vertices.length; i++)
        for (let j = i + 2; j < object.vertices.length; j++) {
          if (i === 0 && j === object.vertices.length - 1) continue;
          const a = object.vertices[i],
            b = object.vertices[(i + 1) % object.vertices.length],
            c = object.vertices[j],
            d = object.vertices[(j + 1) % object.vertices.length];
          if (
            cross(a, b, c) * cross(a, b, d) <= 0 &&
            cross(c, d, a) * cross(c, d, b) <= 0
          )
            issue("Polygon edges cannot intersect");
        }
    }
    if (object.rotationSpeed !== undefined && object.type !== "rotating-hazard")
      issue("Only rotating hazards have rotation speed");
    if (
      object.type === "rotating-hazard" &&
      Math.abs(object.rotationSpeed ?? 60) < 5
    )
      issue("A rotating hazard must rotate at least five degrees per second");
    if (
      ["moving-hazard", "rotating-hazard"].includes(object.type) &&
      (object.width > 240 || object.height > 240)
    )
      issue(
        "Hazard dimensions are limited to 240 pixels for fixed-step collision",
      );
    if (
      object.type === "moving-hazard" &&
      object.motion &&
      (Math.abs(object.motion.distance) > 300 ||
        object.motion.periodSeconds < 2)
    )
      issue(
        "Moving hazards travel at most 300 pixels over cycles of at least two seconds",
      );
    if (object.cartSpeed !== undefined && object.type !== "cart")
      issue("Only carts have drive speed");
    if (object.type === "cart" && object.rotation !== 0)
      issue("Rail carts must remain horizontal");
    if (object.type === "one-way-platform" && object.rotation !== 0)
      issue("One-way platforms must remain horizontal");
    if (object.explosive !== undefined && object.type !== "explosive")
      issue("Only explosives have blast settings");
  });
export type LevelObject = z.infer<typeof levelObjectSchema>;

export const levelSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    width: z.number().int().min(320).max(2400),
    height: z.number().int().min(240).max(1400),
    spawn: z
      .object({
        x: z.number().min(0).max(2400),
        y: z.number().min(0).max(1400),
      })
      .strict(),
    objects: z.array(levelObjectSchema).max(300),
    variables: z.array(variableSchema).max(32).optional(),
    logic: z.array(logicBlockSchema).max(64).optional(),
    seed: z.number().int().min(0).max(0xffffffff).optional(),
  })
  .strict()
  .superRefine((level, context) => {
    const issue = (message: string, path: (string | number)[] = []) =>
      context.addIssue({ code: "custom", message, path });
    const objects = new Map(level.objects.map((object) => [object.id, object]));
    if (objects.size !== level.objects.length)
      issue("Object IDs must be unique");
    if (
      level.objects.filter((object) => object.type === "explosive").length > 32
    )
      issue("A level supports at most 32 explosives");
    if (level.objects.filter((object) => object.type === "cart").length > 16)
      issue("A level supports at most 16 rail carts");
    if (level.spawn.x >= level.width || level.spawn.y >= level.height)
      issue("Spawn must be inside the level");
    const variables = new Map(
      (level.variables ?? []).map((variable) => [variable.name, variable]),
    );
    if (variables.size !== (level.variables?.length ?? 0))
      issue("Variable names must be unique");
    if (
      new Set(level.logic?.map((block) => block.id)).size !==
      (level.logic?.length ?? 0)
    )
      issue("Logic block IDs must be unique");
    let nodes = 0;
    const checkVariable = (name: string, value?: Scalar, numeric = false) => {
      const variable = variables.get(name);
      if (!variable) issue(`Unknown variable: ${name}`);
      else if (numeric && variable.type !== "number")
        issue(`Variable ${name} must be numeric`);
      else if (value !== undefined && typeof value !== variable.type)
        issue(`Value must match variable ${name}`);
    };
    const checkReference = (id: string, expected?: string) => {
      const object = objects.get(id);
      if (!object) issue(`Broken object reference: ${id}`);
      else if (expected && object.type !== expected)
        issue(`Reference must point to ${expected}`);
    };
    const checkCondition = (condition: LogicCondition) => {
      nodes++;
      if (condition.type === "and" || condition.type === "or") {
        for (const child of condition.conditions) checkCondition(child);
        return;
      }
      if (condition.type === "variable")
        checkVariable(
          condition.variable,
          condition.value,
          !["eq", "ne"].includes(condition.operator),
        );
      if ("objectId" in condition)
        checkReference(
          condition.objectId,
          condition.type === "door-open"
            ? "door"
            : condition.type === "enemy-alive"
              ? "enemy"
              : undefined,
        );
    };
    for (const object of level.objects) {
      if (
        object.x + object.width > level.width ||
        object.y + object.height > level.height
      )
        issue("Objects must be inside the level");
      if (object.motion) {
        const end = object[object.motion.axis] + object.motion.distance;
        const size = object.motion.axis === "x" ? object.width : object.height;
        const limit = object.motion.axis === "x" ? level.width : level.height;
        if (end < 0 || end + size > limit)
          issue("The full moving-platform path must stay inside the level");
      }
      for (const id of object.targetIds ?? []) checkReference(id, "door");
      if (object.targetId) {
        checkReference(object.targetId, "teleporter");
        if (object.targetId === object.id)
          issue("Teleporter destination must be a different object");
      }
    }
    for (const [index, block] of (level.logic ?? []).entries()) {
      if ("objectId" in block.event) {
        const eventType = block.event.type;
        checkReference(
          block.event.objectId,
          eventType === "zone-enter" || eventType === "zone-exit"
            ? "trigger-zone"
            : eventType === "enemy-defeated"
              ? "enemy"
              : eventType === "checkpoint-reached"
                ? "checkpoint"
                : eventType === "collectible-obtained"
                  ? "collectible"
                  : undefined,
        );
        if (
          eventType === "button-pressed" &&
          objects.has(block.event.objectId) &&
          !["button", "switch", "pressure-plate"].includes(
            objects.get(block.event.objectId)!.type,
          )
        )
          issue(
            "Button events must reference a button, switch or pressure plate",
          );
      }
      if ("variable" in block.event)
        checkVariable(block.event.variable, block.event.value);
      if (
        block.event.type === "variable-reaches" &&
        block.event.value === undefined
      )
        issue("Variable-reaches events require a value");
      if (block.condition) checkCondition(block.condition);
      for (const action of block.actions) {
        nodes++;
        if ("objectId" in action)
          checkReference(
            action.objectId,
            action.type === "open-door" || action.type === "close-door"
              ? "door"
              : action.type === "activate-checkpoint"
                ? "checkpoint"
                : undefined,
          );
        if (action.type === "set-variable")
          checkVariable(action.variable, action.value);
        if (action.type === "add-variable")
          checkVariable(action.variable, undefined, true);
        if (
          (action.type === "move" || action.type === "teleport") &&
          (action.x >= level.width || action.y >= level.height)
        )
          issue("Action destination must be inside the level", [
            "logic",
            index,
          ]);
        if (action.type === "move") {
          const target = objects.get(action.objectId);
          if (
            target &&
            (action.x + target.width > level.width ||
              action.y + target.height > level.height)
          )
            issue("Moved object must stay inside level");
          if (target?.motion) {
            const axis = target.motion.axis;
            const start = axis === "x" ? action.x : action.y;
            const end = start + target.motion.distance;
            const size = axis === "x" ? target.width : target.height;
            const limit = axis === "x" ? level.width : level.height;
            if (end < 0 || end + size > limit)
              issue("Moved platform's full path must stay inside the level");
          }
        }
      }
    }
    if (nodes > 1024) issue("Level logic exceeds 1024 condition/action nodes");
  });
export type LevelData = z.infer<typeof levelSchema>;
export type NormalizedLevel = LevelData & {
  schemaVersion: 2;
  variables: Variable[];
  logic: LogicBlock[];
  seed: number;
};
export function normalizeLevel(input: LevelData): NormalizedLevel {
  const level = levelSchema.parse(input);
  return {
    ...level,
    schemaVersion: 2,
    variables: level.variables ?? [],
    logic: level.logic ?? [],
    seed: level.seed ?? 1,
  };
}
export function starterLevel(): LevelData {
  return {
    schemaVersion: 1,
    width: 960,
    height: 540,
    spawn: { x: 32, y: 420 },
    objects: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        type: "platform",
        x: 0,
        y: 500,
        width: 960,
        height: 40,
        rotation: 0,
        layer: 0,
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        type: "finish",
        x: 880,
        y: 440,
        width: 40,
        height: 60,
        rotation: 0,
        layer: 0,
      },
    ],
  };
}
