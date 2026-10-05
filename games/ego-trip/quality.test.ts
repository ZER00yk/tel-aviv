import { describe, expect, it } from "vitest";
import { bosses } from "./content";
import {
  chooseRoute,
  newCampaignWorld,
  stepWorld,
  shopCost,
  type Input,
} from "./engine";
import { routeFor } from "./campaign";
import { normalizeCheckpoint } from "./checkpoint";
import { playtestInput, runCampaignPlaytest } from "./playtest";
import { grantEgo, healPlayer } from "./telemetry";
import { createCoopState, tickCoop } from "./coop-engine";
const neutral: Input = {
  x: 0,
  y: 0,
  aimX: 450,
  aimY: 170,
  attack: false,
  alternate: false,
  dash: false,
};
function room(kind: "protect" | "trial") {
  const w = newCampaignWorld("pulse", 81, { pacingVersion: null });
  w.stage = "route";
  w.campaign!.routes = [routeFor(kind, 1)];
  chooseRoute(w, w.campaign!.routes[0].id);
  return w;
}
describe("Ego encounter and boss quality", () => {
  it("movement beacons require ordered actual movement, survive save/reload and cannot be cleared with fire", () => {
    const w = room("trial");
    for (let tick = 0; tick < 25; tick++)
      stepWorld(w, { ...neutral, attack: true }, 0.04);
    expect(w.stage).toBe("fight");
    expect(w.campaign!.objective!.progress).toBe(0);
    const restored = normalizeCheckpoint(JSON.parse(JSON.stringify(w)))!;
    expect(restored.campaign!.objective).toEqual(w.campaign!.objective);
    for (let tick = 0; tick < 1000 && restored.stage === "fight"; tick++)
      stepWorld(restored, playtestInput(restored), 0.04);
    expect(restored.stage).toBe("choice");
    expect(restored.campaign!.objective!.progress).toBe(4);
    expect(restored.telemetry!.damageDealt).toBe(0);
  });
  it("a protected relay charges under live enemy pressure and can be lost without ending the player's health", () => {
    const w = room("protect");
    for (let tick = 0; tick < 1500 && w.stage === "fight"; tick++)
      stepWorld(w, playtestInput(w), 0.04);
    expect(w.stage).toBe("choice");
    expect(w.campaign!.objective!.progress).toBeGreaterThanOrEqual(35);
    expect(w.telemetry!.damageDealt).toBeGreaterThan(250);
    expect(w.enemies.length).toBeLessThanOrEqual(8);
    const lost = room("protect");
    lost.campaign!.objective!.hp = 0;
    stepWorld(lost, neutral, 0.04);
    expect(lost.stage).toBe("lost");
    expect(lost.player.hp).toBe(100);
  });
  it.each(bosses.map((_, i) => i))(
    "co-op boss %i has a safe punish window after its telegraphs and projectiles expire",
    (index) => {
      const s = createCoopState(["a", "b"], 1000);
      s.bossIndex = index;
      s.boss.hp = s.boss.maxHp = 10000;
      for (const p of Object.values(s.players)) p.invulnerable = 100;
      let now = 1000;
      for (let attack = 0; attack < 3; attack++) {
        s.boss.cooldown = 0;
        tickCoop(s, (now += 40), ["a", "b"]);
      }
      expect(s.boss.recoveryDelay).toBeGreaterThan(0);
      expect(s.boss.opening ?? 0).toBe(0);
      for (let tick = 0; tick < 200 && !(s.boss.opening! > 0); tick++)
        tickCoop(s, (now += 40), ["a", "b"]);
      expect(s.boss.opening).toBeGreaterThan(0);
      expect(s.hazards).toHaveLength(0);
      expect(s.shots.filter((shot) => !shot.ownerId)).toHaveLength(0);
      s.boss.hp = 4900;
      tickCoop(s, (now += 40), ["a", "b"]);
      expect(s.boss.phase).toBe(2);
      s.boss.hp = 2000;
      tickCoop(s, (now += 40), ["a", "b"]);
      expect(s.boss.phase).toBe(3);
      expect(s.hazards.every((h) => h.delay > 0)).toBe(true);
    },
  );
  it("bounds resource inflation without erasing legacy balances and exposes honest rising shop prices", () => {
    const w = newCampaignWorld();
    w.ego = 240;
    expect(grantEgo(w, 50)).toBe(10);
    expect(w.ego).toBe(250);
    w.ego = 1000;
    expect(grantEgo(w, 50)).toBe(0);
    expect(w.ego).toBe(1000);
    w.campaign!.roomIndex = 35;
    expect(shopCost(w, "heal")).toBe(41);
    expect(shopCost(w, "mod")).toBe(65);
    delete w.campaign!.contentVersion;
    expect(shopCost(w, "heal")).toBe(20);
    expect(grantEgo(w, 20)).toBe(20);
    w.player.hp = 95;
    expect(healPlayer(w, 35)).toBe(5);
    expect(w.telemetry!.healing).toBe(5);
  });
  it("measures a complete ordinary-input campaign with bounded late-run state and no outcome/HP cheating", () => {
    const result = runCampaignPlaytest({
      seed: 481,
      weapon: "pulse",
      routeStrategy: "objectives",
    });
    expect(result.result).toBe("won");
    expect(result.roomsCleared).toBe(40);
    expect(result.bossesDefeated).toBe(8);
    expect(result.rooms).toHaveLength(40);
    expect(result.rooms.some((r) => r.kind === "trial")).toBe(true);
    expect(result.rooms.some((r) => r.kind === "protect")).toBe(true);
    expect(result.maxStateBytes).toBeLessThan(100000);
    expect(result.maxEnemies).toBeLessThanOrEqual(30);
    expect(result.resources).toBeLessThanOrEqual(250);
    expect(result.incomingDamage).toBeGreaterThan(0);
    expect(result.simulationSeconds).toBeGreaterThan(200); // Smoke budget, not a claimed human pacing target.
  });
  it("finishes the volatile comet objective route instead of repeatedly firing into cover", () => {
    const result = runCampaignPlaytest({
      seed: 481,
      weapon: "comet",
      difficulty: "volatile",
      routeStrategy: "objectives",
    });
    expect(result.result).toBe("won");
    expect(result.timedOut).toBe(false);
    expect(result.roomsCleared).toBe(40);
    expect(result.bossesDefeated).toBe(8);
    expect(result.rooms.some((room) => room.kind === "protect")).toBe(true);
    expect(result.rooms.every((room) => room.complete)).toBe(true);
  });

});
