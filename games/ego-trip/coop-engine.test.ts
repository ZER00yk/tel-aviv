import { describe, expect, it } from "vitest";
import {
  applyCoopAction,
  createCoopState,
  coopView,
  tickCoop,
  type CoopInput,
} from "./coop-engine";
import {
  applyGameAction,
  createLobby,
  lobbyView,
  playerLimits,
  startGame,
  tickGame,
} from "../../apps/realtime/src/engines";

const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
];
const input = (sequence = 0, override: Partial<CoopInput> = {}): CoopInput => ({
  type: "coop:input",
  sequence,
  dx: 0,
  dy: 0,
  aimX: 450,
  aimY: 160,
  fire: false,
  alternate: false,
  dash: false,
  revive: false,
  ...override,
});

describe("Ego Trip authoritative co-op", () => {
  it("requires a private 2–4 player ready lobby and guards membership", () => {
    expect(playerLimits("ego-trip")).toEqual({ min: 2, max: 4 });
    expect(() =>
      createLobby(
        { id: ids[0], username: "One" },
        "ego-trip",
        "public",
        "ABC234",
      ),
    ).toThrow("private");
    const lobby = createLobby(
      { id: ids[0], username: "One" },
      "ego-trip",
      "private",
      "ABC234",
      1000,
    );
    expect(() => startGame(lobby, 1000)).toThrow("2–4");
    lobby.players.push({
      id: ids[1],
      username: "Two",
      ready: false,
      connected: true,
    });
    expect(() => startGame(lobby, 1000)).toThrow("ready");
    lobby.players.forEach((p) => {
      p.ready = true;
    });
    startGame(lobby, 1000);
    expect(lobby.state?.kind).toBe("ego-trip");
    expect(() => applyGameAction(lobby, "outsider", input(), 1000)).toThrow(
      "Join",
    );
    expect(() => lobbyView(lobby, "outsider")).toThrow("Join");
    tickGame(lobby, 1250);
    expect(lobby.status).toBe("playing");
  });
  it("rejects forged fields, nonfinite input and replayed input; hides server internals", () => {
    const state = createCoopState(ids, 1000);
    expect(() =>
      applyCoopAction(
        state,
        ids[0],
        { ...input(), score: 999999, hp: 10000 },
        1000,
      ),
    ).toThrow();
    expect(() =>
      applyCoopAction(state, ids[0], input(0, { dx: Infinity }), 1000),
    ).toThrow();
    expect(() =>
      applyCoopAction(state, ids[0], input(0, { aimX: 9000 }), 1000),
    ).toThrow();
    applyCoopAction(state, ids[0], input(7), 1000);
    expect(() => applyCoopAction(state, ids[0], input(7), 1001)).toThrow(
      "Stale",
    );
    const view = coopView(state, ids[1]);
    expect(view).not.toHaveProperty("lastTick");
    expect(view.players[0]).not.toHaveProperty("input");
    expect(view.players[0]).not.toHaveProperty("sequence");
    expect(view.boss).not.toHaveProperty("attack");
    expect(view.yourSequence).toBe(-1);
  });
  it("normalizes diagonal movement and limits elapsed movement independent of input frequency", () => {
    const state = createCoopState(ids, 1000);
    const start = { ...state.players[ids[0]] };
    for (let i = 0; i < 100; i++)
      applyCoopAction(state, ids[0], input(i, { dx: 1, dy: -1 }), 1000);
    tickCoop(state, 1250, ids);
    const player = state.players[ids[0]];
    expect(Math.hypot(player.x - start.x, player.y - start.y)).toBeCloseTo(
      55,
      5,
    );
    tickCoop(state, 100_000, ids);
    expect(Math.hypot(player.x - start.x, player.y - start.y)).toBeCloseTo(
      55,
      5,
    );
    applyCoopAction(state, ids[0], input(100, { dx: 1 }), 100_000);
    tickCoop(state, 100_250, []);
    expect(Math.hypot(player.x - start.x, player.y - start.y)).toBeCloseTo(
      55,
      5,
    );
  });
  it("charges dash cooldown and server-resolved projectiles damage the shared boss for both players", () => {
    const state = createCoopState(ids, 1000);
    applyCoopAction(state, ids[0], input(0, { dx: 1, dash: true }), 1000);
    tickCoop(state, 1120, ids);
    expect(state.players[ids[0]].dashCooldown).toBeGreaterThan(1);
    const moved = state.players[ids[0]].x;
    applyCoopAction(state, ids[0], input(1, { dx: 1, dash: true }), 1120);
    tickCoop(state, 1240, ids);
    expect(state.players[ids[0]].x - moved).toBeLessThan(90);
    for (let frame = 0; frame < 45; frame++) {
      const now = 1240 + frame * 100;
      for (const id of ids)
        applyCoopAction(
          state,
          id,
          input(2 + frame, {
            fire: true,
            aimX: state.boss.x,
            aimY: state.boss.y,
          }),
          now,
        );
      tickCoop(state, now + 100, ids);
    }
    expect(state.boss.hp).toBeLessThan(state.boss.maxHp);
    expect(state.players[ids[0]].damage).toBeGreaterThan(0);
    expect(state.players[ids[1]].damage).toBeGreaterThan(0);
  });
  it("requires a living nearby sustained reviver and limits each player's rescues", () => {
    const state = createCoopState(ids, 1000);
    const downed = state.players[ids[1]];
    downed.status = "downed";
    downed.hp = 0;
    downed.downedUntil = 31000;
    state.players[ids[0]].x = 100;
    applyCoopAction(state, ids[0], input(0, { revive: true }), 1000);
    tickCoop(state, 1250, ids);
    expect(downed.reviveProgress).toBe(0);
    state.players[ids[0]].x = downed.x - 20;
    for (let i = 0; i < 9; i++) {
      applyCoopAction(
        state,
        ids[0],
        input(i + 1, { revive: true }),
        1250 + i * 250,
      );
      tickCoop(state, 1500 + i * 250, ids);
    }
    expect(downed.status).toBe("alive");
    expect(downed.hp).toBe(45);
    expect(downed.revives).toBe(1);
    downed.status = "downed";
    downed.downedUntil = 5000;
    state.lastTick = 4900;
    tickCoop(state, 5100, ids);
    expect(downed.status).toBe("eliminated");
  });
  it("transitions through four bosses, records only server damage and ends when the whole team is downed", () => {
    const state = createCoopState(ids, 1000);
    let now = 1000;
    // Fixtures shorten health, while kill, stage and results still use the simulation.
    for (let boss = 0; boss < 4; boss++) {
      state.boss.hp = 1;
      state.shots.push({
        id: 100 + boss,
        x:
          450 + Math.sin((state.elapsed + 0.04) * 0.65 + state.bossIndex) * 150,
        y: 155 + Math.cos((state.elapsed + 0.04) * 0.55) * 50,
        vx: 0,
        vy: 0,
        life: 1,
        radius: 20,
        damage: 9,
        ownerId: ids[boss % 2],
      });
      now += 40;
      tickCoop(state, now, ids);
      if (boss < 3) {
        expect(state.stage).toBe("intermission");
        for (const id of ids)
          applyCoopAction(state, id, { type: "coop:continue" }, now);
        now += 40;
        tickCoop(state, now, ids);
      }
    }
    expect(state.stage).toBe("won");
    expect(state.result?.winners).toEqual(ids);
    expect(Object.values(state.result!.scores).reduce((a, b) => a + b, 0)).toBe(
      4,
    );
    const lost = createCoopState(ids, 1000);
    for (const p of Object.values(lost.players)) p.status = "downed";
    tickCoop(lost, 1040, ids);
    expect(lost.result?.winners).toEqual([]);
    expect(lost.result?.reason).toContain("whole team");
  });
});
