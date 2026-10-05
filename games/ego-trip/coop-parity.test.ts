import { describe, expect, it } from "vitest";
import {
  applyCoopAction,
  createCoopState,
  coopView,
  departCoop,
  tickCoop,
  type CoopState,
} from "./coop-engine";
import { campaignRoom } from "./coop-campaign";

const ids = ["a", "b"];
function eventRoom(kind: "npc" | "helper" | "curse") {
  const seed = Array.from({ length: 1000 }, (_, i) => i).find(
    (seed) => campaignRoom(seed, 2).kind === kind,
  )!;
  const s = createCoopState(ids, 1000, "campaign", seed, "legacy");
  clear(s, 1040);
  advance(s, 1050);
  for (const id of ids)
    applyCoopAction(s, id, { type: "coop:vote", option: 0 }, 1060);
  tickCoop(s, 1070, ids);
  clear(s, 1080);
  advance(s, 1090);
  expect(s.campaign!.room.kind).toBe(kind);
  return s;
}
function clear(s: CoopState, now: number) {
  s.boss.hp = 0;
  for (const e of s.campaign!.enemies) e.hp = 0;
  if (s.campaign!.room.kind === "environment") s.campaign!.roomElapsed = 28;
  tickCoop(s, now, ids);
}
function advance(s: CoopState, now: number) {
  for (const id of ids) applyCoopAction(s, id, { type: "coop:continue" }, now);
  tickCoop(s, now + 1, ids);
}
function vote(s: CoopState, a: number, b: number, now: number) {
  applyCoopAction(s, "a", { type: "coop:event-vote", option: a }, now);
  applyCoopAction(s, "b", { type: "coop:event-vote", option: b }, now);
  tickCoop(s, now + 1, ids);
}
describe("synchronized co-op event ownership and weapons", () => {
  it("votes on a carried key, discovers its relay, and grants each retained player exactly once", () => {
    const s = eventRoom("npc");
    vote(s, 1, 1, 1110);
    expect(s.campaign!.signalKey).toBe(true);
    expect(() =>
      applyCoopAction(s, "a", { type: "coop:event-vote", option: 1 }, 1112),
    ).toThrow("awaiting");
    advance(s, 1120); // room3
    clear(s, 1130);
    advance(s, 1140); // boss4
    clear(s, 1150);
    advance(s, 1160); // patrol5
    clear(s, 1170);
    advance(s, 1180); // choice6
    for (const id of ids)
      applyCoopAction(s, id, { type: "coop:vote", option: 0 }, 1190);
    tickCoop(s, 1191, ids);
    clear(s, 1200);
    advance(s, 1210); // secret7
    expect(s.campaign!.room.kind).toBe("secret");
    const recovered = JSON.parse(JSON.stringify(s)) as CoopState;
    vote(recovered, 1, 1, 1220);
    expect(recovered.campaign!.signalKey).toBe(false);
    expect(recovered.campaign!.secrets).toEqual(["restored-relay"]);
    for (const id of ids) {
      expect(recovered.players[id].weapon).toBe("prism");
      expect(recovered.players[id].modifiers).toEqual(["refraction"]);
    }
    expect(coopView(recovered, "b").campaign!.event).not.toHaveProperty(
      "votes",
    );
    expect(coopView(recovered, "b").self.modifiers).toEqual(["refraction"]);
    expect(coopView(recovered, "b").players[0]).not.toHaveProperty("modifiers");
  });
  it("deterministically resolves opposing risk votes and excludes spectators and departing accounts", () => {
    const one = eventRoom("curse"),
      two = JSON.parse(JSON.stringify(one)) as CoopState;
    vote(one, 0, 1, 1110);
    vote(two, 0, 1, 1110);
    expect(two.campaign!.sharedEvent!.outcome).toBe(
      one.campaign!.sharedEvent!.outcome,
    );
    expect(two.players.a.modifiers).toEqual(one.players.a.modifiers);
    const spectator = eventRoom("npc");
    spectator.players.b.status = "eliminated";
    expect(() =>
      applyCoopAction(
        spectator,
        "b",
        { type: "coop:event-vote", option: 1 },
        1110,
      ),
    ).toThrow("Spectators");
    departCoop(spectator, "b");
    applyCoopAction(
      spectator,
      "a",
      { type: "coop:event-vote", option: 1 },
      1110,
    );
    tickCoop(spectator, 1111, ["a"]);
    expect(spectator.campaign!.signalKey).toBe(true);
    expect(() =>
      applyCoopAction(spectator, "b", { type: "coop:continue" }, 1112),
    ).toThrow("left");
  });
  it("keeps medic and gunner ownership through a frozen reconnect and rejects repeat companion claims", () => {
    const s = eventRoom("helper");
    applyCoopAction(s, "a", { type: "coop:helper", kind: "medic" }, 1110);
    applyCoopAction(s, "b", { type: "coop:helper", kind: "gunner" }, 1110);
    expect(() =>
      applyCoopAction(s, "a", { type: "coop:helper", kind: "gunner" }, 1111),
    ).toThrow("already");
    const restored = JSON.parse(JSON.stringify(s)) as CoopState;
    tickCoop(restored, 90000, []);
    expect(restored.players.a.helperKind).toBe("medic");
    expect(restored.players.b.helperKind).toBe("gunner");
    advance(restored, 90010);
    for (const player of Object.values(restored.players)) {
      player.invulnerable = 100;
      player.hp = 50;
    }
    tickCoop(restored, 90250, ids);
    expect(restored.players.a.hp).toBe(54);
    expect(restored.players.b.hp).toBe(50);
    expect(restored.shots.some((shot) => shot.ownerId === "b")).toBe(true);
  });
  it("lets a returning disc hit once on each pass and explosive shots splash separate live targets", () => {
    const s = createCoopState(ids, 1000);
    s.players.a.weapon = "boomerang";
    s.players.a.x = 450;
    s.players.a.y = 440;
    s.boss.opening = 100;
    s.boss.hp = s.boss.maxHp = 1000;
    applyCoopAction(
      s,
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
    tickCoop(s, 1040, ids);
    const shot = s.shots.find((shot) => shot.ownerId === "a")!;
    expect(shot.returnTime).toBeGreaterThan(0);
    s.players.a.input = null;
    shot.x = s.boss.x;
    shot.y = s.boss.y;
    shot.vx = shot.vy = 0;
    tickCoop(s, 1080, ids);
    const first = s.boss.hp;
    tickCoop(s, 1120, ids);
    expect(s.boss.hp).toBe(first);
    shot.returnTime = 0.001;
    shot.x = s.boss.x;
    shot.y = s.boss.y;
    tickCoop(s, 1160, ids);
    expect(s.boss.hp).toBeLessThan(first);
    const c = createCoopState(ids, 1000, "campaign", 5, "legacy");
    c.players.a.weapon = "comet";
    c.campaign!.enemies = c.campaign!.enemies.slice(0, 2);
    for (const [i, e] of c.campaign!.enemies.entries()) {
      e.x = 450 + i * 25;
      e.y = 350;
      e.hp = e.maxHp = 100;
      e.cooldown = 100;
    }
    applyCoopAction(
      c,
      "a",
      {
        type: "coop:input",
        sequence: 0,
        dx: 0,
        dy: 0,
        aimX: 450,
        aimY: 350,
        fire: true,
        alternate: false,
        dash: false,
        revive: false,
      },
      1000,
    );
    tickCoop(c, 1040, ids);
    const comet = c.shots.find((shot) => shot.ownerId === "a")!;
    comet.x = 450;
    comet.y = 350;
    comet.vx = comet.vy = 0;
    tickCoop(c, 1080, ids);
    expect(c.campaign!.enemies.every((e) => e.hp < 100)).toBe(true);
  });
});
