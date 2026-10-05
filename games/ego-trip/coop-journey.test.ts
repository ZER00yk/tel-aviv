import { describe, expect, it } from "vitest";
import {
  applyCoopAction,
  coopView,
  createCoopState,
  departCoop,
  tickCoop,
  type CoopState,
} from "./coop-engine";
import { journeyStageDefinition } from "./journey";

const ids = ["a", "b"];
function harness(seed = 51) {
  let now = 1000;
  let state = createCoopState(ids, now, "campaign", seed);
  for (const player of Object.values(state.players))
    player.invulnerable = 10000;
  const input = (id: string, overrides = {}) => {
    applyCoopAction(
      state,
      id,
      {
        type: "coop:input",
        sequence: state.players[id].sequence + 1,
        dx: 0,
        dy: 0,
        aimX: 450,
        aimY: 160,
        fire: false,
        alternate: false,
        dash: false,
        revive: false,
        ...overrides,
      },
      now,
    );
  };
  const tick = (connected = ids, ms = 40) => {
    now += ms;
    tickCoop(state, now, connected);
  };
  const clearPatrol = () => {
    // Only canonical fixture enemies are shortened; progress still follows the
    // real objective rules and never accepts a client checkpoint/HP claim.
    for (const enemy of state.campaign!.enemies) enemy.hp = 0;
    tick();
  };
  const touch = (id = "a", connected = ids) => {
    const objective = state.campaign!.objective!;
    state.players[id].x = objective.x;
    state.players[id].y = objective.y;
    input(id);
    tick(connected);
  };
  const completeMissions = () => {
    let attempts = 0;
    while (
      state.stage === "fight" &&
      state.campaign!.journey!.stage <= state.campaign!.journey!.stages
    ) {
      expect(attempts++).toBeLessThan(100);
      clearPatrol();
      if (state.campaign!.objective) touch();
    }
  };
  const advance = (route = 0) => {
    if (state.campaign!.sharedEvent && !state.campaign!.sharedEvent.resolved) {
      for (const id of ids)
        applyCoopAction(state, id, { type: "coop:event-vote", option: 0 }, now);
      tick();
    }
    for (const id of ids)
      applyCoopAction(state, id, { type: "coop:continue" }, now);
    tick();
    if (state.stage === "choice") {
      for (const id of ids)
        applyCoopAction(state, id, { type: "coop:vote", option: route }, now);
      tick();
    }
  };
  const bossRoom = () => {
    completeMissions();
    advance(); // route room
    completeMissions();
    advance(); // district event stop
    advance(); // district pressure room
    completeMissions();
    advance();
    expect(state.campaign!.room.kind).toBe("boss");
  };
  return {
    get state() {
      return state;
    },
    restore() {
      state = JSON.parse(JSON.stringify(state)) as CoopState;
    },
    input,
    tick,
    clearPatrol,
    touch,
    completeMissions,
    advance,
    bossRoom,
  };
}

describe("active synchronized Ego journey", () => {
  it("opts new campaigns into mixed missions while keeping missing-flag checkpoints and gauntlets compact", () => {
    const journey = createCoopState(ids, 1000, "campaign", 51);
    const compact = createCoopState(ids, 1000, "campaign", 51, "legacy");
    expect(journey.campaign!.pacingVersion).toBe(1);
    expect(journey.campaign!.journey).toEqual({
      stage: 1,
      stages: 3,
      bossPhase: 1,
      completedStages: 0,
    });
    expect(journey.campaign!.enemies).toHaveLength(8);
    expect(
      new Set(journey.campaign!.enemies.map((enemy) => enemy.kind)).size,
    ).toBe(4);
    expect(compact.campaign!.pacingVersion).toBeUndefined();
    expect(compact.campaign!.journey).toBeUndefined();
    expect(compact.campaign!.enemies).toHaveLength(5);
    expect(createCoopState(ids, 1000).campaign).toBeUndefined();
  });

  it("requires actual checkpoints after combat and cannot finish by waiting or submitting a claimed objective", () => {
    const h = harness();
    h.clearPatrol();
    expect(h.state.campaign!.objective!.kind).toBe("parcel");
    for (let i = 0; i < 100; i++) h.tick(ids, 500);
    expect(h.state.stage).toBe("fight");
    expect(h.state.campaign!.journey!.stage).toBe(1);
    expect(h.state.campaign!.objective!.progress).toBe(0);
    expect(() =>
      applyCoopAction(h.state, "a", { type: "coop:continue" }, 60000),
    ).toThrow("Finish");
    expect(() =>
      applyCoopAction(
        h.state,
        "a",
        { type: "coop:objective", progress: 99 },
        60000,
      ),
    ).toThrow("Unknown");
  });

  it("binds a carried parcel to its owner, disables carrier dash, and drops it for another living teammate", () => {
    const h = harness();
    h.clearPatrol();
    h.touch();
    const objective = h.state.campaign!.objective!;
    expect(objective.progress).toBe(1);
    expect(objective.carrierId).toBe("a");
    expect(objective.carrying).toBe(true);
    h.touch("b");
    expect(objective.progress).toBe(1);
    h.state.players.a.x = 90;
    h.state.players.a.y = 80;
    const before = h.state.players.a.x;
    h.input("a", { dx: 1, dash: true });
    h.tick();
    expect(h.state.players.a.x - before).toBeCloseTo(185 * 0.04);
    expect(h.state.players.a.dashCooldown).toBe(0);
    h.restore();
    h.tick(["b"]);
    expect(h.state.campaign!.objective!.dropped).toBe(true);
    expect(h.state.campaign!.objective!.progress).toBe(1);
    h.touch("b", ["b"]);
    expect(h.state.campaign!.objective!.carrierId).toBe("b");
    expect(h.state.campaign!.objective!.progress).toBe(1);
    h.touch("b");
    expect(h.state.campaign!.objective!.progress).toBe(2);
  });

  it("keeps survey order on one guide and emits no future landmarks, patrol seeds or another player's rewards", () => {
    const h = harness();
    h.clearPatrol();
    for (let point = 0; point < 4; point++) h.touch();
    h.clearPatrol();
    h.touch(); // the second mission is a ward survey
    const objective = h.state.campaign!.objective!;
    expect(objective.kind).toBe("ward");
    expect(objective.progress).toBe(1);
    h.touch("b");
    expect(objective.progress).toBe(1);
    const view = coopView(h.state, "b");
    expect(view.campaign).not.toHaveProperty("seed");
    expect(view.campaign!.objective).not.toHaveProperty("guideId");
    expect(view.campaign!.objective).not.toHaveProperty("checkpoints");
    expect(view.players[0]).not.toHaveProperty("upgrades");
    expect(view.campaign!.journey!.completedStages).toBe(1);
  });

  it("requires escort travel and resolves a bounded ambush before further delivery progress", () => {
    const h = harness();
    h.clearPatrol();
    for (let point = 0; point < 4; point++) h.touch();
    h.clearPatrol();
    for (let point = 0; point < 3; point++) h.touch();
    h.clearPatrol();
    expect(h.state.campaign!.objective!.kind).toBe("escort");
    h.touch();
    h.touch();
    expect(h.state.campaign!.enemies).toHaveLength(2);
    expect(h.state.campaign!.objective!.progress).toBe(2);
    h.touch();
    expect(h.state.campaign!.objective!.progress).toBe(2);
    h.clearPatrol();
    expect(h.state.campaign!.objective!.progress).toBe(3);
    expect(h.state.campaign!.enemies).toHaveLength(0);
  });

  it("preserves in-flight carrier ownership and mission state when everybody disconnects", () => {
    const h = harness();
    h.clearPatrol();
    h.touch();
    h.restore();
    const mission = JSON.stringify({
      journey: h.state.campaign!.journey,
      objective: h.state.campaign!.objective,
      enemies: h.state.campaign!.enemies,
    });
    const elapsed = h.state.elapsed;
    h.tick([], 60000);
    expect(
      JSON.stringify({
        journey: h.state.campaign!.journey,
        objective: h.state.campaign!.objective,
        enemies: h.state.campaign!.enemies,
      }),
    ).toBe(mission);
    expect(h.state.elapsed).toBe(elapsed);
    h.touch();
    expect(h.state.campaign!.objective!.progress).toBe(2);
  });

  it("keeps a connected survey guide through stale input and requires physical recovery after disconnect", () => {
    const h = harness();
    h.clearPatrol();
    for (let point = 0; point < 4; point++) h.touch();
    h.clearPatrol();
    h.touch();
    const objective = h.state.campaign!.objective!;
    expect(objective.kind).toBe("ward");
    expect(objective.guideId).toBe("a");
    h.state.players.b.x = objective.x;
    h.state.players.b.y = objective.y;
    h.tick(ids, 500);
    h.input("b");
    h.tick();
    expect(objective.progress).toBe(1);
    expect(objective.guideId).toBe("a");
    const guidePosition = { x: h.state.players.a.x, y: h.state.players.a.y };
    h.tick(["b"]);
    expect(objective.dropped).toBe(true);
    expect({ x: objective.x, y: objective.y }).toEqual(guidePosition);
    h.touch("b", ["b"]);
    expect(objective.guideId).toBe("b");
    expect(objective.progress).toBe(1);
    h.touch("b", ["b"]);
    expect(objective.progress).toBe(2);
  });

  it("prevents treasure route votes from skipping the active journey", () => {
    const h = harness();
    h.completeMissions();
    h.advance(2);
    expect(h.state.campaign!.room.kind).toBe("treasure");
    expect(h.state.stage).toBe("fight");
    expect(h.state.campaign!.journey!.stages).toBe(3);
    expect(h.state.campaign!.enemies.length).toBeGreaterThan(0);
  });

  it("requires two missions per boss phase, clamps huge damage to the next band and exposes all three signatures", () => {
    const h = harness();
    h.bossRoom();
    const initial = h.state.boss.hp;
    for (let phase = 1; phase <= 3; phase++) {
      const boss = h.state.boss;
      expect(h.state.campaign!.journey!.bossPhase).toBe(phase);
      expect(boss.phase).toBe(phase);
      h.state.players.a.weapon = "blade";
      h.state.players.a.x = boss.x;
      h.state.players.a.y = boss.y;
      h.input("a", { fire: true, alternate: true });
      h.tick();
      expect(boss.hp).toBeCloseTo(initial * (1 - (phase - 1) / 3));
      h.completeMissions();
      expect(h.state.campaign!.journey!.completedStages).toBe(phase * 2);
      boss.opening = 100;
      const definition = journeyStageDefinition("boss", 0, 0, phase);
      expect(definition.checkpoints.length).toBeGreaterThanOrEqual(3);
      h.state.players.a.x = boss.x;
      h.state.players.a.y = boss.y;
      h.state.players.a.cooldown = 0;
      h.state.players.a.upgrades = { power: 4 };
      // A server-owned oversized shot exercises the same router as ordinary
      // projectiles, explosive splash and melee; it cannot skip mission gates.
      h.state.shots.push({
        id: 9900 + phase,
        x: boss.x,
        y: boss.y,
        vx: 0,
        vy: 0,
        life: 3,
        radius: 300,
        damage: 100000,
        ownerId: "a",
        explosive: true,
      });
      h.input("a");
      h.tick();
      expect(boss.hp).toBeCloseTo(initial * (1 - phase / 3));
      if (phase < 3) {
        expect(h.state.campaign!.journey!.bossPhase).toBe(phase + 1);
        expect(h.state.campaign!.journey!.stage).toBe(1);
        expect(h.state.campaign!.enemies.length).toBeGreaterThan(0);
      }
    }
    expect(h.state.stage).toBe("intermission");
    expect(h.state.campaign!.checkpointRoom).toBe(5);
  });

  it("allows a remaining teammate to recover a departed carrier's signal without granting the departed account progress", () => {
    const h = harness();
    h.clearPatrol();
    h.touch();
    departCoop(h.state, "a");
    h.tick(["b"]);
    expect(h.state.campaign!.objective!.dropped).toBe(true);
    h.touch("b");
    expect(h.state.campaign!.objective!.carrierId).toBe("b");
    expect(h.state.players.a.departed).toBe(true);
    expect(() => h.input("a")).toThrow("left");
  });
});
