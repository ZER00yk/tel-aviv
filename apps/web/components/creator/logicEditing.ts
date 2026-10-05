import type {
  LevelData,
  LevelObject,
  LogicAction,
  LogicCondition,
  LogicEvent,
  Variable,
} from "../../../../packages/platform/src/classes/models";

export const eventLabels: Record<LogicEvent["type"], string> = {
  "level-start": "Level starts",
  "zone-enter": "Player enters zone",
  "zone-exit": "Player exits zone",
  "object-touched": "Object touched",
  "button-pressed": "Button / switch pressed",
  "timer-starts": "Timer starts",
  "timer-expires": "Timer expires",
  "object-destroyed": "Object destroyed",
  "enemy-defeated": "Enemy defeated",
  "all-enemies-defeated": "All enemies defeated",
  "variable-changed": "Variable changes",
  "variable-reaches": "Variable reaches value",
  "checkpoint-reached": "Checkpoint reached",
  "player-dies": "Player dies",
  "collectible-obtained": "Collectible obtained",
  custom: "Named event triggered",
};
export const actionLabels: Record<LogicAction["type"], string> = {
  enable: "Enable object",
  disable: "Disable object",
  toggle: "Toggle object",
  "open-door": "Open door",
  "close-door": "Close door",
  move: "Move object",
  teleport: "Teleport player",
  spawn: "Spawn a copy of object",
  destroy: "Destroy object",
  damage: "Damage player",
  heal: "Heal player",
  "give-item": "Give item",
  "remove-item": "Remove item",
  "show-text": "Show text",
  objective: "Update objective",
  sound: "Play sound",
  "set-variable": "Set variable",
  "add-variable": "Increase / decrease variable",
  "set-timer": "Start timer",
  trigger: "Trigger named event",
  complete: "Complete level",
  fail: "Fail level",
  "activate-checkpoint": "Activate checkpoint",
};
export const conditionLabels: Record<LogicCondition["type"], string> = {
  variable: "Variable comparison",
  item: "Player has item",
  health: "Player health",
  "object-active": "Object is active / inactive",
  "door-open": "Door is open / closed",
  "enemy-alive": "Enemy is alive / defeated",
  "player-count": "Player count",
  timer: "Timer state",
  chance: "Bounded random chance",
  and: "All conditions (AND)",
  or: "Any condition (OR)",
};

export function objectLabel(object: LevelObject, objects: LevelObject[]) {
  const number =
    objects
      .filter((candidate) => candidate.type === object.type)
      .findIndex((candidate) => candidate.id === object.id) + 1;
  const name =
    object.label?.trim() || `${object.type.replaceAll("-", " ")} ${number}`;
  return `${name} · ${Math.round(object.x)}, ${Math.round(object.y)}`;
}

export function objectsForEvent(type: LogicEvent["type"], level: LevelData) {
  switch (type) {
    case "zone-enter":
    case "zone-exit":
      return level.objects.filter((object) => object.type === "trigger-zone");
    case "button-pressed":
      return level.objects.filter((object) =>
        ["button", "switch", "pressure-plate"].includes(object.type),
      );
    case "checkpoint-reached":
      return level.objects.filter((object) => object.type === "checkpoint");
    case "enemy-defeated":
      return level.objects.filter((object) => object.type === "enemy");
    case "collectible-obtained":
      return level.objects.filter((object) => object.type === "collectible");
    default:
      return level.objects;
  }
}

export function objectsForAction(type: LogicAction["type"], level: LevelData) {
  if (type === "open-door" || type === "close-door")
    return level.objects.filter((object) => object.type === "door");
  if (type === "activate-checkpoint")
    return level.objects.filter((object) => object.type === "checkpoint");
  return level.objects;
}

export function defaultEvent(
  type: LogicEvent["type"],
  level: LevelData,
): LogicEvent {
  switch (type) {
    case "level-start":
    case "player-dies":
    case "all-enemies-defeated":
      return { type };
    case "timer-starts":
    case "timer-expires":
      return { type, timer: "clock" };
    case "variable-changed":
      return { type, variable: level.variables?.[0]?.name ?? "score" };
    case "variable-reaches":
      return {
        type,
        variable: level.variables?.[0]?.name ?? "score",
        value: level.variables?.[0]?.initial ?? 1,
      };
    case "custom":
      return { type, name: "next_stage" };
    default:
      return { type, objectId: objectsForEvent(type, level)[0]?.id ?? "" };
  }
}

export function defaultAction(
  type: LogicAction["type"],
  level: LevelData,
): LogicAction {
  switch (type) {
    case "teleport":
      return { type, x: level.spawn.x, y: level.spawn.y };
    case "move":
      return { type, objectId: level.objects[0]?.id ?? "", x: 0, y: 0 };
    case "damage":
    case "heal":
      return { type, amount: 1 };
    case "give-item":
    case "remove-item":
      return { type, item: "key", count: 1 };
    case "show-text":
    case "objective":
      return {
        type,
        text:
          type === "show-text" ? "Welcome to the level!" : "Reach the goal.",
      };
    case "sound":
      return { type, sound: "beep" };
    case "set-variable":
      return {
        type,
        variable: level.variables?.[0]?.name ?? "score",
        value: level.variables?.[0]?.initial ?? 0,
      };
    case "add-variable":
      return {
        type,
        variable:
          level.variables?.find((variable) => variable.type === "number")
            ?.name ?? "score",
        amount: 1,
      };
    case "set-timer":
      return { type, timer: "clock", seconds: 5 };
    case "trigger":
      return { type, event: "next_stage" };
    case "complete":
    case "fail":
      return { type };
    default:
      return { type, objectId: objectsForAction(type, level)[0]?.id ?? "" };
  }
}

export function defaultCondition(
  type: LogicCondition["type"],
  level: LevelData,
): LogicCondition {
  switch (type) {
    case "variable":
      return {
        type,
        variable: level.variables?.[0]?.name ?? "score",
        operator: "eq",
        value: level.variables?.[0]?.initial ?? 0,
      };
    case "item":
      return { type, item: "key", count: 1 };
    case "health":
      return { type, operator: "gte", value: 1 };
    case "player-count":
      return { type, operator: "gte", value: 1 };
    case "timer":
      return { type, timer: "clock", state: "running" };
    case "chance":
      return { type, percent: 50 };
    case "and":
    case "or":
      return { type, conditions: [defaultCondition("health", level)] };
    default: {
      const object = level.objects.find((candidate) =>
        type === "door-open"
          ? candidate.type === "door"
          : type === "enemy-alive"
            ? candidate.type === "enemy"
            : true,
      );
      return { type, objectId: object?.id ?? "", value: true };
    }
  }
}

export function reorder<T>(values: T[], index: number, direction: -1 | 1) {
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= values.length)
    return values;
  const copy = [...values];
  [copy[index], copy[destination]] = [copy[destination], copy[index]];
  return copy;
}

/** Rename references atomically with the project variable; undo restores both. */
export function renameVariable(
  level: LevelData,
  previous: string,
  name: string,
): LevelData {
  function condition(value: LogicCondition): LogicCondition {
    if (value.type === "and" || value.type === "or")
      return { ...value, conditions: value.conditions.map(condition) };
    if (value.type === "variable" && value.variable === previous)
      return { ...value, variable: name };
    return value;
  }
  return {
    ...level,
    variables: (level.variables ?? []).map((variable) =>
      variable.name === previous ? { ...variable, name } : variable,
    ),
    logic: (level.logic ?? []).map((block) => ({
      ...block,
      event:
        "variable" in block.event && block.event.variable === previous
          ? { ...block.event, variable: name }
          : block.event,
      ...(block.condition ? { condition: condition(block.condition) } : {}),
      actions: block.actions.map((action) =>
        "variable" in action && action.variable === previous
          ? { ...action, variable: name }
          : action,
      ),
    })),
  };
}

export function defaultVariable(variables: Variable[]): Variable {
  let number = 1;
  while (variables.some((variable) => variable.name === `variable_${number}`))
    number++;
  return { name: `variable_${number}`, type: "number", initial: 0 };
}

export function logicReferenceErrors(level: LevelData) {
  const errors: { blockId: string; message: string }[] = [];
  const objectIds = new Set(level.objects.map((object) => object.id));
  const variableNames = new Set(
    (level.variables ?? []).map((variable) => variable.name),
  );
  function reference(
    value: LogicEvent | LogicAction | LogicCondition,
    blockId: string,
  ) {
    if ("objectId" in value && !objectIds.has(value.objectId))
      errors.push({
        blockId,
        message: `Missing scene object in ${value.type.replaceAll("-", " ")}. Select a replacement or delete this step.`,
      });
    if ("variable" in value && !variableNames.has(value.variable))
      errors.push({
        blockId,
        message: `Variable “${value.variable}” no longer exists. Select a replacement.`,
      });
    if ("conditions" in value)
      value.conditions.forEach((child) => reference(child, blockId));
  }
  for (const block of level.logic ?? []) {
    reference(block.event, block.id);
    if (block.condition) reference(block.condition, block.id);
    block.actions.forEach((action) => reference(action, block.id));
  }
  return errors;
}
