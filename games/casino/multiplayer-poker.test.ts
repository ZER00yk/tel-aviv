import { describe, it, expect } from "vitest";
import {
  applyPokerAction,
  cancelPokerState,
  createPersistentPokerHand,
  createPokerState,
  foldDepartedPokerSeat,
  publicPokerTable,
  pokerBlinds,
  settlePokerState,
  tickPokerState,
  type PokerState,
  type PokerTableConfig,
} from "./multiplayer-poker";
const ids = ["a", "b", "c"];
function conservation(s: PokerState) {
  return (
    s.seats.reduce((n, p) => n + p.stack, 0) +
    (s.phase === "betting" ? s.pot : 0)
  );
}
const act = (
  s: PokerState,
  type: string,
  extra: Record<string, unknown> = {},
) =>
  applyPokerAction(
    s,
    s.seats[s.turnIndex!].userId,
    { type, ...(s.table ? { revision: s.revision } : {}), ...extra },
    1000 + s.revision,
  );
describe("private authoritative Texas Hold'em", () => {
  it("deals unique private cards, posts blinds and starts heads-up with the dealer", () => {
    const s = createPokerState(ids.slice(0, 2), 100, 0, 1000);
    expect(s.pot).toBe(15);
    expect(s.seats[s.turnIndex!].userId).toBe("a");
    expect(new Set([...s.deck, ...s.seats.flatMap((p) => p.hole)]).size).toBe(
      52,
    );
    const a = publicPokerTable(s, "a"),
      b = publicPokerTable(s, "b");
    expect(a.seats[1].hole).toEqual([-1, -1]);
    expect(b.seats[0].hole).toEqual([-1, -1]);
    expect(a).not.toHaveProperty("deck");
    expect(a).not.toHaveProperty("acted");
    expect(conservation(s)).toBe(200);
  });
  it("rejects outsiders, wrong turns, forged money and impossible bets", () => {
    const s = createPokerState(ids.slice(0, 2), 100, 0, 1000);
    expect(() => applyPokerAction(s, "c", { type: "poker:call" })).toThrow(
      "Join",
    );
    expect(() => applyPokerAction(s, "b", { type: "poker:call" })).toThrow(
      "turn",
    );
    expect(() => act(s, "poker:check")).toThrow("outstanding");
    expect(() => act(s, "poker:raise", { to: 19 })).toThrow("last full");
    expect(() => act(s, "poker:raise", { to: 999 })).toThrow("stack");
    expect(() => act(s, "poker:call", { payout: 9999 })).toThrow();
  });
  it("lets the big blind act after a call and deals one bounded betting round per street", () => {
    const s = createPokerState(ids.slice(0, 2), 100, 0, 1000);
    act(s, "poker:call");
    expect(s.street).toBe("preflop");
    expect(s.seats[s.turnIndex!].userId).toBe("b");
    act(s, "poker:check");
    expect(s.street).toBe("flop");
    expect(s.community).toHaveLength(3);
    expect(s.seats[s.turnIndex!].userId).toBe("b");
    for (let i = 0; i < 6; i++) act(s, "poker:check");
    expect(s.phase).toBe("settled");
    expect(s.community).toHaveLength(5);
    expect(conservation(s)).toBe(200);
    expect(s.payouts).toEqual(
      Object.fromEntries(s.seats.map((p) => [p.userId, p.stack])),
    );
  });
  it("runs out all-ins and splits layered side pots with folded money and odd chips", () => {
    const s = createPokerState(ids.slice(0, 2), 100, 0, 1000);
    act(s, "poker:all-in");
    expect(s.phase).toBe("betting");
    act(s, "poker:call");
    expect(s.phase).toBe("settled");
    expect(s.community).toHaveLength(5);
    expect(conservation(s)).toBe(200);
    const split = createPokerState(ids, 100, 0, 1000);
    split.community = [9, 10, 11, 12, 0];
    split.seats[0].hole = [13, 14];
    split.seats[1].hole = [26, 27];
    split.seats[2].hole = [39, 40];
    for (const [i, p] of split.seats.entries()) {
      p.committed = i === 2 ? 5 : 11;
      p.stack = 100 - p.committed;
      p.folded = i === 2;
    }
    split.pot = 27;
    settlePokerState(split);
    expect(split.pots?.map((p) => p.amount)).toEqual([15, 12]);
    expect(split.seats.map((p) => p.stack)).toEqual([102, 103, 95]);
    expect(conservation(split)).toBe(300);
  });
  it("layers a real folded partial contribution separately from the two all-in stacks", () => {
    const s = createPokerState(ids, 100, 0, 1000);
    s.community = [1, 15, 29, 43, 7];
    s.seats[0].hole = [0, 13];
    s.seats[1].hole = [12, 25];
    s.seats[2].hole = [11, 24];
    for (const [i, p] of s.seats.entries()) {
      p.committed = i === 2 ? 40 : 100;
      p.stack = 100 - p.committed;
      p.allIn = p.stack === 0;
      p.folded = i === 2;
    }
    s.pot = 240;
    settlePokerState(s);
    expect(s.pots?.map((p) => p.amount)).toEqual([120, 120]);
    expect(s.seats.map((p) => p.stack)).toEqual([240, 0, 60]);
    expect(conservation(s)).toBe(300);
  });
  it("keeps a river winner's hole cards private when everyone else folds", () => {
    const s = createPokerState(ids.slice(0, 2), 100, 0, 1000);
    act(s, "poker:call");
    act(s, "poker:check");
    for (let i = 0; i < 4; i++) act(s, "poker:check");
    expect(s.street).toBe("river");
    const folder = s.seats[s.turnIndex!].userId,
      winner = s.seats.find((p) => p.userId !== folder)!.userId;
    act(s, "poker:fold");
    expect(
      publicPokerTable(s, folder).seats.find((p) => p.userId === winner)?.hole,
    ).toEqual([-1, -1]);
    expect(conservation(s)).toBe(200);
  });
  it("times out to check or fold, preserves committed all-ins on departure and restores JSON checkpoints", () => {
    const s = createPokerState(ids.slice(0, 2), 100, 0, 1000);
    const restored = JSON.parse(JSON.stringify(s)) as PokerState;
    expect(tickPokerState(restored, 31_001)).toBe(true);
    expect(restored.phase).toBe("settled");
    expect(restored.result?.reason).toContain("folded");
    const three = createPokerState(ids, 100, 0, 1000);
    act(three, "poker:all-in");
    foldDepartedPokerSeat(three, "a", 1002);
    expect(three.seats[0].folded).toBe(false);
    expect(three.seats[0].allIn).toBe(true);
    expect(conservation(three)).toBe(300);
  });
  it("reopens actions after a full raise and ends without rewarding impossible duplicate actions", () => {
    const s = createPokerState(ids, 100, 0, 1000);
    act(s, "poker:raise", { to: 30 });
    expect(s.currentBet).toBe(30);
    expect(s.minRaise).toBe(20);
    act(s, "poker:call");
    act(s, "poker:raise", { to: 50 });
    expect(s.currentBet).toBe(50);
    expect(publicPokerTable(s, "a").self.canRaise).toBe(true);
    while (s.phase === "betting") {
      const self = s.seats[s.turnIndex!];
      act(s, self.streetBet < s.currentBet ? "poker:call" : "poker:check");
    }
    expect(conservation(s)).toBe(300);
    expect(() => act(s, "poker:call")).toThrow();
  });
  it("reopens a prior actor only when cumulative short all-ins reach a full raise", () => {
    const s = createPokerState(["a", "b", "c", "d"], 100, 0, 1000);
    // A later street can have unequal remaining stacks from earlier calls/folds.
    s.street = "flop";
    s.currentBet = 20;
    s.minRaise = 20;
    s.turnIndex = 1;
    s.acted = ["a"];
    s.lastActedBet = { a: 20 };
    for (const [index, seat] of s.seats.entries()) {
      seat.streetBet = 20;
      seat.stack = index === 1 ? 10 : index === 2 ? 20 : 60;
      seat.committed = 100 - seat.stack;
      seat.allIn = false;
    }
    s.pot = s.seats.reduce((sum, p) => sum + p.committed, 0);
    applyPokerAction(s, "b", { type: "poker:all-in" }, 1001);
    expect(s.currentBet).toBe(30);
    expect(publicPokerTable(s, "a").self.canRaise).toBe(false);
    applyPokerAction(s, "c", { type: "poker:all-in" }, 1002);
    expect(s.currentBet).toBe(40);
    expect(publicPokerTable(s, "a").self.canRaise).toBe(true);
    applyPokerAction(s, "d", { type: "poker:call" }, 1003);
    applyPokerAction(s, "a", { type: "poker:raise", to: 60 }, 1004);
    expect(s.currentBet).toBe(60);
    expect(conservation(s)).toBe(400);
    expect(publicPokerTable(s, "a")).not.toHaveProperty("lastActedBet");
  });
});
const persistentTable = (handNumber = 1): PokerTableConfig => ({
  id: "private-table-1",
  handNumber,
  minBuyIn: 100,
  maxBuyIn: 10000,
  ...pokerBlinds(handNumber),
  sittingOut: [],
  pendingLeave: [],
});
const persistentHand = (stacks: number[], handNumber = 1, dealerIndex = 0) =>
  createPersistentPokerHand(
    stacks.map((stack, index) => ({
      userId: String.fromCharCode(97 + index),
      stack,
    })),
    persistentTable(handNumber),
    dealerIndex,
    1000,
  );
describe("persistent private poker hands", () => {
  it("keeps approved unequal and previously won stacks, escalates bounded blinds, and protects private cards", () => {
    const s = persistentHand([15000, 800, 2200], 11, 1);
    expect(s.seats.map((p) => p.initialStack)).toEqual([15000, 800, 2200]);
    expect(s.pot).toBe(30);
    expect(s.currentBet).toBe(20);
    expect(s.minRaise).toBe(20);
    expect(s.dealerIndex).toBe(1);
    expect(conservation(s)).toBe(18000);
    expect(pokerBlinds(1)).toEqual({ smallBlind: 5, bigBlind: 10 });
    expect(pokerBlinds(10)).toEqual({ smallBlind: 5, bigBlind: 10 });
    expect(pokerBlinds(21)).toEqual({ smallBlind: 20, bigBlind: 40 });
    expect(pokerBlinds(31)).toEqual({ smallBlind: 50, bigBlind: 100 });
    expect(pokerBlinds(10000)).toEqual({ smallBlind: 100, bigBlind: 200 });
    const view = publicPokerTable(s, "a");
    expect(view.table).toEqual(persistentTable(11));
    expect(view.seats.find((p) => p.userId === "b")?.hole).toEqual([-1, -1]);
    expect(view).not.toHaveProperty("deck");
    view.table!.sittingOut.push("mutated");
    expect(s.table?.sittingOut).toEqual([]);
    while (s.phase === "betting")
      act(
        s,
        s.seats[s.turnIndex!].streetBet < s.currentBet
          ? "poker:call"
          : "poker:check",
      );
    expect(conservation(s)).toBe(18000);
    expect(s.result?.winners).toEqual(
      s.seats.filter((p) => p.stack > p.initialStack!).map((p) => p.userId),
    );
  });
  it("rejects invalid funded seats and sitting-out entries without accepting client money claims", () => {
    expect(() => persistentHand([0, 100])).toThrow("stacks");
    expect(() => persistentHand([60001, 100])).toThrow("stacks");
    expect(() => persistentHand([100.5, 100])).toThrow("stacks");
    expect(() => persistentHand([100, 100], 10001)).toThrow("hand number");
    expect(() =>
      createPersistentPokerHand(
        [
          { userId: "a", stack: 100 },
          { userId: "a", stack: 100 },
        ],
        persistentTable(),
      ),
    ).toThrow("different");
    expect(() =>
      createPersistentPokerHand(
        [
          { userId: "a", stack: 100 },
          { userId: "b", stack: 100 },
        ],
        { ...persistentTable(), sittingOut: ["b"] },
      ),
    ).toThrow("Sitting-out");
    expect(() =>
      createPersistentPokerHand(
        [
          { userId: "a", stack: 100 },
          { userId: "b", stack: 100 },
        ],
        { ...persistentTable(), bigBlind: 500 },
      ),
    ).toThrow("blind level");
    expect(() =>
      createPersistentPokerHand(
        [
          { userId: "a", stack: 100 },
          { userId: "b", stack: 100 },
        ],
        { ...persistentTable(), minBuyIn: 500, maxBuyIn: 100 },
      ),
    ).toThrow("Buy-in limits");
  });
  it("requires revisions, rejects replay into later hands, and preserves legacy actions", () => {
    const s = persistentHand([100, 100]);
    const before = JSON.stringify(s);
    expect(() =>
      applyPokerAction(s, "a", { type: "poker:call" }, 1001),
    ).toThrow("require");
    expect(() =>
      applyPokerAction(
        s,
        "a",
        { type: "poker:call", revision: s.revision + 1 },
        1001,
      ),
    ).toThrow("stale");
    expect(JSON.stringify(s)).toBe(before);
    const revision = s.revision;
    applyPokerAction(s, "a", { type: "poker:call", revision }, 1001);
    const next = persistentHand([100, 100], 2);
    expect(() =>
      applyPokerAction(next, "a", { type: "poker:call", revision }, 1002),
    ).toThrow("stale");
    const legacy = createPokerState(["a", "b"], 100, 0, 1000);
    expect(() =>
      applyPokerAction(
        legacy,
        "a",
        { type: "poker:call", revision: 999 },
        1001,
      ),
    ).toThrow("stale");
    applyPokerAction(legacy, "a", { type: "poker:call" }, 1001);
    expect(legacy.revision).toBe(2);
  });
  it("lets a sitting-out table member watch without exposing active private cards or actions", () => {
    const s = createPersistentPokerHand(
      [
        { userId: "a", stack: 100 },
        { userId: "b", stack: 100 },
      ],
      { ...persistentTable(), sittingOut: ["c"] },
    );
    const view = publicPokerTable(s, "c");
    expect(view.self).toEqual({
      toCall: 0,
      minRaiseTo: 0,
      maxRaiseTo: 0,
      canRaise: false,
      canAct: false,
    });
    expect(view.seats.every((p) => p.hole.every((card) => card === -1))).toBe(
      true,
    );
    expect(() =>
      applyPokerAction(s, "c", { type: "poker:call", revision: s.revision }),
    ).toThrow("Join");
    expect(() => publicPokerTable(createPokerState(["a", "b"]), "c")).toThrow(
      "Join",
    );
  });
  it("runs out blind-only all-ins immediately and never strands one-chip retained seats", () => {
    const allBlind = persistentHand([1, 2]);
    expect(allBlind.phase).toBe("settled");
    expect(allBlind.community).toHaveLength(5);
    expect(allBlind.turnIndex).toBeNull();
    expect(conservation(allBlind)).toBe(3);
    const oneActor = persistentHand([100, 1]);
    expect(oneActor.phase).toBe("settled");
    expect(conservation(oneActor)).toBe(101);
    const shortCall = persistentHand([1, 2, 100]);
    expect(shortCall.phase).toBe("betting");
    expect(shortCall.seats[shortCall.turnIndex!].userId).toBe("a");
    act(shortCall, "poker:all-in");
    expect(shortCall.phase).toBe("settled");
    expect(conservation(shortCall)).toBe(103);
  });
  it("settles three unequal all-ins across main, side and uncalled pots", () => {
    const s = persistentHand([100, 200, 300]);
    s.community = [1, 15, 29, 43, 7];
    s.seats[0].hole = [0, 13];
    s.seats[1].hole = [12, 25];
    s.seats[2].hole = [11, 24];
    act(s, "poker:all-in");
    act(s, "poker:all-in");
    act(s, "poker:all-in");
    expect(s.phase).toBe("settled");
    expect(
      s.pots?.map((pot) => ({ amount: pot.amount, winners: pot.winners })),
    ).toEqual([
      { amount: 300, winners: ["a"] },
      { amount: 200, winners: ["b"] },
      { amount: 100, winners: ["c"] },
    ]);
    expect(s.seats.map((p) => p.stack)).toEqual([300, 200, 100]);
    expect(conservation(s)).toBe(600);
  });
  it("splits layered all-in ties, excludes a folded contributor, and awards odd chips clockwise", () => {
    const s = persistentHand([31, 47, 60, 80, 100]);
    s.community = [9, 10, 11, 12, 0];
    for (const [index, seat] of s.seats.entries())
      seat.hole = [13 + index * 2, 14 + index * 2];
    act(s, "poker:raise", { to: 31 }); // d
    act(s, "poker:call"); // e leaves folded money in the main pot
    act(s, "poker:all-in"); // a: 31
    act(s, "poker:all-in"); // b: 47
    act(s, "poker:all-in"); // c: 60
    act(s, "poker:all-in"); // d: 80
    act(s, "poker:fold"); // e
    expect(s.phase).toBe("settled");
    expect(s.pots?.map((p) => p.amount)).toEqual([155, 48, 26, 20]);
    expect(
      s.pots?.every(
        (p) => !p.eligible.includes("e") && !p.winners.includes("e"),
      ),
    ).toBe(true);
    expect(s.seats.map((p) => p.stack)).toEqual([38, 55, 68, 88, 69]);
    expect(conservation(s)).toBe(318);
    expect(publicPokerTable(s, "a").seats[4].hole).toEqual([-1, -1]);
  });
  it("restores unequal approved starting stacks on cancellation and supports timeout revisions", () => {
    const s = persistentHand([14000, 250, 750], 21);
    act(s, "poker:raise", { to: 12000 });
    expect(conservation(s)).toBe(15000);
    cancelPokerState(s, "Table cancelled before settlement");
    expect(s.seats.map((p) => p.stack)).toEqual([14000, 250, 750]);
    expect(s.payouts).toEqual({ a: 14000, b: 250, c: 750 });
    expect(conservation(s)).toBe(15000);
    const expired = persistentHand([100, 100], 2);
    expect(tickPokerState(expired, 31001)).toBe(true);
    expect(expired.phase).toBe("settled");
    expect(conservation(expired)).toBe(200);
  });
  it("conserves every chip through 120 six-player hands with mixed actions and JSON restores", () => {
    let seed = 1729;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    let settlements = 0;
    for (let hand = 1; hand <= 120; hand++) {
      const stacks = Array.from({ length: 6 }, () => 1 + (random() % 9000));
      const expected = stacks.reduce((sum, stack) => sum + stack, 0);
      let s = persistentHand(stacks, hand, hand % 6);
      let actions = 0;
      while (s.phase === "betting") {
        const seat = s.seats[s.turnIndex!];
        const choice = random() % 6;
        const type =
          choice === 0
            ? "poker:fold"
            : choice === 1 && publicPokerTable(s, seat.userId).self.canRaise
              ? "poker:all-in"
              : seat.streetBet < s.currentBet
                ? "poker:call"
                : "poker:check";
        act(s, type);
        expect(conservation(s)).toBe(expected);
        expect(
          s.seats.every((p) => Number.isInteger(p.stack) && p.stack >= 0),
        ).toBe(true);
        expect(++actions).toBeLessThan(200);
        if (actions % 5 === 0) s = JSON.parse(JSON.stringify(s)) as PokerState;
      }
      settlements++;
      expect(s.phase).toBe("settled");
      expect(
        Object.values(s.payouts!).reduce((sum, payout) => sum + payout, 0),
      ).toBe(expected);
    }
    expect(settlements).toBe(120);
  });
});
