import { describe, expect, it } from "vitest";
import { actCasino, newCasino, publicCasino } from "../games/server/casino";
import {
  actPoker,
  pokerValue,
  startPoker,
  type PokerHand,
} from "../games/server/poker";
import { loanDebt } from "../packages/platform/src/casinoEconomy";

describe("heads-up poker integrity", () => {
  it("ranks five-card combinations, including ace-low straights, and selects the best seven-card hand", () => {
    const royal = [0, 9, 10, 11, 12];
    const quads = [0, 13, 26, 39, 12];
    const fullHouse = [0, 13, 26, 12, 25];
    const flush = [0, 2, 5, 8, 11];
    const straight = [0, 14, 28, 42, 4];
    const trips = [0, 13, 26, 11, 23];
    const twoPair = [0, 13, 12, 25, 11];
    const pair = [0, 13, 12, 24, 10];
    const high = [0, 24, 35, 46, 2];
    const values = [
      royal,
      quads,
      fullHouse,
      flush,
      straight,
      trips,
      twoPair,
      pair,
      high,
    ].map(pokerValue);
    for (let index = 1; index < values.length; index++)
      expect(values[index - 1]).toBeGreaterThan(values[index]);
    expect(pokerValue([...royal, 14, 28])).toBe(pokerValue(royal));
    expect(() => pokerValue([0, 0, 1, 2, 3])).toThrow("distinct");
  });

  it("keeps the house cards and remaining deck hidden until a hand settles", () => {
    const state = newCasino();
    const stake = actCasino(state, "poker.start", {
      bet: 10,
      botCards: [0, 12],
    });
    expect(stake.debit).toBe(10);
    const safe = publicCasino(state, 990);
    expect(safe.poker?.botCards).toEqual([-1, -1]);
    expect(safe.poker).not.toHaveProperty("deck");
    expect(
      new Set([
        ...state.poker!.playerCards,
        ...state.poker!.botCards,
        ...state.poker!.deck,
      ]).size,
    ).toBe(52);
    expect(() => actCasino(state, "poker.start", { bet: 10 })).toThrow(
      "Finish",
    );
    actCasino(state, "poker.fold", { payout: 999999 });
    expect(publicCasino(state, 990).poker?.botCards).toEqual(
      state.poker!.botCards,
    );
    expect(state.rounds).toBe(1);
    expect(() => actCasino(state, "poker.fold", {})).toThrow("Start");
    expect(state.rounds).toBe(1);
  });

  it("deals all streets through check/call decisions and settles only once", () => {
    const hand = startPoker(10);
    let debited = 10;
    for (
      let decision = 0;
      decision < 8 && hand.phase === "playing";
      decision++
    ) {
      const result = actPoker(
        hand,
        hand.toCall ? "poker.call" : "poker.check",
        {},
      );
      debited += result.debit;
    }
    expect(hand.phase).toBe("settled");
    expect(hand.street).toBe("river");
    expect(hand.community).toHaveLength(5);
    expect(hand.playerContribution).toBe(debited);
    expect(hand.pot).toBe(hand.playerContribution + hand.botContribution);
    expect([0, Math.floor(hand.pot / 2), hand.pot]).toContain(hand.payout);
    expect(() => actPoker(hand, "poker.call", {})).toThrow("Start");
  });

  it("splits an equal showdown and rejects illegal check, call, and raises", () => {
    const hand: PokerHand = {
      ...startPoker(10),
      street: "river",
      playerCards: [1, 2],
      botCards: [14, 15],
      community: [0, 9, 10, 11, 12],
      pot: 25,
      toCall: 5,
      playerContribution: 10,
      botContribution: 15,
    };
    expect(() => actPoker(hand, "poker.check", {})).toThrow("Call");
    for (const amount of [0, 14, Infinity, 1.5, 100001])
      expect(() => actPoker(hand, "poker.raise", { amount })).toThrow("Raise");
    const result = actPoker(hand, "poker.call", {});
    expect(result).toEqual({ debit: 5, credit: 15 });
    expect(hand.outcome).toBe("Split pot");
    expect(() => actPoker(startPoker(10), "poker.call", {})).toThrow("no bet");
  });
});

describe("Plinko and fictional loan terms", () => {
  it("derives the slot and payout exclusively from the server-generated path", () => {
    const state = newCasino();
    const result = actCasino(state, "plinko", {
      bet: 10,
      path: [1, 1],
      slot: 8,
      multiplier: 999999,
    });
    const path = state.lastResult!.path as number[];
    expect(path).toHaveLength(8);
    expect(path.every((side) => side === 0 || side === 1)).toBe(true);
    const slot = path.reduce((sum, side) => sum + side, 0);
    const multiplier = [12, 3, 1.7, 0.4, 0.5, 0.4, 1.7, 3, 12][slot];
    expect(state.lastResult!.slot).toBe(slot);
    expect(result).toMatchObject({
      debit: 10,
      credit: Math.floor(10 * multiplier),
    });
    expect(state.rounds).toBe(1);
    expect(() => actCasino(state, "plinko", { bet: -1 })).toThrow("Wager");
  });

  it("uses elapsed server time, rounds interest down, and caps interest at the principal", () => {
    const borrowed = Date.UTC(2026, 0, 1);
    expect(
      loanDebt(500, new Date(borrowed), borrowed + 3.5 * 86400000),
    ).toEqual({ principal: 500, interest: 17, total: 517 });
    expect(
      loanDebt(500, new Date(borrowed), borrowed + 200 * 86400000),
    ).toEqual({ principal: 500, interest: 500, total: 1000 });
    expect(
      loanDebt(500, new Date(borrowed), borrowed - 86400000).interest,
    ).toBe(0);
    expect(loanDebt(0, null, borrowed)).toEqual({
      principal: 0,
      interest: 0,
      total: 0,
    });
  });
});
