import type {
  LevelData,
  LogicAction,
  LogicCondition,
  LogicEvent,
  Scalar,
} from "./schema";
import {
  doorIsOpen,
  objectIsActive,
  runtimeObjects,
  MAX_SPAWNS,
  MAX_EVENTS_PER_TICK,
  MAX_ACTIONS_PER_TICK,
  MAX_TOTAL_ACTIONS,
  type PlayerState,
} from "./state";
function compare(
  left: Scalar | undefined,
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte",
  right: Scalar,
) {
  if (operator === "eq") return left === right;
  if (operator === "ne") return left !== right;
  if (typeof left !== "number" || typeof right !== "number") return false;
  switch (operator) {
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
  }
}
function random(player: PlayerState) {
  player.rng = (Math.imul(player.rng, 1664525) + 1013904223) >>> 0;
  return player.rng / 0x100000000;
}
function matchesCondition(
  level: LevelData,
  player: PlayerState,
  condition: LogicCondition,
): boolean {
  switch (condition.type) {
    case "and":
      return condition.conditions.every((child) =>
        matchesCondition(level, player, child),
      );
    case "or":
      return condition.conditions.some((child) =>
        matchesCondition(level, player, child),
      );
    case "variable":
      return compare(
        player.variables[condition.variable],
        condition.operator,
        condition.value,
      );
    case "item":
      return (player.items[condition.item] ?? 0) >= condition.count;
    case "health":
      return compare(player.health, condition.operator, condition.value);
    case "player-count":
      return compare(1, condition.operator, condition.value);
    case "timer":
      return (
        (player.timers[condition.timer]?.state ?? "idle") === condition.state
      );
    case "chance":
      return random(player) * 100 < condition.percent;
    case "door-open":
      return doorIsOpen(level, condition.objectId, player) === condition.value;
    case "enemy-alive":
      return (
        ((player.enemies[condition.objectId] ?? 0) > 0 &&
          !player.destroyed.includes(condition.objectId)) === condition.value
      );
    case "object-active": {
      const object = runtimeObjects(level, player).find(
        (entry) => entry.id === condition.objectId,
      );
      return (
        Boolean(object && objectIsActive(object, player)) === condition.value
      );
    }
  }
}
function matchesEvent(expected: LogicEvent, actual: LogicEvent) {
  if (expected.type !== actual.type) return false;
  if ("objectId" in expected)
    return "objectId" in actual && expected.objectId === actual.objectId;
  if ("variable" in expected)
    return (
      "variable" in actual &&
      expected.variable === actual.variable &&
      (expected.type !== "variable-reaches" || expected.value === actual.value)
    );
  if ("timer" in expected)
    return "timer" in actual && expected.timer === actual.timer;
  if (expected.type === "custom")
    return actual.type === "custom" && expected.name === actual.name;
  return true;
}
function halt(player: PlayerState, reason: string) {
  player.logicHalted = true;
  player.logicWarning = reason;
}
export function queueEvent(
  player: PlayerState,
  queue: LogicEvent[],
  event: LogicEvent,
  level?: LevelData,
) {
  if (
    level &&
    !(level.logic ?? []).some(
      (block) => block.enabled !== false && matchesEvent(block.event, event),
    )
  )
    return;
  if (queue.length < MAX_EVENTS_PER_TICK) queue.push(event);
  else halt(player, "Logic event limit reached; simplify the event chain.");
}
function executeAction(
  level: LevelData,
  player: PlayerState,
  action: LogicAction,
  queue: LogicEvent[],
) {
  const findObject = (id: string) =>
    runtimeObjects(level, player).find((object) => object.id === id);
  const emit = (event: LogicEvent) => queueEvent(player, queue, event, level);
  const changeVariable = (name: string, value: Scalar) => {
    const old = player.variables[name];
    if (old === value) return;
    player.variables[name] = value;
    emit({ type: "variable-changed", variable: name, value });
    emit({ type: "variable-reaches", variable: name, value });
  };
  switch (action.type) {
    case "enable":
      player.active[action.objectId] = true;
      break;
    case "disable":
      player.active[action.objectId] = false;
      break;
    case "toggle": {
      const object = findObject(action.objectId);
      if (object)
        player.active[action.objectId] = !objectIsActive(object, player);
      break;
    }
    case "open-door":
      player.doors[action.objectId] = true;
      break;
    case "close-door":
      player.doors[action.objectId] = false;
      break;
    case "move":
      player.positions[action.objectId] = { x: action.x, y: action.y };
      break;
    case "teleport":
      player.x = Math.min(level.width - 20, action.x);
      player.y = Math.min(level.height - 28, action.y);
      player.vx = 0;
      player.vy = 0;
      player.supportId = null;
      player.vehicleId = null;
      break;
    case "spawn": {
      if (player.spawns.length >= MAX_SPAWNS) {
        player.logicWarning = "The 32-object spawn limit was reached.";
        break;
      }
      const original = findObject(action.objectId);
      if (original) {
        if (
          (original.type === "explosive" || original.type === "cart") &&
          runtimeObjects(level, player).filter(
            (object) =>
              object.type === original.type && objectIsActive(object, player),
          ).length >= (original.type === "cart" ? 16 : 32)
        ) {
          player.logicWarning =
            "The active vehicle or explosive limit was reached.";
          break;
        }
        const clone = {
          ...original,
          id: original.id + ":spawn:" + (player.spawns.length + 1),
          active: true,
          templateId: original.id,
        };
        player.spawns.push(clone);
        if (clone.type === "enemy")
          player.enemies[clone.id] = clone.health ?? 3;
      }
      break;
    }
    case "destroy":
      if (!player.destroyed.includes(action.objectId)) {
        player.destroyed.push(action.objectId);
        emit({ type: "object-destroyed", objectId: action.objectId });
        if (findObject(action.objectId)?.type === "enemy") {
          player.enemies[action.objectId] = 0;
          emit({ type: "enemy-defeated", objectId: action.objectId });
        }
      }
      break;
    case "damage":
      player.health = Math.max(0, player.health - action.amount);
      break;
    case "heal":
      player.health = Math.min(100, player.health + action.amount);
      break;
    case "give-item":
      if (Object.keys(player.items).length < 32 || action.item in player.items)
        player.items[action.item] = Math.min(
          999,
          (player.items[action.item] ?? 0) + action.count,
        );
      break;
    case "remove-item":
      if (Object.keys(player.items).length < 32 || action.item in player.items)
        player.items[action.item] = Math.max(
          0,
          (player.items[action.item] ?? 0) - action.count,
        );
      break;
    case "show-text":
      player.text = action.text;
      break;
    case "objective":
      player.objective = action.text;
      break;
    case "sound":
      if (player.sounds.length < 8) player.sounds.push(action.sound);
      break;
    case "set-variable":
      changeVariable(action.variable, action.value);
      break;
    case "add-variable": {
      const value = player.variables[action.variable];
      if (typeof value === "number")
        changeVariable(
          action.variable,
          Math.max(-1_000_000, Math.min(1_000_000, value + action.amount)),
        );
      break;
    }
    case "set-timer":
      if (
        Object.keys(player.timers).length < 32 ||
        action.timer in player.timers
      ) {
        player.timers[action.timer] = {
          remaining: action.seconds,
          state: "running",
        };
        emit({ type: "timer-starts", timer: action.timer });
      }
      break;
    case "trigger":
      emit({ type: "custom", name: action.event });
      break;
    case "complete":
      player.won = true;
      break;
    case "fail":
      player.failed = true;
      break;
    case "activate-checkpoint": {
      const object = findObject(action.objectId);
      if (object) {
        player.checkpoint = { x: object.x, y: Math.max(0, object.y - 30) };
        emit({ type: "checkpoint-reached", objectId: object.id });
      }
      break;
    }
  }
}
export function runLogic(
  level: LevelData,
  player: PlayerState,
  events: LogicEvent[],
  budget = { events: 0, actions: 0 },
) {
  if (player.logicHalted) return;
  for (let index = 0; index < events.length && !player.logicHalted; index++) {
    if (++budget.events > MAX_EVENTS_PER_TICK) {
      halt(player, "Logic event limit reached; simplify the event chain.");
      break;
    }
    for (const block of level.logic ?? []) {
      if (
        block.enabled === false ||
        !matchesEvent(block.event, events[index]) ||
        (block.condition && !matchesCondition(level, player, block.condition))
      )
        continue;
      for (const action of block.actions) {
        if (
          ++budget.actions > MAX_ACTIONS_PER_TICK ||
          ++player.actionCount > MAX_TOTAL_ACTIONS
        ) {
          halt(player, "Logic action limit reached; simplify the event chain.");
          break;
        }
        executeAction(level, player, action, events);
        if (player.logicHalted) break;
      }
      if (player.logicHalted) break;
    }
  }
}
