import { describe, it, expect } from "vitest";
import {
  actTower,
  newTower,
  simulateWave,
  waveKinds,
  MAX_WAVE_ENEMIES,
  MAX_WAVE_EVENTS,
  BOSS_NAMES,
  type TowerState,
} from "./tower";
import {
  TOWER_MAPS,
  towerMap,
  pathTile,
  pathLength,
  pathPosition,
  type TowerMapId,
  type TowerKind,
} from "../config/tower";
import { replayEnemy } from "../tower-defense/replay";
function fortified(map: TowerMapId = "boulevard"): TowerState {
  const state = newTower({ map });
  state.cash = 100_000;
  state.lives = 200;
  for (let x = 0; x < 8; x++)
    for (let y = 0; y < 5; y++)
      if (!pathTile(towerMap(map), x, y)) {
        const kinds: TowerKind[] = [
          "heavy",
          "sniper",
          "burn",
          "slow",
          "rapid",
          "support",
        ];
        actTower(state, "place", { kind: kinds[(x + y) % kinds.length], x, y });
        state.towers.at(-1)!.level = 5;
      }
  state.upgrades = ["power", "power", "power", "speed", "speed", "range"];
  return state;
}
describe("Neon Defense paths and compatibility", () => {
  it("keeps legacy saved defenses on the original boulevard campaign", () => {
    const state = newTower();
    delete state.map;
    delete state.mode;
    actTower(state, "place", { kind: "rapid", x: 3, y: 1 });
    expect(() =>
      actTower(state, "place", { kind: "rapid", x: 3, y: 2 }),
    ).toThrow(/path/);
    simulateWave(state);
    expect(state.wave).toBe(1);
    expect(state.lastWave!.kills + state.lastWave!.leaks).toBe(6);
    expect(state.runId).toBeTruthy();
    expect(state.runStartedAt).toBeGreaterThan(0);
  });
  it("maps use different actual routes, legal building tiles and distinct travel times", () => {
    const times: number[] = [];
    for (const map of Object.keys(TOWER_MAPS) as TowerMapId[]) {
      const state = newTower({ map });
      simulateWave(state);
      times.push(state.lastWave!.enemies![0].endTime!);
      expect(state.lastWave!.enemies![0].points[0].y).toBe(
        map === "boulevard" ? 2 : 1,
      );
      expect(state.lastWave!.leaks).toBe(6);
    }
    expect(times[1]).toBeGreaterThan(times[0] * 2);
    expect(times[2]).toBeGreaterThan(times[0]);
    expect(pathTile(towerMap("switchback"), 6, 2)).toBe(true);
    expect(pathTile(towerMap("switchback"), 4, 2)).toBe(false);
  });
  it("splits crossing enemies between two real lanes", () => {
    const state = newTower({ map: "crossroads" });
    simulateWave(state);
    expect(state.lastWave!.enemies!.map((enemy) => enemy.route)).toEqual([
      0, 1, 0, 1, 0, 1,
    ]);
    expect(state.lastWave!.enemies![1].points[0].y).toBe(3);
    expect(state.lastWave!.enemies![0].points.at(-1)!.y).toBe(3);
  });
  it("rejects path placement on every map and invalid new-run settings", () => {
    for (const map of Object.keys(TOWER_MAPS) as TowerMapId[]) {
      const state = newTower({ map });
      expect(() =>
        actTower(state, "place", {
          kind: "rapid",
          x: 0,
          y: map === "boulevard" ? 2 : 1,
        }),
      ).toThrow(/path/);
    }
    expect(() => actTower(newTower(), "start", { map: "fake" })).toThrow(/map/);
    expect(() => actTower(newTower(), "start", { mode: "scripted" })).toThrow(
      /mode/,
    );
  });
  it("interpolates path turns and clamps beyond endpoints", () => {
    const route = towerMap("crossroads").routes[0];
    expect(pathPosition(route, 3.4)).toEqual({ x: 3, y: 1 });
    expect(pathPosition(route, 4.4).x).toBe(3);
    expect(pathPosition(route, 4.4).y).toBeCloseTo(2);
    expect(pathPosition(route, pathLength(route) + 5)).toEqual({
      x: 7.7,
      y: 3,
    });
  });
});
describe("Neon Defense enemy roles and tactical choices", () => {
  it("armor reduces rapid hits while heavy hits pierce it", () => {
    for (const [kind, expectedDamage] of [
      ["rapid", 6 * 0.45],
      ["heavy", 25],
    ] as const) {
      const state = newTower();
      state.wave = 2;
      actTower(state, "place", { kind, x: 0, y: 1 });
      simulateWave(state);
      const armored = state.lastWave!.enemies!.find(
        (enemy) => enemy.kind === "armored",
      )!;
      const hits = state.lastWave!.events.filter(
        (event) => event.type === "shot" && event.enemyId === armored.id,
      ).length;
      expect(hits).toBeGreaterThan(0);
      expect(armored.maxHp - armored.points.at(-1)!.hp).toBeCloseTo(
        Math.min(armored.maxHp, hits * expectedDamage),
      );
    }
  });
  it("regenerators recover after leaving tower range and medics heal other kinds", () => {
    for (const wave of [4, 7]) {
      const state = newTower();
      state.wave = wave - 1;
      actTower(state, "place", { kind: "rapid", x: 0, y: 1 });
      simulateWave(state);
      const recovering = state.lastWave!.enemies!.filter((enemy) =>
        enemy.points.some(
          (point, index) => index > 0 && point.hp > enemy.points[index - 1].hp,
        ),
      );
      expect(recovering.length).toBeGreaterThan(0);
      expect(
        recovering.some((enemy) =>
          wave === 4 ? enemy.kind === "regen" : enemy.kind === "grunt",
        ),
      ).toBe(true);
    }
  });
  it("introduces ten meaningful enemy roles with four distinct boss presentations", () => {
    const roles = new Set(
      Array.from({ length: 20 }, (_, index) => waveKinds(index + 1)).flat(),
    );
    expect(roles.size).toBe(10);
    const names: string[] = [];
    for (const wave of [5, 10, 15, 20]) {
      const state = newTower();
      state.wave = wave - 1;
      simulateWave(state);
      names.push(
        state.lastWave!.enemies!.find((enemy) => enemy.kind === "boss")!
          .bossName!,
      );
    }
    expect(names).toEqual([...BOSS_NAMES]);
  });
  it("requires detection for Veils and Beacons make rapid towers acquire them", () => {
    const build = (reveal: boolean) => {
      const state = newTower();
      state.wave = 11;
      state.cash = 10000;
      for (let x = 0; x < 8; x++) {
        actTower(state, "place", { kind: "rapid", x, y: 1 });
        state.towers.at(-1)!.level = 5;
        if (reveal && x % 2 === 1)
          actTower(state, "place", { kind: "support", x, y: 0 });
      }
      simulateWave(state);
      return state.lastWave!.enemies!.filter(
        (enemy) => enemy.kind === "stealth",
      );
    };
    expect(build(false).every((enemy) => enemy.end === "leak")).toBe(true);
    expect(build(true).some((enemy) => enemy.end === "kill")).toBe(true);
  });
  it("shield pools absorb damage and verified shield breaks enter the replay", () => {
    const state = fortified();
    state.wave = 5;
    simulateWave(state);
    expect(
      state.lastWave!.enemies!.some((enemy) => enemy.kind === "shield"),
    ).toBe(true);
    expect(
      state.lastWave!.events.some((event) => event.type === "shield-break"),
    ).toBe(true);
  });
  it("defeated splitters spawn real, bounded runner children", () => {
    const state = fortified();
    state.wave = 8;
    simulateWave(state);
    expect(state.lastWave!.enemies!.length).toBeGreaterThan(
      waveKinds(9).length,
    );
    expect(state.lastWave!.enemies!.length).toBeLessThanOrEqual(
      MAX_WAVE_ENEMIES,
    );
    expect(state.lastWave!.kills + state.lastWave!.leaks).toBe(
      state.lastWave!.enemies!.length,
    );
  });
  it("combination effects change combat and produce verified synergy hits", () => {
    const state = fortified();
    state.wave = 11;
    simulateWave(state);
    expect(state.lastWave!.synergyHits).toBeGreaterThan(0);
    for (const enemy of state.lastWave!.enemies!)
      for (const point of enemy.points) {
        expect(point.hp).toBeGreaterThanOrEqual(0);
        expect(point.hp).toBeLessThanOrEqual(enemy.maxHp);
      }
  });
  it("allows only validated targeting priorities on existing towers", () => {
    const state = newTower();
    actTower(state, "place", { kind: "rapid", x: 3, y: 1 });
    actTower(state, "target", {
      towerId: state.towers[0].id,
      target: "support",
    });
    expect(state.towers[0].target).toBe("support");
    expect(() =>
      actTower(state, "target", {
        towerId: state.towers[0].id,
        target: "hacked",
      }),
    ).toThrow(/priority/);
    expect(() =>
      actTower(state, "target", { towerId: "missing", target: "first" }),
    ).toThrow(/not found/);
  });
});
describe("Neon Defense campaign and bounded endless", () => {
  it("replays only the verified enemy lifespan and interpolates its recorded health and route", () => {
    const enemy = {
      id: 7,
      kind: "shield" as const,
      route: 0,
      spawn: 2,
      maxHp: 30,
      endTime: 8,
      end: "kill" as const,
      points: [
        { time: 2, x: 0, y: 1, hp: 30, shield: 10 },
        { time: 6, x: 3, y: 1, hp: 18, shield: 0 },
        { time: 8, x: 3, y: 2, hp: 0, shield: 0 },
      ],
    };
    expect(replayEnemy(enemy, 1)).toBeNull();
    expect(replayEnemy(enemy, 4)).toEqual({ x: 1.5, y: 1, hp: 24, shield: 5 });
    expect(replayEnemy(enemy, 7)).toEqual({ x: 3, y: 1.5, hp: 9, shield: 0 });
    expect(replayEnemy(enemy, 8)).toBeNull();
    expect(replayEnemy(enemy, 100)).toBeNull();
  });
  it("sells an upgraded tower for sixty percent of its actual purchase costs", () => {
    const state = newTower();
    state.cash = 10000;
    const before = state.cash;
    actTower(state, "place", { kind: "rapid", x: 3, y: 1 });
    const id = state.towers[0].id;
    for (let upgrade = 0; upgrade < 4; upgrade++)
      actTower(state, "upgrade", { towerId: id });
    const spent = before - state.cash;
    const preSale = state.cash;
    actTower(state, "sell", { towerId: id });
    expect(state.cash - preSale).toBe(Math.floor(spent * 0.6));
    expect(state.cash).toBeLessThan(before);
  });
  it("records a campaign clear and preserves it into the next selected map", () => {
    const state = fortified();
    state.wave = 19;
    simulateWave(state);
    expect(state.phase).toBe("won");
    expect(state.clearedMaps).toContain("boulevard");
    const next = actTower(state, "start", {
      map: "switchback",
      mode: "endless",
    });
    expect(next.map).toBe("switchback");
    expect(next.mode).toBe("endless");
    expect(next.clearedMaps).toContain("boulevard");
    expect(next.runId).not.toBe(state.runId);
    expect(next.wave).toBe(0);
  });
  it("endless remains active after twenty waves and does not award a campaign clear", () => {
    const state = fortified();
    state.wave = 19;
    state.mode = "endless";
    simulateWave(state);
    expect(state.phase).toBe("build");
    expect(state.clearedMaps).toEqual([]);
  });
  it("bounds huge endless waves, enemy children, traces, events and serialized payload", () => {
    const state = fortified("switchback");
    state.mode = "endless";
    state.wave = 999;
    simulateWave(state);
    expect(state.lastWave!.enemies!.length).toBeLessThanOrEqual(
      MAX_WAVE_ENEMIES,
    );
    expect(state.lastWave!.events.length).toBeLessThanOrEqual(MAX_WAVE_EVENTS);
    expect(
      state.lastWave!.enemies!.every((enemy) => enemy.points.length <= 16),
    ).toBe(true);
    expect(JSON.stringify(state).length).toBeLessThan(250_000);
    expect(state.lastWave!.kills + state.lastWave!.leaks).toBe(
      state.lastWave!.enemies!.length,
    );
  });
  it("never grants a free win to unresolved enemies or client-invented upgrades", () => {
    const state = newTower({ mode: "endless" });
    state.wave = 500;
    simulateWave(state);
    expect(state.phase).toBe("lost");
    expect(state.lastWave!.kills).toBe(0);
    expect(state.lastWave!.leaks).toBe(80);
    expect(() =>
      actTower(newTower(), "choose", { upgrade: "free_cash" }),
    ).toThrow(/offered/);
  });
});
