import { describe, expect, it } from "vitest";
import {
  applyCoopAction,
  createCoopState,
  coopView,
  departCoop,
  tickCoop,
  type CoopState,
} from "./coop-engine";
import { campaignRoom, COOP_CAMPAIGN_ROOMS } from "./coop-campaign";
import { bosses } from "./content";
const ids = ["a", "b"];
function clear(s: CoopState, now: number) {
  // Authoritative fixtures shorten an encounter without accepting any browser score/HP action.
  s.boss.hp = 0;
  for (const enemy of s.campaign!.enemies) enemy.hp = 0;
  if (s.campaign!.room.kind === "environment") s.campaign!.roomElapsed = 28;
  tickCoop(s, now, ids);
}
function continueTeam(s: CoopState, now: number) {
  if (s.campaign?.sharedEvent && !s.campaign.sharedEvent.resolved) {
    for (const id of ids)
      applyCoopAction(s, id, { type: "coop:event-vote", option: 0 }, now);
    tickCoop(s, now + 1, ids);
  }
  for (const id of ids)
    applyCoopAction(s, id, { type: "coop:continue" }, now + 1);
  tickCoop(s, now + 2, ids);
}
describe("server synchronized Ego campaign", () => {
  it("creates deterministic forty-room eight-district routes with server enemies and scaling", () => {
    expect(COOP_CAMPAIGN_ROOMS).toBe(40);
    expect(
      Array.from({ length: 40 }, (_, i) => campaignRoom(51, i)).filter(
        (r) => r.kind === "boss",
      ),
    ).toHaveLength(8);
    const two = createCoopState(ids, 1000, "campaign", 51, "legacy"),
      four = createCoopState(
        [...ids, "c", "d"],
        1000,
        "campaign",
        51,
        "legacy",
      );
    expect(two.campaign!.enemies).toHaveLength(5);
    expect(four.campaign!.enemies).toHaveLength(7);
    expect(four.campaign!.enemies[0].maxHp).toBeGreaterThan(
      two.campaign!.enemies[0].maxHp,
    );
    expect(two.campaign!.room).toEqual(
      createCoopState(ids, 1000, "campaign", 51, "legacy").campaign!.room,
    );
  });
  it("resolves shared route votes without exposing another player's choice or future seed", () => {
    const s = createCoopState(ids, 1000, "campaign", 51, "legacy");
    clear(s, 1040);
    continueTeam(s, 1050);
    expect(s.stage).toBe("choice");
    expect(() =>
      applyCoopAction(s, "outsider", { type: "coop:vote", option: 2 }, 1052),
    ).toThrow("Join");
    applyCoopAction(s, "a", { type: "coop:vote", option: 1 }, 1052);
    const view = coopView(s, "b");
    expect(view.campaign).not.toHaveProperty("votes");
    expect(view.campaign).not.toHaveProperty("seed");
    expect(view.campaign!.yourVote).toBeUndefined();
    applyCoopAction(s, "b", { type: "coop:vote", option: 1 }, 1053);
    tickCoop(s, 1054, ids);
    expect(s.campaign!.room.kind).toBe("elite");
    expect(s.campaign!.enemies.length).toBeGreaterThan(0);
    expect(() =>
      applyCoopAction(s, "a", { type: "coop:reward", reward: "power" }, 1055),
    ).toThrow("between");
  });
  it("keeps rewards per player, rejects duplicate claims and bounds helper upgrades", () => {
    const s = createCoopState(ids, 1000, "campaign", 51, "legacy");
    clear(s, 1040);
    applyCoopAction(s, "a", { type: "coop:reward", reward: "helper" }, 1041);
    expect(s.players.a.upgrades?.helper).toBe(1);
    expect(s.players.b.upgrades?.helper).toBeUndefined();
    expect(() =>
      applyCoopAction(s, "a", { type: "coop:reward", reward: "power" }, 1042),
    ).toThrow("already");
    s.players.b.upgrades = { helper: 4 };
    expect(() =>
      applyCoopAction(s, "b", { type: "coop:reward", reward: "helper" }, 1043),
    ).toThrow("four-stack");
    const own = coopView(s, "a"),
      other = coopView(s, "b");
    expect(own.self.upgrades.helper).toBe(1);
    expect(other.self.upgrades.helper).toBe(4);
    expect(other.players[0]).not.toHaveProperty("credits");
    continueTeam(s, 1050);
    applyCoopAction(s, "a", { type: "coop:vote", option: 0 }, 1052);
    applyCoopAction(s, "b", { type: "coop:vote", option: 0 }, 1053);
    tickCoop(s, 1054, ids);
    tickCoop(s, 1300, ids);
    expect(s.shots.some((shot) => shot.ownerId === "a")).toBe(true);
  });
  it("freezes all-offline combat and completes only after canonical encounters and boss checkpoints", () => {
    const s = createCoopState(ids, 1000, "campaign", 19, "legacy");
    const enemies = JSON.stringify(s.campaign!.enemies);
    tickCoop(s, 60_000, []);
    expect(JSON.stringify(s.campaign!.enemies)).toBe(enemies);
    expect(s.elapsed).toBe(0);
    let now = 60_000;
    for (let room = 0; room < 40; room++) {
      if (s.stage === "choice") {
        for (const id of ids)
          applyCoopAction(s, id, { type: "coop:vote", option: 0 }, now);
        tickCoop(s, ++now, ids);
      }
      if (s.stage === "fight") clear(s, (now += 40));
      if (s.result) break;
      if (s.campaign!.room.kind === "boss")
        expect(s.campaign!.checkpointRoom).toBe(room + 1);
      continueTeam(s, ++now);
      now += 2;
    }
    expect(s.result?.reason).toBe("All eight districts restored together");
    expect(s.result?.winners).toEqual(ids);
    expect(s.campaign!.clearedRooms).toBe(40);
    expect(() =>
      applyCoopAction(s, "a", { type: "coop:input", score: 99999 }, ++now),
    ).toThrow("ended");
  });
  it("preserves the four-boss gauntlet and excludes departed helpers from campaign victory", () => {
    expect(bosses.length).toBeGreaterThanOrEqual(4);
    const s = createCoopState(ids, 1000, "campaign", 1, "legacy");
    departCoop(s, "a");
    expect(s.players.a.departed).toBe(true);
    s.campaign!.room = campaignRoom(1, 39);
    s.campaign!.enemies = [];
    s.boss.hp = 0;
    clear(s, 1040);
    expect(s.result?.winners).toEqual(["b"]);
    expect(s.players.a.status).toBe("eliminated");
  });
  it("executes all twelve added boss signatures with bounded authoritative telegraphs", () => {
    for (let index = 4; index < bosses.length; index++) {
      const s = createCoopState(ids, 1000);
      s.bossIndex = index;
      s.boss.hp = bosses[index].hp;
      s.boss.maxHp = bosses[index].hp;
      for (let pattern = 0; pattern < 3; pattern++) {
        s.shots = [];
        s.hazards = [];
        s.boss.cooldown = 0;
        tickCoop(s, 1040 + pattern * 40, ids);
        expect(
          s.shots.length + s.hazards.length,
          `${bosses[index].name} ${bosses[index].attacks[pattern]}`,
        ).toBeGreaterThan(0);
        expect(
          s.hazards.every(
            (h) => Number.isFinite(h.x) && Number.isFinite(h.y) && h.delay > 0,
          ),
        ).toBe(true);
        expect(s.hazards.length).toBeLessThanOrEqual(48);
      }
    }
  });
  it("shares cover collision and gives the lance a directional long reach", () => {
    const s = createCoopState(ids, 1000);
    s.bossIndex = 1;
    s.boss.hp = 100;
    s.boss.maxHp = 100;
    const p = s.players.a;
    p.x = 250;
    p.y = 340;
    p.weapon = "lance";
    applyCoopAction(
      s,
      "a",
      {
        type: "coop:input",
        sequence: 0,
        dx: 0,
        dy: -1,
        aimX: 450,
        aimY: 160,
        fire: false,
        alternate: false,
        dash: false,
        revive: false,
      },
      1000,
    );
    tickCoop(s, 1250, ids);
    expect(Math.hypot(p.x - 250, p.y - 285)).toBeGreaterThanOrEqual(50);
    const duel = createCoopState(ids, 1000);
    duel.players.a.x = 450;
    duel.players.a.y = 310;
    duel.players.a.weapon = "lance";
    applyCoopAction(
      duel,
      "a",
      {
        type: "coop:input",
        sequence: 0,
        dx: 0,
        dy: 0,
        aimX: 450,
        aimY: 160,
        fire: true,
        alternate: false,
        dash: false,
        revive: false,
      },
      1000,
    );
    tickCoop(duel, 1250, ids);
    expect(duel.players.a.damage).toBeGreaterThan(0);
  });
});
