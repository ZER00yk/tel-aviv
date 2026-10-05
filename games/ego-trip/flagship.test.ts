import { describe, expect, it } from "vitest";
import { bosses, modLimits, mods, weapons, type WeaponId } from "./content";
import { arenaFor, keepOutsideCover } from "./arena";
import { nextRoutes, routeFor } from "./campaign";
import {
  normalizeCheckpoint,
  normalizeSave,
  initialSave,
  completeRun,
} from "./checkpoint";
import {
  chooseMod,
  chooseRoute,
  eventChoice,
  newWorld,
  newCampaignWorld as createCampaignWorld,
  nextEncounter,
  stepWorld,
  type Input,
  type World,
} from "./engine";
// These original compact-itinerary contracts remain valid for saved v2 runs.
function newCampaignWorld(...args: Parameters<typeof createCampaignWorld>) {
  return createCampaignWorld(args[0], args[1], { ...args[2], pacingVersion: null });
}
const neutral: Input = {
  x: 0,
  y: 0,
  aimX: 450,
  aimY: 170,
  attack: false,
  alternate: false,
  dash: false,
};
function clear(w: World) {
  for (let i = 0; i < 15 && w.stage === "fight"; i++) {
    w.boss.hp = 0;
    if (w.campaign?.objective)
      w.campaign.objective.progress = w.campaign.objective.target;
    for (const enemy of w.enemies) enemy.hp = 0;
    stepWorld(w, neutral, 0.02);
  }
  if (w.stage === "choice") chooseMod(w, w.offered[0]);
}
function advance(w: World) {
  if (w.stage === "fight") clear(w);
  else if (w.stage === "route") chooseRoute(w, w.campaign!.routes[0].id);
  else if (w.stage === "shop") nextEncounter(w);
  else if (w.stage === "event")
    eventChoice(w, w.campaign!.room.kind === "helper" ? "medic" : "safe");
}
describe("Ego Trip expanded flagship combat", () => {
  it.each(Object.keys(weapons) as WeaponId[])(
    "%s can clear a live target with actual combat",
    (weapon) => {
      const w = newWorld(weapon, 7);
      w.boss.hp = 9;
      w.boss.x = 450;
      w.boss.y = 335;
      w.boss.attackTimer = 100;
      for (let i = 0; i < 120 && w.stage === "fight"; i++)
        stepWorld(
          w,
          { ...neutral, aimX: w.boss.x, aimY: w.boss.y, attack: true },
          0.04,
        );
      expect(w.stage).toBe("choice");
      expect(w.hits).toBeGreaterThan(0);
      expect(w.shots).toBeGreaterThan(0);
    },
  );
  it.each([4, 5, 6, 7])(
    "boss %i has three distinct telegraphed patterns, phases, and recovery",
    (index) => {
      const w = newWorld("pulse", 27, { bossCount: bosses.length });
      w.bossIndex = index;
      w.boss.hp = bosses[index].hp;
      w.boss.maxHp = bosses[index].hp;
      w.player.invulnerable = 100;
      const patterns: string[] = [];
      for (let i = 0; i < 3; i++) {
        w.hazards = [];
        w.boss.attackTimer = 0;
        stepWorld(w, neutral, 0.02);
        expect(w.hazards.length).toBeGreaterThan(0);
        expect(w.hazards.every((hazard) => hazard.timer > 0)).toBe(true);
        patterns.push(JSON.stringify(w.hazards));
      }
      expect(new Set(patterns).size).toBe(3);
      expect(w.boss.recoveryDelay).toBeGreaterThan(0);
      expect(w.boss.opening ?? 0).toBe(0);
      for (let tick = 0; tick < 200 && !(w.boss.opening! > 0); tick++)
        stepWorld(w, neutral, 0.04);
      expect(w.boss.opening).toBeGreaterThan(0);
      expect(w.hazards.filter((h) => h.damage > 0)).toHaveLength(0);
      expect(w.bullets.filter((shot) => shot.enemy)).toHaveLength(0);
      w.boss.hp = w.boss.maxHp * 0.49;
      stepWorld(w, neutral, 0.02);
      expect(w.boss.phase).toBe(2);
      w.boss.hp = w.boss.maxHp * 0.2;
      stepWorld(w, neutral, 0.02);
      expect(w.boss.phase).toBe(3);
      expect(bosses[index].achievement).toBeTruthy();
    },
  );
  it("arena pillars affect movement and projectiles while conveyor changes position", () => {
    const grid = arenaFor(1);
    const p = { x: 250, y: 285 };
    keepOutsideCover(p, grid.terrain, 13);
    expect(Math.hypot(p.x - 250, p.y - 285)).toBe(51);
    const w = newWorld();
    w.bossIndex = 1;
    w.boss.attackTimer = 100;
    w.player.x = 250;
    w.player.y = 285;
    w.bullets = [
      {
        x: 250,
        y: 285,
        vx: 0,
        vy: 0,
        damage: 9,
        enemy: true,
        explosive: false,
        life: 1,
        radius: 4,
      },
    ];
    stepWorld(w, neutral, 0.04);
    expect(w.bullets).toHaveLength(0);
    expect(w.player.x).not.toBe(250);
    w.bossIndex = 2;
    w.player.x = 450;
    w.player.y = 450;
    stepWorld(w, neutral, 0.04);
    expect(w.player.x).toBeGreaterThan(450);
    expect(new Set(bosses.map((boss) => boss.arena)).size).toBe(8);
  });
  it("returning discs can hit on both passes without hitting every frame", () => {
    const w = newWorld("boomerang", 17);
    w.boss.attackTimer = 100;
    w.boss.hp = 1000;
    w.boss.maxHp = 1000;
    w.player.x = 450;
    w.player.y = 430;
    w.boss.x = 450;
    w.boss.y = 350;
    stepWorld(w, { ...neutral, attack: true, aimY: 350 }, 0.02);
    expect(w.bullets[0].returning).toBe(true);
    const shot = w.bullets[0];
    shot.x = w.boss.x;
    shot.y = w.boss.y;
    shot.vx = 0;
    shot.vy = 0;
    stepWorld(w, neutral, 0.02);
    const firstHp = w.boss.hp;
    stepWorld(w, neutral, 0.02);
    expect(w.boss.hp).toBe(firstHp);
    shot.returnTime = 0.01;
    shot.x = w.boss.x;
    shot.y = w.boss.y;
    stepWorld(w, neutral, 0.02);
    expect(w.boss.hp).toBeLessThan(firstHp);
  });
  it("prism chains into a nearby patrol enemy and parry clears hostile bullets", () => {
    const w = newCampaignWorld("prism", 3);
    w.player.x = 450;
    w.player.y = 445;
    w.enemies = [
      {
        ...w.enemies[0],
        id: 1,
        x: 450,
        y: 330,
        hp: 100,
        maxHp: 100,
        speed: 0,
        timer: 100,
      },
      {
        ...w.enemies[0],
        id: 2,
        x: 520,
        y: 330,
        hp: 100,
        maxHp: 100,
        speed: 0,
        timer: 100,
      },
    ];
    stepWorld(w, { ...neutral, attack: true, aimY: 330 }, 0.02);
    expect(w.enemies[0].hp).toBeLessThan(100);
    expect(w.enemies[1].hp).toBeLessThan(100);
    w.weapon = "blade";
    w.mods = ["parry"];
    w.cooldown = 0;
    w.bullets = [
      {
        x: w.player.x + 30,
        y: w.player.y,
        vx: 0,
        vy: 0,
        radius: 5,
        damage: 10,
        enemy: true,
        life: 2,
        explosive: false,
      },
    ];
    stepWorld(w, { ...neutral, attack: true }, 0.02);
    expect(w.bullets.filter((shot) => shot.enemy)).toHaveLength(0);
  });
  it("promise is a single lethal-hit recovery per room and glass has a real cost", () => {
    const w = newWorld();
    w.boss.attackTimer = 100;
    w.mods = ["promise", "glass"];
    w.player.hp = 5;
    const hit = () => {
      w.player.invulnerable = 0;
      w.hazards = [
        {
          kind: "circle",
          x: w.player.x,
          y: w.player.y,
          x2: 0,
          y2: 0,
          radius: 50,
          safeRadius: 0,
          timer: 0,
          active: 1,
          damage: 10,
          color: 1,
        },
      ];
      stepWorld(w, neutral, 0.02);
    };
    hit();
    expect(w.player.hp).toBe(12);
    expect(w.promiseUsed).toBe(true);
    hit();
    expect(w.stage).toBe("lost");
  });
  it("all saturated bounded mods lead onward rather than an empty choice", () => {
    const w = newCampaignWorld();
    w.mods = mods.flatMap(
      (mod) => Array(modLimits[mod.id]).fill(mod.id) as string[],
    );
    clear(w);
    expect(w.stage).toBe("route");
    expect(w.offered).toHaveLength(0);
  });
});
describe("Ego Trip routes, secrets, and compatibility", () => {
  it("environment and survival rooms use multiple distinct waves and rewards once", () => {
    const w = newCampaignWorld("pulse", 18);
    clear(w);
    w.campaign!.routes = [routeFor("survival", 1)];
    chooseRoute(w, w.campaign!.routes[0].id);
    expect(w.campaign!.totalWaves).toBe(3);
    const initial = w.enemies.map((enemy) => enemy.kind);
    for (const enemy of w.enemies) {
      enemy.hp = 0;
      enemy.spawned = true;
    }
    stepWorld(w, neutral, 0.02);
    expect(w.campaign!.wave).toBe(2);
    expect(w.enemies.map((enemy) => enemy.kind)).not.toEqual(initial);
    expect(w.campaign!.cleared).toBe(1);
    clear(w);
    expect(w.campaign!.cleared).toBe(2);
    expect(w.mods).toContain("anchor");
  });
  it("carried archivist key reveals a real relay and is consumed for a mechanical reward", () => {
    const w = newCampaignWorld();
    w.stage = "event";
    w.campaign!.room = routeFor("npc", 1);
    w.campaign!.roomIndex = 1;
    expect(eventChoice(w, "risk")).toBe(true);
    expect(w.campaign!.signalKey).toBe(true);
    w.campaign!.roomIndex = 2;
    const routes = nextRoutes(w);
    expect(routes.some((route) => route.kind === "secret")).toBe(true);
    w.campaign!.routes = routes;
    w.stage = "route";
    chooseRoute(w, routes.find((route) => route.kind === "secret")!.id);
    expect(eventChoice(w, "safe")).toBe(true);
    expect(w.weapon).toBe("prism");
    expect(w.mods).toContain("refraction");
    expect(w.campaign!.signalKey).toBe(false);
    expect(w.campaign!.secrets).toContain("restored-relay");
  });
  it("three refused bargains reveal the pilgrim refuge and unsuccessful relay purchases do not mutate state", () => {
    const w = newCampaignWorld();
    for (let i = 0; i < 3; i++) {
      w.stage = "event";
      w.campaign!.eventResolved = false;
      w.campaign!.room = routeFor("curse", i);
      expect(eventChoice(w, "safe")).toBe(true);
    }
    w.campaign!.roomIndex = 2;
    expect(nextRoutes(w).some((route) => route.kind === "secret")).toBe(true);
    w.stage = "event";
    w.campaign!.eventResolved = false;
    w.campaign!.room = routeFor("secret", 3);
    expect(eventChoice(w, "safe")).toBe(true);
    expect(w.mods).toContain("mercy");
    expect(w.campaign!.secrets).toContain("pilgrims-refuge");
    w.stage = "event";
    w.campaign!.eventResolved = false;
    w.campaign!.room = routeFor("rare", 4);
    const before = structuredClone(w);
    expect(eventChoice(w, "risk")).toBe(false);
    expect(w).toEqual(before);
  });
  it("old schema-one twenty-room campaigns retain their original ending and four-boss sequence", () => {
    const old = newCampaignWorld();
    delete old.campaign!.contentVersion;
    delete old.campaign!.length;
    old.bossCount = 4;
    const w = normalizeCheckpoint(JSON.parse(JSON.stringify(old)))!;
    for (let i = 0; i < 100 && w.stage !== "won"; i++) advance(w);
    expect(w.stage).toBe("won");
    expect(w.campaign!.roomIndex).toBe(19);
    expect(w.kills).toBe(4);
    expect(newWorld().bossCount).toBe(4);
  });
  it("new checkpoint mechanics round trip and future content remains preserved by rejecting writes", () => {
    const w = newCampaignWorld("boomerang", 87);
    w.mods = ["return", "glass"];
    stepWorld(w, { ...neutral, attack: true }, 0.02);
    const restored = normalizeCheckpoint(JSON.parse(JSON.stringify(w)));
    expect(restored).toEqual(w);
    expect(
      normalizeCheckpoint({
        ...w,
        campaign: { ...w.campaign, contentVersion: 3 },
      }),
    ).toBeNull();
    expect(normalizeSave({ ...initialSave, version: 2 })).toBeNull();
  });
  it("run journal and weapon unlocks are local discoveries deduplicated with a completed checkpoint", () => {
    const w = newCampaignWorld();
    w.kills = 8;
    w.stage = "won";
    w.campaign!.secrets = ["restored-relay"];
    const saved = completeRun(initialSave, w);
    expect(saved.unlocked).toEqual(
      expect.arrayContaining(["lance", "boomerang", "prism"]),
    );
    expect(saved.journal).toContain("eight-districts");
    expect(saved.journal).toContain("restored-relay");
    expect(completeRun(saved, w)).toBe(saved);
  });
});
