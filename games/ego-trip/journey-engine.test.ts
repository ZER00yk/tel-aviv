import { describe, expect, it } from "vitest";
import { routeFor } from "./campaign";
import { normalizeCheckpoint } from "./checkpoint";
import {
  chooseMod,
  chooseRoute,
  eventChoice,
  newCampaignWorld,
  stepWorld,
  type Input,
  type World,
} from "./engine";

const idle: Input = { x: 0, y: 0, aimX: 450, aimY: 150, attack: false, alternate: false, dash: false };
function moveToMark(w: World) {
  const goal = w.campaign!.objective!;
  const dx = goal.x - w.player.x, dy = goal.y - w.player.y;
  const distance = Math.hypot(dx, dy);
  stepWorld(w, { ...idle, x: distance > 0 ? dx / distance : 0, y: distance > 0 ? dy / distance : 0 }, 0.04);
}
/** Isolate traversal from squad AI, while completing every mission with movement inputs. */
function completeMechanicStages(w: World) {
  const targetPhase = w.campaign!.journey!.bossPhase;
  w.player.invulnerable = 1000;
  for (let tick = 0; tick < 20000 && w.stage === "fight" && w.campaign!.journey!.stage <= w.campaign!.journey!.stages && w.campaign!.journey!.bossPhase === targetPhase; tick++) {
    for (const enemy of w.enemies) enemy.hp = 0;
    stepWorld(w, idle, 0.04);
    if (w.campaign!.objective) moveToMark(w);
  }
}
function bossRoom() {
  const w = newCampaignWorld("pulse", 200);
  w.stage = "route";
  w.campaign!.roomIndex = 3;
  w.campaign!.routes = [routeFor("boss", 4)];
  chooseRoute(w, w.campaign!.routes[0].id);
  return w;
}
function enormousHit(w: World) {
  for (const enemy of w.enemies) { enemy.x = 20; enemy.y = 520; enemy.speed = 0; enemy.timer = 100; }
  w.bullets.push({ x: w.boss.x, y: w.boss.y, vx: 0, vy: 0, life: 1, damage: 100000, radius: 40, enemy: false, explosive: true });
  stepWorld(w, idle, 0.001);
}

describe("Ego active campaign journey", () => {
  it("new campaigns opt into paced missions while compact saved campaigns keep their exact form", () => {
    const paced = newCampaignWorld("pulse", 42);
    const compact = newCampaignWorld("pulse", 42, { pacingVersion: null });
    expect(paced.campaign!.pacingVersion).toBe(1);
    expect(paced.campaign!.journey!.stages).toBe(3);
    expect(paced.enemies.length).toBeGreaterThan(compact.enemies.length);
    expect(compact.campaign!.pacingVersion).toBeUndefined();
    expect(compact.campaign!.journey).toBeUndefined();
    expect(normalizeCheckpoint(JSON.parse(JSON.stringify(compact)))).toEqual(compact);
  });
  it("elapsed time and firing do not clear a squad or its recover-deliver traversal", () => {
    const w = newCampaignWorld("pulse", 12);
    w.player.invulnerable = 1000;
    // There is no room-duration success predicate, even after several minutes.
    for (let tick = 0; tick < 10000; tick++) stepWorld(w, idle, 0.04);
    expect(w.stage).toBe("fight");
    expect(w.campaign!.journey!.completedStages).toBe(0);
    expect(w.campaign!.objective).toBeUndefined();
    for (let pass = 0; pass < 2; pass++) {
      for (const enemy of w.enemies) enemy.hp = 0;
      stepWorld(w, idle, 0.04);
    }
    expect(w.campaign!.objective!.kind).toBe("parcel");
    for (let tick = 0; tick < 1000; tick++) stepWorld(w, { ...idle, attack: true }, 0.04);
    expect(w.campaign!.objective!.progress).toBe(0);
    expect(w.campaign!.cleared).toBe(0);
  });
  it("every ordered movement objective survives reload, and carrying changes movement choices", () => {
    const w = newCampaignWorld("pulse", 12);
    w.player.invulnerable = 1000;
    for (let pass = 0; pass < 2; pass++) {
      for (const enemy of w.enemies) enemy.hp = 0;
      stepWorld(w, idle, 0.04);
    }
    for (let tick = 0; tick < 1000 && !w.campaign!.objective!.carrying; tick++) moveToMark(w);
    expect(w.campaign!.objective!.carrying).toBe(true);
    w.player.invulnerable = 99;
    const resumed = normalizeCheckpoint(JSON.parse(JSON.stringify(w)))!;
    expect(resumed).toEqual(w);
    resumed.player.dashCooldown = 0;
    stepWorld(resumed, { ...idle, x: 1, dash: true }, 0.04);
    expect(resumed.player.dashTime).toBe(0);
    expect(resumed.player.vx).toBe(185);
    completeMechanicStages(resumed);
    expect(resumed.stage).toBe("choice");
    expect(resumed.campaign!.journey!.completedStages).toBe(3);
    expect(resumed.campaign!.cleared).toBe(1);
    expect(resumed.time).toBeGreaterThan(50);
  });
  it("three boss phases require their own combat/traversal gates and bound huge damage including poison", () => {
    const w = bossRoom();
    const health = w.boss.hp;
    w.mods = ["vampire", "venom"];
    w.player.hp = 50;
    enormousHit(w);
    expect(w.boss.hp).toBe(health);
    expect(w.telemetry!.damageDealt).toBe(0);
    expect(w.hits).toBe(0);
    expect(w.player.hp).toBe(50);
    w.boss.poison = 9;
    stepWorld(w, idle, 0.04);
    expect(w.boss.hp).toBe(health);
    for (let phase = 1; phase <= 3; phase++) {
      completeMechanicStages(w);
      expect(w.campaign!.journey!.stage).toBe(3);
      const before = w.telemetry!.damageDealt;
      enormousHit(w);
      expect(w.telemetry!.damageDealt - before).toBeCloseTo(health / 3, 6);
      expect(w.boss.hp).toBeCloseTo(health * (1 - phase / 3), 6);
      if (phase < 3) {
        expect(w.campaign!.journey!.bossPhase).toBe(phase + 1);
        expect(w.campaign!.journey!.stage).toBe(1);
        expect(w.boss.phase).toBe(phase + 1);
        expect(w.boss.poison).toBe(0);
        enormousHit(w);
        expect(w.boss.hp).toBeCloseTo(health * (1 - phase / 3), 6);
      }
    }
    expect(w.stage).toBe("choice");
    expect(w.campaign!.journey!.completedStages).toBe(6);
    expect(w.kills).toBe(1);
  });
  it("new build budgets do not erase a saved legacy build or offer unusable stacks", () => {
    const w = newCampaignWorld("pulse", 10);
    w.mods = ["tempo", "tempo", "split", "venom", "critical", "reach", "momentum", "vampire", "ricochet"];
    // tempo and all eight chosen slots are full; old acquired mods remain intact.
    completeMechanicStages(w);
    expect(w.offered).not.toContain("tempo");
    expect(w.offered).not.toContain("dash");
    expect(w.mods).toHaveLength(9);
    expect(chooseMod(w, w.offered[0])).toBe(true);
    const old = newCampaignWorld("pulse", 10, { pacingVersion: null });
    old.mods = ["tempo", "tempo", "tempo", "tempo"];
    expect(normalizeCheckpoint(old)!.mods).toEqual(old.mods);
  });
  it("does not charge resources or health for an upgrade that cannot fit the paced build", () => {
    const w = newCampaignWorld("pulse", 10);
    w.mods = ["tempo", "tempo", "split", "venom", "critical", "reach", "momentum", "vampire"];
    w.ego = 100;
    w.stage = "event";
    w.campaign!.room.kind = "trade";
    expect(eventChoice(w, "buy")).toBe(false);
    expect(w.ego).toBe(100);
    w.campaign!.room.kind = "shrine";
    expect(eventChoice(w, "risk")).toBe(false);
    expect(w.player.hp).toBe(100);
    expect(w.campaign!.eventResolved).toBe(false);
  });
  it("rejects future pacing revisions and incomplete paced checkpoints without upgrading legacy saves", () => {
    const w = newCampaignWorld();
    expect(normalizeCheckpoint({ ...w, campaign: { ...w.campaign, pacingVersion: 2 } })).toBeNull();
    expect(normalizeCheckpoint({ ...w, campaign: { ...w.campaign, journey: undefined } })).toBeNull();
  });
});
