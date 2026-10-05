import { describe, it, expect } from "vitest";
import {
  actIncremental,
  advanceIncremental,
  newIncremental,
  machineCost,
} from "../games/server/incremental";
import { actTycoon, advanceTycoon, newTycoon } from "../games/server/tycoon";
import {
  actCasino,
  cardValue,
  mineMultiplier,
  newCasino,
  publicCasino,
} from "../games/server/casino";
import { actDeck, newDeck, publicDeck } from "../games/server/deck";
import { actTower, newTower, simulateWave } from "../games/server/tower";

describe("server authoritative production", () => {
  it("consumes production chains, uses server elapsed time, and caps eight hour absences", () => {
    const state = newIncremental(0);
    state.machines = { extractor: 2, smelter: 1, lab: 1 };
    advanceIncremental(state, 20 * 3600000);
    expect(state.offlineSeconds).toBe(8 * 3600);
    expect(state.insight).toBeGreaterThan(0);
    expect(state.alloy).toBeGreaterThan(0);
    const old = state.spark;
    advanceIncremental(state, 20 * 3600000);
    expect(state.spark).toBe(old);
    advanceIncremental(state, 0);
    expect(state.lastTick).toBe(20 * 3600000);
    expect(state.spark).toBe(old);
  });
  it("prices each purchased machine and refuses production/prestige forgery", () => {
    const state = newIncremental(1000);
    expect(machineCost("extractor", 1)).toBeGreaterThan(
      machineCost("extractor", 0),
    );
    actIncremental(state, "buy", { machine: "extractor" }, 1000);
    expect(state.machines.extractor).toBe(1);
    expect(state.spark).toBe(10);
    expect(() =>
      actIncremental(state, "prestige", { prestige: 500 }, 1000),
    ).toThrow("10,000");
    expect(() =>
      actIncremental(state, "setBalance", { spark: 1e10 }, 1000),
    ).toThrow("Unknown");
    expect(() =>
      actIncremental(state, "buy", { machine: "__proto__" }, 1000),
    ).toThrow("Unknown");
    for (let i = 0; i < 10; i++) actIncremental(state, "tap", {}, 1000);
    expect(() => actIncremental(state, "tap", {}, 1000)).toThrow("ten");
  });
  it("only prestiges against accumulated authoritative production", () => {
    const state = newIncremental(0);
    state.totalProduced = 40000;
    state.lifetimeProduced = 40000;
    state.machines.extractor = 10;
    const reset = actIncremental(state, "prestige", {}, 0);
    expect(reset.prestige).toBe(2);
    expect(reset.machines.extractor).toBe(0);
    expect(reset.lifetimeProduced).toBe(40000);
  });
  it("requires workers for automation and prices prevent infinite demand", () => {
    const state = newTycoon(1000);
    actTycoon(state, "open", { kind: "kiosk" }, 1000);
    const before = state.cash;
    advanceTycoon(state, 61000);
    expect(state.cash).toBe(before);
    actTycoon(state, "hire", { businessId: "1" }, 61000);
    const afterHire = state.cash;
    advanceTycoon(state, 121000);
    expect(state.cash).toBeGreaterThan(afterHire);
    expect(() =>
      actTycoon(state, "price", { businessId: "1", price: Infinity }, 121000),
    ).toThrow("market");
  });
});

describe("fictional casino outcome rules", () => {
  it("handles aces and blackjack with server cards", () => {
    expect(cardValue([0, 13, 9])).toBe(12);
    expect(cardValue([0, 12])).toBe(21);
    expect(cardValue([9, 22, 35])).toBe(30);
  });
  it("never reveals mine locations or dealer hole cards during active rounds", () => {
    const state = newCasino();
    actCasino(state, "mines.start", { bet: 10, bombs: 3 });
    actCasino(state, "blackjack.start", { bet: 10 });
    const safe = publicCasino(state, 1000);
    expect(safe.mines?.mineCells).toBeUndefined();
    if (state.blackjack?.phase === "playing") {
      expect(safe.blackjack?.dealer[1]).toBe(-1);
      expect(safe.blackjack?.dealerValue).toBeNull();
    }
    expect(safe.blackjack?.shoe).toBeUndefined();
  });
  it("prevents repeated reveal/cashout and never trusts browser wins", () => {
    const state = newCasino();
    actCasino(state, "mines.start", { bet: 10, bombs: 1 });
    const cell = Array.from({ length: 25 }, (_, i) => i).find(
      (i) => !state.mines!.mineCells.includes(i),
    )!;
    actCasino(state, "mines.reveal", { cell });
    expect(() => actCasino(state, "mines.reveal", { cell })).toThrow(
      "unrevealed",
    );
    const result = actCasino(state, "mines.cashout", { payout: 1e9 });
    expect(result.credit).toBe(Math.floor(10 * mineMultiplier(1, 1)));
    expect(() => actCasino(state, "mines.cashout", {})).toThrow("first");
    expect(() => actCasino(state, "win", { amount: 1e9 })).toThrow("Unknown");
  });
  it("validates wagers and applies the exact roulette probability payout", () => {
    const state = newCasino();
    expect(() => actCasino(state, "dice", { bet: -1, target: 50 })).toThrow(
      "Wager",
    );
    expect(() => actCasino(state, "roulette", { bet: 5, choice: 37 })).toThrow(
      "Choose",
    );
    const result = actCasino(state, "roulette", { bet: 5, choice: "red" });
    expect(result.debit).toBe(5);
    expect([0, 10]).toContain(result.credit);
    expect(state.rounds).toBe(1);
  });
});

describe("server run simulations", () => {
  it("daily decks are reproducible and secret draw order is withheld", () => {
    const now = Date.UTC(2026, 9, 1, 2);
    const first = newDeck(now, "striker", "daily");
    const second = newDeck(now + 1000, "striker", "daily");
    actDeck(first, "choose", { node: "combat" }, now);
    actDeck(second, "choose", { node: "combat" }, now);
    expect(first.hand).toEqual(second.hand);
    expect(first.enemy).toEqual(second.enemy);
    const safe = publicDeck(first);
    expect(safe).not.toHaveProperty("rng");
    expect(safe).not.toHaveProperty("drawPile");
    expect(safe.drawCount).toBe(3);
  });
  it("enforces map, energy, offered rewards, and real enemy damage", () => {
    const state = newDeck(1000);
    expect(() => actDeck(state, "play", { handIndex: 0 }, 1000)).toThrow(
      "combat",
    );
    actDeck(state, "choose", { node: "combat" }, 1000);
    const hp = state.hp;
    expect(() => actDeck(state, "reward", { card: "thesis" }, 1000)).toThrow(
      "reward",
    );
    actDeck(state, "endTurn", {}, 1000);
    expect(state.hp).toBeLessThan(hp);
    state.energy = 0;
    state.hand = ["heavy"];
    expect(() => actDeck(state, "play", { handIndex: 0 }, 1000)).toThrow(
      "energy",
    );
    expect(() => actDeck(state, "setScore", { score: 10000 }, 1000)).toThrow(
      "Unknown",
    );
  });
  it("rejects path placement, derives kills server-side, and leaks undefended enemies", () => {
    const state = newTower();
    expect(() =>
      actTower(state, "place", { kind: "rapid", x: 3, y: 2 }),
    ).toThrow("path");
    actTower(state, "place", { kind: "rapid", x: 3, y: 1 });
    actTower(state, "wave", {});
    expect(state.wave).toBe(1);
    expect(state.lastWave!.kills + state.lastWave!.leaks).toBe(6);
    expect(state.kills).toBe(state.lastWave!.kills);
    const empty = newTower();
    simulateWave(empty);
    expect(empty.lastWave!.leaks).toBe(6);
    expect(empty.lives).toBe(14);
    expect(() => actTower(state, "setScore", { score: 99 })).toThrow();
  });
});
