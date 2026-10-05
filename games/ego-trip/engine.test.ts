import { describe, it, expect } from "vitest";
import {
  newWorld,
  stepWorld,
  chooseMod,
  shop,
  nextEncounter,
  pointToSegment,
  type Input,
} from "./engine";
const neutral: Input = {
  x: 0,
  y: 0,
  aimX: 450,
  aimY: 170,
  attack: false,
  alternate: false,
  dash: false,
};
describe("Ego Trip combat invariants", () => {
  it("normalizes diagonal movement and keeps a dash inside the arena", () => {
    const w = newWorld("pulse", 1);
    w.player.x = 879;
    stepWorld(w, { ...neutral, x: 1, y: 1, dash: true }, 0.04);
    expect(w.player.x).toBeLessThanOrEqual(880);
    expect(w.player.invulnerable).toBeGreaterThan(0);
    const cooldown = w.player.dashCooldown;
    stepWorld(w, { ...neutral, x: 1, dash: true }, 0.04);
    expect(w.player.dashCooldown).toBeLessThan(cooldown);
  });
  it("a ring has a safe center and a damaging band", () => {
    const w = newWorld("pulse", 1);
    w.boss.attackTimer = 100;
    w.player.x = 200;
    w.player.y = 300;
    w.hazards = [
      {
        kind: "ring",
        x: 200,
        y: 300,
        x2: 200,
        y2: 300,
        radius: 100,
        safeRadius: 60,
        timer: 0,
        active: 1,
        damage: 20,
        color: 1,
      },
    ];
    stepWorld(w, neutral, 0.02);
    expect(w.player.hp).toBe(100);
    w.player.x = 275;
    stepWorld(w, neutral, 0.02);
    expect(w.player.hp).toBe(80);
    stepWorld(w, neutral, 0.02);
    expect(w.player.hp).toBe(80);
  });
  it("a boss defeat grants a choice and prevents invalid reward selections", () => {
    const w = newWorld("pulse", 1);
    w.boss.hp = 0;
    stepWorld(w, neutral, 0.02);
    expect(w.stage).toBe("choice");
    expect(w.ego).toBe(45);
    expect(chooseMod(w, "invalid")).toBe(false);
    expect(chooseMod(w, w.offered[0])).toBe(true);
    expect(w.stage).toBe("shop");
    nextEncounter(w);
    expect(w.bossIndex).toBe(1);
    expect(w.stage).toBe("fight");
    expect(w.boss.hp).toBeGreaterThan(0);
  });
  it("shop costs never make run currency or health negative", () => {
    const w = newWorld();
    w.stage = "shop";
    w.ego = 5;
    expect(shop(w, "helper")).toBe(false);
    expect(w.ego).toBe(5);
    w.player.hp = 15;
    expect(shop(w, "risk")).toBe(false);
    expect(w.player.hp).toBe(15);
  });
  it("boss phase changes on the half-health threshold", () => {
    const w = newWorld("pulse", 1);
    w.boss.hp = w.boss.maxHp / 2;
    stepWorld(w, neutral, 0.02);
    expect(w.boss.phase).toBe(2);
    expect(w.hazards.length).toBeGreaterThan(0);
  });
  it("beam distance includes segment endpoints", () => {
    expect(
      pointToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }),
    ).toBe(3);
    expect(
      pointToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }),
    ).toBe(10);
  });
});
