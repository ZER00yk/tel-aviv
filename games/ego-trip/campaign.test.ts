import { describe, expect, it } from "vitest";
import { bosses } from "./content";
import { dailySeed, seedFromText, type EventChoice } from "./campaign";
import {
  completeRun,
  initialSave,
  normalizeCheckpoint,
  normalizeSave,
} from "./checkpoint";
import {
  chooseMod,
  chooseRoute,
  eventChoice,
  newCampaignWorld as createCampaignWorld,
  newWorld,
  nextEncounter,
  shop,
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
function clearFight(w: World) {
  for (let wave = 0; wave < 12 && w.stage === "fight"; wave++) {
    for (const enemy of w.enemies) enemy.hp = 0;
    w.boss.hp = 0;
    if (w.campaign?.objective)
      w.campaign.objective.progress = w.campaign.objective.target;
    stepWorld(w, neutral, 0.02);
  }
  if (w.stage === "choice") chooseMod(w, w.offered[0]);
}
function clearEvent(w: World) {
  if (w.stage === "shop") nextEncounter(w);
  else if (w.stage === "event")
    eventChoice(w, w.campaign?.room.kind === "helper" ? "gunner" : "safe");
}

describe("Ego Trip procedural campaign", () => {
  it("same seed produces the same patrols, mod offers, and route network", () => {
    const a = newCampaignWorld("pulse", 712),
      b = newCampaignWorld("pulse", 712);
    expect(a).toEqual(b);
    clearFight(a);
    clearFight(b);
    expect(a).toEqual(b);
    expect(a.stage).toBe("route");
    expect(newCampaignWorld("pulse", 713).enemies).not.toEqual(a.enemies);
    expect(chooseRoute(a, "invented-route")).toBe(false);
    expect(chooseRoute(a, a.campaign!.routes[0].id)).toBe(true);
    expect(a.campaign!.roomIndex).toBe(1);
  });
  it("live pulse projectiles can clear a patrol and grant its reward once", () => {
    const w = newCampaignWorld("pulse", 99);
    w.enemies = [
      {
        ...w.enemies[0],
        kind: "runner",
        hp: 9,
        maxHp: 9,
        x: 450,
        y: 360,
        speed: 0,
        timer: 100,
      },
    ];
    for (let i = 0; i < 20 && w.stage === "fight"; i++)
      stepWorld(w, { ...neutral, aimY: 360, attack: true }, 0.04);
    expect(w.stage).toBe("choice");
    expect(w.campaign!.enemyKills).toBe(1);
    expect(w.campaign!.cleared).toBe(1);
    expect(w.kills).toBe(0);
    const ego = w.ego;
    stepWorld(w, neutral, 0.04);
    expect(w.ego).toBe(ego);
    expect(w.offered).toHaveLength(3);
    expect(new Set(w.offered).size).toBe(3);
  });
  it("new campaign spans forty rooms and eight distinct bosses in order", () => {
    const w = newCampaignWorld("blade", 803);
    const bossNames: string[] = [];
    let minibosses = 0;
    for (let safety = 0; safety < 150 && w.stage !== "won"; safety++) {
      if (w.stage === "fight") {
        if (w.campaign!.room.kind === "boss")
          bossNames.push(bosses[w.bossIndex].name);
        if (w.campaign!.room.kind === "miniboss") minibosses++;
        clearFight(w);
      } else if (w.stage === "route") chooseRoute(w, w.campaign!.routes[0].id);
      else clearEvent(w);
    }
    expect(w.stage).toBe("won");
    expect(w.campaign!.roomIndex).toBe(39);
    expect(w.campaign!.cleared).toBe(40);
    expect(w.campaign!.path).toHaveLength(40);
    expect(bossNames).toEqual(bosses.map((boss) => boss.name));
    expect(minibosses).toBe(8);
    expect(w.kills).toBe(8);
  });
  it("endless mode continues beyond Noa into another eight-district cycle", () => {
    const w = newCampaignWorld("pulse", 80, { mode: "endless" });
    for (let safety = 0; safety < 200 && w.campaign!.roomIndex < 40; safety++) {
      if (w.stage === "fight") clearFight(w);
      else if (w.stage === "route") chooseRoute(w, w.campaign!.routes[0].id);
      else clearEvent(w);
    }
    expect(w.campaign!.roomIndex).toBe(40);
    expect(w.stage).toBe("fight");
    expect(w.bossIndex).toBe(0);
    expect(w.kills).toBe(8);
  });
  it("risk choices have a real health price and cannot be replayed", () => {
    const w = newCampaignWorld("pulse", 1);
    w.stage = "event";
    w.campaign!.room.kind = "treasure";
    w.player.hp = 18;
    expect(eventChoice(w, "risk")).toBe(false);
    w.player.hp = 50;
    expect(eventChoice(w, "risk")).toBe(true);
    expect(w.player.hp).toBe(32);
    expect(w.ego).toBe(55);
    expect(w.mods).toContain("split");
    expect(eventChoice(w, "risk")).toBe(false);
    expect(w.ego).toBe(55);
    expect(eventChoice(w, "invented" as EventChoice)).toBe(false);
  });
  it("broker trades remove a mod, conserve the payment, and refuse invalid spends", () => {
    const w = newCampaignWorld("pulse", 1);
    w.stage = "event";
    w.campaign!.room.kind = "trade";
    w.mods = ["shield", "tempo"];
    expect(eventChoice(w, "buy")).toBe(false);
    expect(eventChoice(w, "sell")).toBe(true);
    expect(w.mods).toEqual(["shield"]);
    expect(w.ego).toBe(35);
    const noHealth = newWorld();
    noHealth.stage = "shop";
    noHealth.ego = 25;
    expect(shop(noHealth, "heal")).toBe(false);
    expect(noHealth.ego).toBe(25);
  });
  it("minibosses phase and telegraph their own patterns", () => {
    const w = newCampaignWorld("pulse", 1);
    clearFight(w);
    chooseRoute(
      w,
      w.campaign!.routes.find(
        (r) =>
          r.kind === "battle" || r.kind === "elite" || r.kind === "challenge",
      )!.id,
    );
    clearFight(w);
    chooseRoute(w, w.campaign!.routes[0].id);
    expect(w.campaign!.room.kind).toBe("miniboss");
    w.boss.hp = w.boss.maxHp / 2;
    stepWorld(w, neutral, 0.04);
    expect(w.boss.phase).toBe(2);
    w.boss.attackTimer = 0;
    stepWorld(w, neutral, 0.04);
    expect(w.hazards.some((h) => h.kind === "line")).toBe(true);
    expect(w.hazards.every((h) => h.timer > 0)).toBe(true);
  });
  it("secret paths unlock choices and companion options contribute in combat", () => {
    const w = newCampaignWorld("pulse", 1, {
      helper: "gunner",
      secretUnlocked: true,
    });
    stepWorld(w, neutral, 0.04);
    expect(w.helper?.hp).toBe(40);
    expect(w.bullets.some((b) => !b.enemy && b.damage === 6)).toBe(true);
    w.stage = "event";
    w.campaign!.room.kind = "secret";
    delete w.campaign!.contentVersion; // Existing checkpoints retain their old secret trade.
    expect(eventChoice(w, "risk")).toBe(true);
    expect(w.player.hp).toBe(70);
    expect(w.mods).toContain("ricochet");
  });
  it("wall rebound is a mechanical mod with a single bounce", () => {
    const w = newWorld();
    w.mods = ["ricochet"];
    w.boss.attackTimer = 100;
    w.player.x = 875;
    stepWorld(
      w,
      { ...neutral, attack: true, aimX: 900, aimY: w.player.y },
      0.04,
    );
    expect(w.bullets[0].vx).toBeLessThan(0);
    expect(w.bullets[0].bounces).toBe(0);
  });
  it("daily challenge uses one deterministic UTC calendar seed", () => {
    expect(dailySeed(new Date("2026-10-02T00:00:00Z"))).toBe(
      dailySeed(new Date("2026-10-02T23:59:59Z")),
    );
    expect(dailySeed(new Date("2026-10-03T00:00:00Z"))).not.toBe(
      dailySeed(new Date("2026-10-02T00:00:00Z")),
    );
    expect(seedFromText("private-seed")).toBe(seedFromText("private-seed"));
  });
});

describe("Ego Trip cloud-save compatibility", () => {
  it("old schema-1 boss rush retains progress and gains no synthetic campaign", () => {
    const w = newWorld("scatter", 4);
    w.bossIndex = 2;
    w.mods = ["dash", "venom"];
    const legacy = { ...w } as Partial<World>;
    delete legacy.campaign;
    delete legacy.enemies;
    const normalized = normalizeSave({
      version: 1,
      runs: 3,
      bestClears: 2,
      unlocked: ["pulse", "blade", "scatter"],
      checkpoint: legacy,
    });
    expect(normalized?.checkpoint?.bossIndex).toBe(2);
    expect(normalized?.checkpoint?.mods).toEqual(["dash", "venom"]);
    expect(normalized?.checkpoint?.campaign).toBeNull();
    expect(normalized?.insight).toBe(0);
  });
  it("campaign checkpoint resumes the same rooms, offers, and seeded future", () => {
    const original = newCampaignWorld("pulse", 76);
    clearFight(original);
    const resumed = normalizeCheckpoint(JSON.parse(JSON.stringify(original)))!;
    expect(resumed).toEqual(original);
    chooseRoute(resumed, resumed.campaign!.routes[0].id);
    chooseRoute(original, original.campaign!.routes[0].id);
    expect(resumed).toEqual(original);
  });
  it("corrupt or future-version saves fail closed without providing replacement data", () => {
    expect(normalizeSave({ ...initialSave, version: 2 })).toBeNull();
    expect(
      normalizeSave({ ...initialSave, checkpoint: { player: { hp: 100 } } }),
    ).toBeNull();
    const w = newWorld();
    w.player.hp = Infinity;
    expect(normalizeCheckpoint(w)).toBeNull();
  });
  it("restoring a finished checkpoint cannot repeatedly award Insight or lifetime runs", () => {
    const w = newCampaignWorld("pulse", 76);
    w.stage = "lost";
    w.kills = 2;
    w.campaign!.cleared = 8;
    const completed = completeRun(initialSave, w);
    expect(completed.insight).toBe(10);
    expect(completed.runs).toBe(1);
    expect(completed.unlocked).toContain("comet");
    const restored = normalizeSave(JSON.parse(JSON.stringify(completed)))!;
    expect(completeRun(restored, restored.checkpoint!)).toBe(restored);
    expect(restored.insight).toBe(10);
    expect(completeRun({ ...restored, lastRunId: "" }, w).runs).toBe(2);
  });
});
