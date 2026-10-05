import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  actTower,
  simulateWave,
  newTower,
  beginTowerWave,
  advanceTowerWave,
  MAX_WAVE_TICKS,
} from "../server/tower";
import {
  createDefenseState,
  applyDefenseAction,
  tickDefense,
  defenseView,
  type DefenseState,
} from "./authority";
import {
  createLobby,
  startGame,
  applyGameAction,
  tickGame,
  lobbyView,
  resumeRecoveredLobby,
} from "../../apps/realtime/src/engines";
function command(
  state: DefenseState,
  type: string,
  payload: Record<string, unknown> = {},
  userId = "a",
  now = 1000,
) {
  const input = {
    type,
    ...payload,
    revision: state.commandRevision,
    requestId: randomUUID(),
  };
  applyDefenseAction(state, userId, "a", input, now);
  return input;
}
function live() {
  return createDefenseState(["a", "b"], 1000);
}
function resolve(state: DefenseState) {
  let now = state.lastTick;
  for (let tick = 0; state.simulation && tick < MAX_WAVE_TICKS; tick++)
    tickDefense(state, (now += 200));
}
describe("live authoritative defense", () => {
  it("uses the identical incremental combat kernel for solo and live waves on all maps", () => {
    for (const map of ["boulevard", "switchback", "crossroads"] as const) {
      for (const wave of [0, 4, 9, 14, 19]) {
        const solo = newTower({ map });
        solo.wave = wave;
        solo.cash = 10000;
        solo.lives = 200;
        actTower(solo, "place", { kind: "sniper", x: 0, y: 0 });
        actTower(solo, "place", { kind: "support", x: 1, y: 0 });
        const incremental = structuredClone(solo),
          sim = beginTowerWave(incremental);
        while (!advanceTowerWave(incremental, sim, 7)) {
          /* Fixed server steps. */
        }
        simulateWave(solo);
        expect(incremental).toEqual(solo);
      }
    }
  });
  it("leaves the wave running and allows a teammate's build to change its real outcome", () => {
    const early = live();
    command(early, "place", { kind: "rapid", x: 0, y: 0 });
    command(early, "wave");
    expect(early.defense.wave).toBe(0);
    expect(early.defense.lastWave).toBeUndefined();
    tickDefense(early, 2000);
    const baseline = structuredClone(early);
    command(early, "place", { kind: "rapid", x: 3, y: 1 }, "b", 2000);
    resolve(early);
    resolve(baseline);
    expect(early.defense.kills).toBeGreaterThan(baseline.defense.kills);
    expect(early.defense.lives).toBeGreaterThan(baseline.defense.lives);
  });
  it("applies upgrades, priorities and sales during real combat with shared funds", () => {
    const s = live();
    command(s, "place", { kind: "rapid", x: 2, y: 1 });
    command(s, "wave");
    command(s, "upgrade", { towerId: "1" }, "b");
    expect(s.defense.cash).toBe(69);
    expect(s.defense.towers[0].level).toBe(2);
    command(s, "target", { towerId: "1", target: "strongest" }, "b");
    expect(s.defense.towers[0].target).toBe("strongest");
    command(s, "sell", { towerId: "1" }, "b");
    expect(s.defense.towers).toHaveLength(0);
    expect(s.defense.cash).toBe(117);
    expect(s.defense.phase).toBe("wave");
    resolve(s);
    expect(s.defense.lastWave?.leaks).toBe(6);
  });
  it("rejects forged outcomes, unknown commands, path placement, underfunding and non-members without mutation", () => {
    const s = live(),
      before = structuredClone(s);
    for (const payload of [
      { type: "wave", kills: 100000 },
      { type: "win" },
      { type: "place", kind: "rapid", x: 0, y: 2 },
      { type: "place", kind: "sniper", x: 0, y: 0, cash: 100000 },
    ])
      expect(() =>
        applyDefenseAction(s, "a", "a", {
          ...payload,
          revision: 0,
          requestId: randomUUID(),
        }),
      ).toThrow();
    expect(s).toEqual(before);
    expect(() =>
      command(s, "place", { kind: "rapid", x: 0, y: 0 }, "outsider"),
    ).toThrow(/Join/);
    command(s, "place", { kind: "sniper", x: 0, y: 0 });
    expect(() => command(s, "place", { kind: "heavy", x: 1, y: 0 })).toThrow(
      /cash/,
    );
    expect(s.defense.cash).toBe(40);
  });
  it("requires current command revision, accepts exact retries once and rejects altered request IDs", () => {
    const s = live(),
      input = command(s, "place", { kind: "rapid", x: 0, y: 0 });
    const after = structuredClone(s);
    applyDefenseAction(s, "a", "a", input);
    expect(s).toEqual(after);
    expect(() => applyDefenseAction(s, "a", "a", { ...input, x: 1 })).toThrow(
      /request ID/,
    );
    expect(() =>
      applyDefenseAction(s, "b", "a", { ...input, requestId: randomUUID() }),
    ).toThrow(/changed/);
    expect(s.defense.towers).toHaveLength(1);
    expect(s.defense.cash).toBe(105);
  });
  it("keeps simulation updates separate from build revisions and bounds catch-up after stalls", () => {
    const s = live();
    command(s, "place", { kind: "rapid", x: 0, y: 0 });
    command(s, "wave");
    const revision = s.commandRevision;
    tickDefense(s, 1_000_000);
    expect(s.simulation!.tick).toBe(5);
    expect(s.commandRevision).toBe(revision);
    expect(tickDefense(s, 1_000_050)).toBe(false);
    expect(s.simulation!.tick).toBe(5);
    expect(tickDefense(s, 1_000_200)).toBe(true);
    expect(s.simulation!.tick).toBe(6);
  });
  it("projects current positions and health without future spawns, timers or receipts", () => {
    const s = live();
    command(s, "place", { kind: "rapid", x: 0, y: 0 });
    command(s, "wave");
    tickDefense(s, 1200);
    s.checkpointSerial = 17;
    const v = defenseView(s);
    expect(v.enemies).toHaveLength(1);
    expect(v.remaining).toBe(6);
    for (const key of [
      "receipts",
      "lastTick",
      "simulation",
      "cooldowns",
      "seed",
      "participantIds",
      "checkpointSerial",
    ])
      expect(v).not.toHaveProperty(key);
    expect(v.enemies[0]).not.toHaveProperty("spawn");
    expect(v.enemies[0]).not.toHaveProperty("progress");
    expect(JSON.stringify(v).length).toBeLessThan(20_000);
  });
  it("permits only host map configuration before building and host wave start", () => {
    const s = live();
    expect(() =>
      command(s, "configure", { map: "crossroads", mode: "campaign" }, "b"),
    ).toThrow(/host/);
    command(s, "configure", { map: "crossroads", mode: "endless" });
    expect(s.defense.map).toBe("crossroads");
    command(s, "place", { kind: "rapid", x: 0, y: 0 });
    expect(() =>
      command(s, "configure", { map: "boulevard", mode: "campaign" }),
    ).toThrow(/before building/);
    expect(() => command(s, "wave", {}, "b")).toThrow(/host/);
  });
  it("freezes outages and resumes a checkpoint without advancing the wave or accepting hidden state", () => {
    const lobby = createLobby(
      { id: "a", username: "a" },
      "tower-defense",
      "private",
      "ABC234",
      1000,
    );
    lobby.players.push({
      id: "b",
      username: "b",
      ready: true,
      connected: true,
    });
    lobby.players[0].ready = true;
    startGame(lobby, 1000);
    const s = lobby.state as DefenseState;
    applyGameAction(
      lobby,
      "a",
      {
        type: "place",
        kind: "rapid",
        x: 0,
        y: 0,
        revision: 0,
        requestId: randomUUID(),
      },
      1000,
    );
    applyGameAction(
      lobby,
      "a",
      { type: "wave", revision: 1, requestId: randomUUID() },
      1000,
    );
    tickGame(lobby, 2000);
    const tick = s.simulation!.tick;
    lobby.recoveryPausedAt = 2000;
    expect(tickGame(lobby, 100_000)).toBe(false);
    resumeRecoveredLobby(lobby, 100_000);
    expect(s.simulation!.tick).toBe(tick);
    expect(tickGame(lobby, 100_100)).toBe(false);
    expect(tickGame(lobby, 100_200)).toBe(true);
    expect(s.simulation!.tick).toBe(tick + 1);
    const view = lobbyView(lobby, "b").state as ReturnType<typeof defenseView>;
    expect(view.kind).toBe("tower-defense");
    expect(view).not.toHaveProperty("receipts");
  });
  it("settles a cooperative campaign win entirely from server combat and once", () => {
    const s = live();
    s.defense.wave = 19;
    s.defense.cash = 100000;
    s.defense.lives = 200;
    for (let x = 0; x < 8; x++) {
      command(s, "place", { kind: "sniper", x, y: 1 });
      s.defense.towers.at(-1)!.level = 5;
    }
    command(s, "wave");
    resolve(s);
    expect(s.defense.phase).toBe("won");
    expect(s.result!.winners).toEqual(["a", "b"]);
    const settled = structuredClone(s);
    expect(tickDefense(s, 10_000_000)).toBe(false);
    expect(s).toEqual(settled);
  });
});
