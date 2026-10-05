import { describe, expect, it } from "vitest";
import {
  actEgoRanked,
  advanceEgoRanked,
  egoUnlocks,
  newEgoRanked,
  rankedStatistics,
} from "./ego-ranked";
const fire = {
  x: 0,
  y: 0,
  aimX: 450,
  aimY: 170,
  attack: true,
  alternate: false,
  dash: false,
};
describe("server-owned Ego ranked simulation", () => {
  it("uses server elapsed time and rejects durations, scores and impossible controls", () => {
    const state = newEgoRanked("pulse", 741, 1000);
    expect(() =>
      actEgoRanked(state, "input", { ...fire, delta: 100 }, 1100),
    ).toThrow("controls");
    expect(() =>
      actEgoRanked(state, "input", { ...fire, x: 100 }, 1100),
    ).toThrow("controls");
    expect(() =>
      actEgoRanked(state, "setScore", { score: 999999 }, 1100),
    ).toThrow("Unknown");
    expect(() => actEgoRanked(state, "complete", {}, 1100)).toThrow("Unknown");
    actEgoRanked(state, "input", fire, 1100);
    expect(state.simulatedMs).toBeCloseTo(100);
    expect(state.world.shots).toBe(0); // The new intent applies from this server instant.
    for (let index = 0; index < 100; index++)
      actEgoRanked(state, "input", fire, 1100);
    expect(state.simulatedMs).toBeCloseTo(100);
    expect(state.world.shots).toBe(0);
    actEgoRanked(state, "input", fire, 2100);
    expect(state.world.shots).toBeGreaterThan(0);
    expect(state.world.shots).toBeLessThanOrEqual(5);
  });
  it("freezes suspended clients, clears held attacks, and never simulates negative time", () => {
    const state = newEgoRanked("pulse", 741, 1000);
    state.input = fire;
    advanceEgoRanked(state, 11000);
    expect(state.simulatedMs).toBe(0);
    expect(state.idleMs).toBe(10000);
    expect(state.input.attack).toBe(false);
    advanceEgoRanked(state, 100);
    expect(state.lastServerTick).toBe(11000);
    expect(state.world.kills).toBe(0);
  });
  it("reproduces server seeds and enforces actual fight/shop/mod transitions", () => {
    const first = newEgoRanked("pulse", 992, 1000);
    const second = newEgoRanked("pulse", 992, 1000);
    for (let tick = 1; tick <= 50; tick++) {
      actEgoRanked(first, "input", fire, 1000 + tick * 100);
      actEgoRanked(second, "input", fire, 1000 + tick * 100);
    }
    expect(first).toEqual(second);
    expect(() => actEgoRanked(first, "continue", {}, 6100)).toThrow("Finish");
    expect(() => actEgoRanked(first, "mod", { id: "critical" }, 6100)).toThrow(
      "offered",
    );
    expect(() => actEgoRanked(first, "shop", { choice: "heal" }, 6100)).toThrow(
      "unavailable",
    );
  });
  it("validates permanent unlock gates without trusting casual metadata", () => {
    expect(egoUnlocks([]).unlockedWeapons).toEqual([
      "pulse",
      "scatter",
      "blade",
    ]);
    expect(egoUnlocks(["Rowan"]).unlockedWeapons).toContain("comet");
    expect(egoUnlocks(["Rowan"]).unlockedHelpers).toEqual(["gunner"]);
    expect(egoUnlocks(["Austin"]).challenges).toEqual([
      "volatile",
      "fragile",
      "no-helper",
    ]);
  });
  it("keeps challenge choices bounded and detects corrupted canonical statistics", () => {
    const state = newEgoRanked("pulse", 554, 1000, "volatile", [
      "fragile",
      "no-helper",
    ]);
    expect(state.world.player.maxHp).toBe(70);
    expect(state.world.boss.maxHp).toBeGreaterThan(340);
    state.world.stage = "shop";
    state.world.kills = 1;
    state.world.ego = 500;
    expect(() =>
      actEgoRanked(state, "shop", { choice: "helper" }, 1100),
    ).toThrow("unavailable");
    state.world.kills = 100;
    expect(() => actEgoRanked(state, "input", fire, 1200)).toThrow(
      "inconsistent",
    );
    state.world.kills = 1;
    expect(rankedStatistics(state).deaths).toBe(0);
  });
});
