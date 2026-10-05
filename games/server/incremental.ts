import { GameRuleError } from "./rules";
export const MACHINE_DEFS = {
  extractor: { name: "Spark extractor", baseCost: 10, resource: "spark" },
  smelter: { name: "Alloy forge", baseCost: 60, resource: "spark" },
  lab: { name: "Insight laboratory", baseCost: 160, resource: "alloy" },
} as const;
export type Machine = keyof typeof MACHINE_DEFS;
export interface IncrementalState {
  spark: number;
  alloy: number;
  insight: number;
  machines: Record<Machine, number>;
  upgrades: { efficiency: number; automation: number };
  prestige: number;
  ascensions: number;
  totalProduced: number;
  lifetimeProduced: number;
  lastTick: number;
  offlineSeconds: number;
  tapWindow: number;
  taps: number;
}
export function newIncremental(now: number): IncrementalState {
  return {
    spark: 20,
    alloy: 0,
    insight: 0,
    machines: { extractor: 0, smelter: 0, lab: 0 },
    upgrades: { efficiency: 0, automation: 0 },
    prestige: 0,
    ascensions: 0,
    totalProduced: 0,
    lifetimeProduced: 0,
    lastTick: now,
    offlineSeconds: 0,
    tapWindow: now,
    taps: 0,
  };
}
export function advanceIncremental(
  state: IncrementalState,
  now: number,
): IncrementalState {
  const seconds = Math.min(
    8 * 3600,
    Math.max(0, (now - state.lastTick) / 1000),
  );
  state.offlineSeconds = seconds;
  state.lastTick = Math.max(state.lastTick, now);
  const multiplier =
    (1 + state.prestige * 0.25) *
    (1 + state.ascensions * 2) *
    (1 + state.upgrades.efficiency * 0.2);
  let remaining = seconds;
  while (remaining > 0) {
    const step = Math.min(30, remaining);
    const spark =
      (state.machines.extractor + state.upgrades.automation * 0.5) *
      multiplier *
      step;
    state.spark += spark;
    state.totalProduced += spark;
    state.lifetimeProduced += spark;
    const alloy = Math.min(
      state.spark / 3,
      state.machines.smelter * multiplier * 0.2 * step,
    );
    state.spark -= alloy * 3;
    state.alloy += alloy;
    const insight = Math.min(
      state.alloy / 2,
      state.machines.lab * multiplier * 0.025 * step,
    );
    state.alloy -= insight * 2;
    state.insight += insight;
    remaining -= step;
  }
  for (const key of [
    "spark",
    "alloy",
    "insight",
    "totalProduced",
    "lifetimeProduced",
  ] as const)
    state[key] = Math.min(1e15, Math.max(0, state[key]));
  return state;
}
export function machineCost(machine: Machine, owned: number) {
  return Math.ceil(MACHINE_DEFS[machine].baseCost * Math.pow(1.17, owned));
}
export function actIncremental(
  state: IncrementalState,
  action: string,
  payload: Record<string, unknown>,
  now: number,
) {
  advanceIncremental(state, now);
  switch (action) {
    case "state":
      break;
    case "tap": {
      if (now - state.tapWindow >= 1000) {
        state.tapWindow = now;
        state.taps = 0;
      }
      if (state.taps >= 10)
        throw new GameRuleError(
          "Take a breath: tapping is limited to ten per second.",
        );
      state.taps++;
      const amount = 1 + state.prestige * 0.25 + state.ascensions * 2;
      state.spark += amount;
      state.totalProduced += amount;
      state.lifetimeProduced += amount;
      break;
    }
    case "buy": {
      const machine = payload.machine as Machine;
      if (!Object.hasOwn(MACHINE_DEFS, machine))
        throw new GameRuleError("Unknown machine.");
      const quantity =
        payload.quantity === undefined ? 1 : Number(payload.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 25)
        throw new GameRuleError("Choose 1–25 machines.");
      if (machine === "lab" && state.machines.smelter < 1)
        throw new GameRuleError("Build an alloy forge first.");
      let cost = 0;
      for (let i = 0; i < quantity; i++)
        cost += machineCost(machine, state.machines[machine] + i);
      const resource = MACHINE_DEFS[machine].resource;
      if (!Number.isFinite(cost) || state[resource] < cost)
        throw new GameRuleError("Not enough resources.");
      state[resource] -= cost;
      state.machines[machine] += quantity;
      break;
    }
    case "upgrade": {
      const upgrade = payload.upgrade;
      if (upgrade !== "efficiency" && upgrade !== "automation")
        throw new GameRuleError("Unknown upgrade.");
      const cost =
        (upgrade === "efficiency" ? 5 : 3) *
        Math.pow(2, state.upgrades[upgrade]);
      const resource = upgrade === "efficiency" ? "alloy" : "insight";
      if (state[resource] < cost)
        throw new GameRuleError("Not enough resources.");
      state[resource] -= cost;
      state.upgrades[upgrade]++;
      break;
    }
    case "prestige": {
      const earned = Math.floor(Math.sqrt(state.totalProduced / 10000));
      if (earned < 1)
        throw new GameRuleError(
          "Produce 10,000 spark in this workshop before prestiging.",
        );
      const next = newIncremental(now);
      next.prestige = state.prestige + earned;
      next.ascensions = state.ascensions;
      next.lifetimeProduced = state.lifetimeProduced;
      return next;
    }
    case "ascend": {
      if (state.prestige < 10 || state.insight < 100)
        throw new GameRuleError(
          "Ascension requires ten prestige and 100 insight.",
        );
      const next = newIncremental(now);
      next.ascensions = state.ascensions + 1;
      next.lifetimeProduced = state.lifetimeProduced;
      return next;
    }
    default:
      throw new GameRuleError("Unknown incremental action.");
  }
  return state;
}
