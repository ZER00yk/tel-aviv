import { createHash } from "node:crypto";
import { z } from "zod";
import { TOWER_DEFS, TOWER_MAPS, type TowerKind } from "../config/tower";
import { GameRuleError } from "../server/rules";
import {
  actTower,
  actTowerDuringWave,
  advanceTowerWave,
  beginTowerWave,
  newTower,
  type TowerState,
  type TowerWaveSimulation,
} from "../server/tower";

export class DefenseRuleError extends Error {}
const towerKinds = Object.keys(TOWER_DEFS) as [TowerKind, ...TowerKind[]];
const envelope = {
  requestId: z.uuid(),
  revision: z.number().int().min(0).max(10_000),
};
const actionSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...envelope,
      type: z.literal("place"),
      kind: z.enum(towerKinds),
      x: z.number().int().min(0).max(7),
      y: z.number().int().min(0).max(4),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal("upgrade"),
      towerId: z.string().regex(/^\d{1,6}$/),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal("sell"),
      towerId: z.string().regex(/^\d{1,6}$/),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal("target"),
      towerId: z.string().regex(/^\d{1,6}$/),
      target: z.enum(["first", "strongest", "support"]),
    })
    .strict(),
  z.object({ ...envelope, type: z.literal("wave") }).strict(),
  z
    .object({
      ...envelope,
      type: z.literal("choose"),
      upgrade: z.enum(["power", "speed", "range", "fortify", "funding"]),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal("configure"),
      map: z.enum(["boulevard", "switchback", "crossroads"]),
      mode: z.enum(["campaign", "endless"]),
    })
    .strict(),
]);
interface DefenseResult {
  winners: string[];
  scores: Record<string, number>;
  reason: string;
}
export interface DefenseState {
  kind: "tower-defense";
  defense: TowerState;
  participantIds: string[];
  commandRevision: number;
  /** SQL commit order, excluded from client views and command schemas. */
  checkpointSerial?: number;
  receipts: Record<string, { id: string; fingerprint: string }[]>;
  lastTick: number;
  simulation?: TowerWaveSimulation;
  result?: DefenseResult;
}
export function createDefenseState(
  playerIds: string[],
  now = Date.now(),
): DefenseState {
  if (
    playerIds.length < 2 ||
    playerIds.length > 4 ||
    new Set(playerIds).size !== playerIds.length
  )
    throw new DefenseRuleError(
      "Live defense needs two to four distinct players.",
    );
  return {
    kind: "tower-defense",
    defense: newTower(),
    participantIds: [...playerIds],
    commandRevision: 0,
    receipts: Object.fromEntries(playerIds.map((id) => [id, []])),
    lastTick: now,
  };
}
export function applyDefenseAction(
  state: DefenseState,
  userId: string,
  hostId: string,
  payload: unknown,
  now = Date.now(),
) {
  if (!state.participantIds.includes(userId))
    throw new DefenseRuleError("Join this defense first.");
  const parsed = actionSchema.safeParse(payload);
  if (!parsed.success) throw new DefenseRuleError("Invalid defense command.");
  const input = parsed.data;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  const receipt = state.receipts[userId].find(
    (entry) => entry.id === input.requestId,
  );
  if (receipt) {
    if (receipt.fingerprint !== fingerprint)
      throw new DefenseRuleError(
        "A request ID cannot be reused for another command.",
      );
    return;
  }
  if (state.result) throw new DefenseRuleError("The defense is complete.");
  if (input.revision !== state.commandRevision)
    throw new DefenseRuleError(
      "The defense changed. Review the latest state and try again.",
    );
  if (state.commandRevision >= 10_000)
    throw new DefenseRuleError("This defense reached its command limit.");
  try {
    if (input.type === "configure") {
      if (
        userId !== hostId ||
        state.defense.wave !== 0 ||
        state.defense.towers.length ||
        state.simulation
      )
        throw new DefenseRuleError(
          "Only the host can choose a map before building.",
        );
      state.defense = newTower({ map: input.map, mode: input.mode });
    } else if (input.type === "wave") {
      if (userId !== hostId)
        throw new DefenseRuleError("Only the host can send the next wave.");
      if (state.defense.phase !== "build" || !state.defense.towers.length)
        throw new DefenseRuleError(
          "Build at least one tower and choose any pending reward first.",
        );
      if (state.defense.wave >= 10_000)
        throw new DefenseRuleError("This defense reached its wave limit.");
      state.simulation = beginTowerWave(state.defense);
      state.lastTick = now;
    } else if (state.defense.phase === "wave") {
      actTowerDuringWave(state.defense, input.type, input);
      // Selling frees its cooldown entry without growing retained state.
      if (input.type === "sell" && state.simulation)
        delete state.simulation.cooldowns[input.towerId];
    } else actTower(state.defense, input.type, input);
  } catch (error) {
    if (error instanceof GameRuleError)
      throw new DefenseRuleError(error.message);
    throw error;
  }
  state.commandRevision++;
  state.receipts[userId].push({ id: input.requestId, fingerprint });
  if (state.receipts[userId].length > 32) state.receipts[userId].shift();
}
/** Server wall time only; a delayed worker performs at most one second of combat per tick. */
export function tickDefense(state: DefenseState, now = Date.now()): boolean {
  if (state.result || !state.simulation || state.simulation.finished)
    return false;
  const elapsed = Math.max(0, now - state.lastTick);
  const steps = Math.min(5, Math.floor(elapsed / 200));
  if (!steps) return false;
  state.lastTick = elapsed > 1000 ? now : state.lastTick + steps * 200;
  if (advanceTowerWave(state.defense, state.simulation, steps)) {
    delete state.simulation;
    // A completed wave changes available commands, independent of simulation updates.
    state.commandRevision++;
    if (state.defense.phase === "won" || state.defense.phase === "lost") {
      state.result = {
        winners: state.defense.phase === "won" ? [...state.participantIds] : [],
        scores: Object.fromEntries(
          state.participantIds.map((id) => [id, state.defense.kills]),
        ),
        reason:
          state.defense.phase === "won"
            ? "All 20 live waves defended"
            : "The city defense was breached",
      };
    }
  }
  return true;
}
/** Explicit public fields exclude schedules, cooldowns, replay receipts and server timestamps. */
export function defenseView(state: DefenseState) {
  const d = state.defense,
    s = state.simulation;
  const time = (s?.tick ?? 0) * 0.2;
  return {
    kind: state.kind,
    commandRevision: state.commandRevision,
    map: d.map ?? "boulevard",
    mode: d.mode ?? "campaign",
    phase: d.phase,
    wave: s?.wave ?? d.wave,
    cash: d.cash,
    lives: Math.max(0, d.lives - (s?.leaks ?? 0)),
    kills: d.kills + (s?.kills ?? 0),
    towers: d.towers.map(({ id, kind, x, y, level, target }) => ({
      id,
      kind,
      x,
      y,
      level,
      target,
    })),
    upgrades: [...d.upgrades],
    offeredUpgrades: [...d.offeredUpgrades],
    enemies: (s?.enemies ?? [])
      .filter((e) => !e.dead && e.spawn <= time)
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        x: e.x,
        y: e.y,
        hp: Math.max(0, e.hp),
        maxHp: e.maxHp,
        shield: Math.max(0, e.shield),
        bossName: e.bossName,
        slowed: e.slowUntil > time,
        burning: e.burnUntil > time,
        marked: e.markedUntil > time,
      })),
    events: (s?.events ?? [])
      .filter((e) => e.time >= time - 0.8)
      .slice(-32)
      .map((e) => ({ ...e })),
    remaining: (s?.enemies ?? []).filter((e) => !e.dead).length,
    lastWave: d.lastWave
      ? {
          kills: d.lastWave.kills,
          leaks: d.lastWave.leaks,
          reward: d.lastWave.reward,
          synergyHits: d.lastWave.synergyHits,
        }
      : undefined,
    result: state.result
      ? {
          winners: [...state.result.winners],
          scores: { ...state.result.scores },
          reason: state.result.reason,
        }
      : undefined,
  };
}
export type DefenseView = ReturnType<typeof defenseView>;
export const defenseMapNames = Object.fromEntries(
  Object.entries(TOWER_MAPS).map(([id, map]) => [id, map.name]),
);
