import { describe, expect, it } from "vitest";
import {
  CARD_DEFS,
  EVENT_DEFS,
  RELIC_DEFS,
  getCardDefinition,
  upgradeCardId,
} from "../games/config/deck";
import {
  actDeck,
  ENEMY_DEFS,
  newDeck,
  publicDeck,
  type DeckState,
} from "../games/server/deck";

const now = Date.UTC(2026, 9, 3, 7);
function combat(character = "striker") {
  const state = newDeck(now, character, "daily");
  actDeck(state, "choose", { node: "combat" }, now);
  state.enemy!.hp = state.enemy!.maxHp = 1000;
  state.enemy!.block = 0;
  state.enemy!.poison = 0;
  state.energy = 99;
  state.hand = [];
  state.drawPile = [];
  state.discardPile = [];
  return state;
}
function play(state: DeckState, card: string) {
  state.hand.push(card);
  actDeck(state, "play", { handIndex: state.hand.length - 1 }, now);
}

describe("Paper Odyssey card builds", () => {
  it("has 44 distinct working cards and improves each one exactly once without changing old IDs", () => {
    expect(Object.keys(CARD_DEFS)).toHaveLength(44);
    const originals = [
      "strike",
      "guard",
      "spark",
      "heavy",
      "venom",
      "focus",
      "brace",
      "surge",
      "mend",
      "fury",
      "riposte",
      "thesis",
      "annotate",
      "toxin",
      "bastion",
      "insight",
      "flourish",
      "restitch",
    ];
    originals.forEach((id) =>
      expect(getCardDefinition(id)).toBe(CARD_DEFS[id]),
    );
    for (const id of Object.keys(CARD_DEFS)) {
      const upgraded = upgradeCardId(id)!;
      const base = CARD_DEFS[id],
        changed = getCardDefinition(upgraded)!;
      const {
        name: _baseName,
        description: _baseDescription,
        ...baseEffects
      } = base;
      const { name: _name, description: _description, ...effects } = changed;
      expect(effects, id).not.toEqual(baseEffects);
      expect(upgradeCardId(upgraded)).toBeUndefined();
      const state = combat();
      state.hp = 50;
      state.block = 12;
      state.enemy!.poison = 5;
      state.drawPile = ["strike", "guard", "guard"];
      state.discardPile = ["guard", "strike"];
      state.hand = ["guard"];
      expect(() => play(state, id), id).not.toThrow();
      expect(state.hand.length).toBeLessThanOrEqual(10);
      expect(Number.isFinite(state.enemy!.hp), id).toBe(true);
    }
    expect(getCardDefinition("constructor")).toBeUndefined();
    expect(getCardDefinition("strike++")).toBeUndefined();
  });
  it("multihit strength, weak, vulnerable, and the first-attack passive use each hit's real damage", () => {
    const state = combat();
    play(state, "fury");
    state.enemy!.vulnerable = 2;
    state.weak = 1;
    // (4 + 2 strength + 2 Striker bonus) × .75 × 1.5 = 9;
    // subsequent hits are floor(6 × .75 × 1.5) = 6 each.
    play(state, "crossreference");
    expect(state.enemy!.hp).toBe(979);
    play(state, "crossreference");
    expect(state.enemy!.hp).toBe(961);
    expect(state.firstAttack).toBe(true);
  });
  it("a defense build retains only unspent block, scales dexterity, and turns it into an attack", () => {
    const state = combat("warden");
    state.enemy!.id = undefined;
    state.enemy!.intentBaseDamage = 5;
    state.enemy!.intentHits = 1;
    state.enemy!.intentBlock = 0;
    play(state, "fortify");
    play(state, "enduring");
    play(state, "guard");
    expect(state.block).toBe(10); // 6 + 2 dexterity + 2 first-block passive
    actDeck(state, "endTurn", {}, now);
    expect(state.block).toBe(5);
    state.energy = 99;
    play(state, "shieldbash");
    expect(state.enemy!.hp).toBe(995);
    expect(state.block).toBe(0);
    expect(state.retainBlock).toBe(true);
  });
  it("ink builds scale non-attacks, double stacks, defend from ink, and exchange stacks for burst", () => {
    const state = combat("spark");
    play(state, "inkwell");
    expect(state.enemy!.poison).toBe(0); // its own power is not retroactive
    play(state, "venom");
    expect(state.enemy!.poison).toBe(8); // 5 + 2 power + 1 first-ink passive
    play(state, "blot");
    expect(state.enemy!.poison).toBe(20); // (8 + 2 non-attack) × 2
    play(state, "inkguard");
    expect(state.block).toBe(23); // observes the 20 stacks before its own power adds ink
    expect(state.enemy!.poison).toBe(22);
    play(state, "purge");
    expect(state.enemy!.hp).toBe(956);
    expect(state.enemy!.poison).toBe(0);
  });
  it("exhaust powers trigger per exhausted card, preserve the permanent deck, and fuel burst damage", () => {
    const state = combat();
    state.drawPile = [
      "strike",
      "guard",
      "guard",
      "strike",
      "guard",
      "strike",
      "guard",
      "guard",
    ];
    const permanent = [...state.deck];
    play(state, "rebind");
    expect(state.exhausted).toEqual(["rebind"]);
    expect(state.hand).toHaveLength(1);
    play(state, "ashguard");
    expect(state.block).toBe(4);
    expect(state.exhausted).toHaveLength(2);
    const leftmost = state.hand[0];
    play(state, "paperfuel");
    expect(state.exhausted).toEqual([
      "rebind",
      "ashguard",
      leftmost,
      "paperfuel",
    ]);
    expect(state.block).toBe(12);
    play(state, "redaction");
    expect(state.enemy!.hp).toBe(976); // 6 + 4×4 + Striker's first attack +2
    expect(state.deck).toEqual(permanent);
    state.enemy!.hp = 1;
    play(state, "strike");
    actDeck(state, "reward", { card: "skip" }, now);
    actDeck(state, "choose", { node: "combat" }, now);
    expect(state.exhausted).toEqual([]);
    expect(state.exhaustDraw).toBe(0);
  });
  it("salvage returns a known discarded card and next-turn energy is consumed once", () => {
    const state = combat("warden");
    state.discardPile = ["heavy", "guard"];
    play(state, "salvage+");
    expect(state.hand).toEqual(["guard", "heavy"]);
    expect(state.discardPile).toEqual([]);
    play(state, "bookmark");
    actDeck(state, "endTurn", {}, now);
    expect(state.energy).toBe(5);
    actDeck(state, "endTurn", {}, now);
    expect(state.energy).toBe(3);
    state.hp = 4;
    state.hand = ["lastword"];
    const before = structuredClone(state);
    expect(() => actDeck(state, "play", { handIndex: 0 }, now)).toThrow(
      "health",
    );
    expect(state).toEqual(before);
  });
});

describe("Paper Odyssey encounters and choices", () => {
  it("all three bosses are mandatory in new expeditions and telegraph different actual actions", () => {
    for (const [floor, id] of [
      [4, "archivist"],
      [8, "editor"],
      [12, "index"],
    ] as const) {
      const state = newDeck(now, "warden", "daily");
      state.floor = floor - 1;
      expect(publicDeck(state).availableNodes).toEqual(["boss"]);
      expect(() => actDeck(state, "choose", { node: "rest" }, now)).toThrow(
        "unavailable",
      );
      actDeck(state, "choose", { node: "boss" }, now);
      expect(state.enemy!.id).toBe(id);
      expect(state.enemy!.intentLabel).toContain("Attack");
      state.hp = state.maxHp = 999;
      const hp = state.hp,
        expected = state.enemy!.intent;
      actDeck(state, "endTurn", {}, now);
      expect(state.hp).toBe(hp - expected);
      expect(state.enemy!.intent).toBe(0);
      expect(state.enemy!.intentLabel).toMatch(/guard|strength/);
      const guardingHp = state.hp;
      actDeck(state, "endTurn", {}, now);
      expect(state.hp).toBe(guardingHp);
      expect(state.enemy!.block).toBeGreaterThan(0);
      expect(state.enemy!.intentHits).toBe(
        id === "editor" || id === "index" ? 3 : 2,
      );
    }
    expect(Object.keys(ENEMY_DEFS)).toHaveLength(11);
  });
  it("enemy block absorbs each hit, sealing cards remove it, and poison resolves before attacks", () => {
    const state = combat("warden");
    state.enemy!.block = 7;
    play(state, "crossreference");
    expect(state.enemy!.hp).toBe(995); // total 12 minus 7 armor
    state.enemy!.block = 50;
    play(state, "shatter");
    expect(state.enemy!.hp).toBe(986);
    expect(state.enemy!.block).toBe(0);
    state.enemy!.hp = 5;
    state.enemy!.poison = 5;
    state.enemy!.intentBaseDamage = 99;
    const hp = state.hp;
    actDeck(state, "endTurn", {}, now);
    expect(state.phase).toBe("reward");
    expect(state.hp).toBe(hp);
  });
  it("events expose real selectable outcomes, reject forged choices and charges, and cannot replay", () => {
    expect(Object.keys(EVENT_DEFS)).toHaveLength(6);
    const state = newDeck(now);
    state.phase = "event";
    state.eventId = "merchant";
    state.gold = 49;
    const before = structuredClone(state);
    expect(() =>
      actDeck(state, "event", { choice: "relic", gold: 1e9 }, now),
    ).toThrow("gold");
    expect(state).toEqual(before);
    expect(() => actDeck(state, "event", { choice: "forged" }, now)).toThrow(
      "offered",
    );
    state.gold = 50;
    actDeck(state, "event", { choice: "relic" }, now);
    expect(state.gold).toBe(0);
    expect(state.relics).toHaveLength(1);
    expect(state.phase).toBe("map");
    expect(() => actDeck(state, "event", { choice: "relic" }, now)).toThrow(
      "event",
    );
    state.phase = "event";
    state.eventId = "fire";
    const length = state.deck.length,
      hp = state.hp;
    actDeck(state, "event", { choice: "remove", deckIndex: 0 }, now);
    expect(state.deck).toHaveLength(length - 1);
    expect(state.hp).toBe(hp - 4);
  });
  it("rest upgrades real deck entries, rejects a second upgrade, and validates exact deck indexes", () => {
    const state = newDeck(now);
    actDeck(state, "choose", { node: "rest" }, now);
    actDeck(state, "rest", { choice: "upgrade", deckIndex: 0 }, now);
    expect(state.deck[0]).toBe("strike+");
    expect(getCardDefinition(state.deck[0])!.damage).toBe(9);
    actDeck(state, "choose", { node: "rest" }, now);
    const before = structuredClone(state);
    expect(() =>
      actDeck(state, "rest", { choice: "upgrade", deckIndex: 0 }, now),
    ).toThrow("already upgraded");
    expect(() =>
      actDeck(state, "rest", { choice: "upgrade", deckIndex: null }, now),
    ).toThrow("Choose a card");
    expect(state).toEqual(before);
    state.hp = 20;
    actDeck(state, "rest", { choice: "heal" }, now);
    expect(state.hp).toBe(38);
  });
  it("bookstall removal has a growing server price and stale offers disappear when leaving", () => {
    const state = newDeck(now);
    state.gold = 200;
    actDeck(state, "choose", { node: "shop" }, now);
    const offered = state.shopCards[0];
    actDeck(state, "remove", { deckIndex: 0, cost: 0 }, now);
    expect(state.gold).toBe(145);
    expect(publicDeck(state).removeCost).toBe(70);
    actDeck(state, "remove", { deckIndex: 0 }, now);
    const before = structuredClone(state);
    expect(() => actDeck(state, "remove", { deckIndex: 0 }, now)).toThrow(
      "85 gold",
    );
    expect(state).toEqual(before);
    state.gold = 500;
    actDeck(state, "remove", { deckIndex: 0 }, now);
    expect(state.deck).toHaveLength(5);
    expect(() => actDeck(state, "remove", { deckIndex: 0 }, now)).toThrow(
      "five",
    );
    actDeck(state, "choose", { node: "combat" }, now);
    expect(state.shopCards).toEqual([]);
    expect(() => actDeck(state, "shop", { card: offered }, now)).toThrow(
      "not offered",
    );
    expect(() => actDeck(state, "remove", { deckIndex: 0 }, now)).toThrow(
      "bookstall",
    );
  });
});

describe("Paper Odyssey complete expeditions", () => {
  it("a prepared ink/exhaust build beats all three guardians through real turns and keeps one scored run identity", () => {
    const state = newDeck(now, "spark", "daily");
    // A saved build fixture uses only catalog cards and legal single upgrades.
    // Enemy health, actions, player health, and rewards resolve normally.
    state.deck = [
      "enduring+",
      "fortify+",
      "ashguard+",
      "rebind+",
      "inkwell+",
      "drying+",
      "blot+",
      "venom+",
      "inkguard+",
      "recovery+",
      "bookmark+",
    ];
    const rank = [
      "rebind",
      "ashguard",
      "inkwell",
      "enduring",
      "fortify",
      "drying",
      "venom",
      "blot",
      "inkguard",
      "recovery",
      "bookmark",
    ];
    const runId = state.runId,
      guardians: string[] = [];
    let actions = 0;
    while (state.phase !== "won" && state.phase !== "lost" && actions++ < 200) {
      const clock = now + actions;
      if (state.phase === "map") {
        actDeck(
          state,
          "choose",
          { node: state.floor % 4 === 3 ? "boss" : "rest" },
          clock,
        );
        if (state.node === "boss") guardians.push(state.enemy!.name);
      } else if (state.phase === "rest")
        actDeck(state, "rest", { choice: "heal" }, clock);
      else if (state.phase === "reward")
        actDeck(state, "reward", { card: "skip" }, clock);
      else if (state.phase === "combat") {
        const candidate = state.hand
          .map((id, index) => ({ id, index, card: getCardDefinition(id)! }))
          .filter(
            ({ card }) =>
              card.cost <= state.energy && state.hp > (card.lifeCost ?? 0),
          )
          .sort(
            (a, b) =>
              rank.indexOf(a.id.replace("+", "")) -
              rank.indexOf(b.id.replace("+", "")),
          )[0];
        actDeck(
          state,
          candidate ? "play" : "endTurn",
          candidate ? { handIndex: candidate.index, score: 1e9 } : {},
          clock,
        );
      }
    }
    expect(state.phase).toBe("won");
    expect(guardians).toEqual([
      "The Glass Archivist",
      "The Clockwork Editor",
      "The Final Index",
    ]);
    expect(state.floor).toBe(12);
    expect(state.hp).toBeGreaterThan(0);
    expect(state.score).toBeGreaterThan(1000);
    expect(state.score).toBeLessThan(10000);
    expect(state.completedAt).toBe(now + actions);
    expect(state.runId).toBe(runId);
    expect(state.relics).toHaveLength(2);
    const completed = structuredClone(state);
    expect(() => actDeck(state, "endTurn", {}, now + 1000)).toThrow("complete");
    expect(state).toEqual(completed);
  });
});

describe("Paper Odyssey run and relic compatibility", () => {
  it("all ten relics have concrete effects and generated rewards never duplicate one", () => {
    expect(Object.keys(RELIC_DEFS)).toHaveLength(10);
    const state = newDeck(now, "warden", "daily");
    state.relics = [
      "red-pen",
      "booklight",
      "brass-bookmark",
      "inkstone",
      "pocket-watch",
      "hollow-quill",
      "reading-lens",
      "silver-clasp",
      "collectors-coin",
    ];
    actDeck(state, "choose", { node: "combat" }, now);
    expect(state.strength).toBe(1);
    expect(state.block).toBe(3);
    expect(state.hand).toHaveLength(6);
    expect(state.energy).toBe(4);
    expect(state.enemy!.poison).toBe(3);
    state.hand = ["annotate"];
    state.drawPile = ["guard", "guard", "strike"];
    state.discardPile = [];
    actDeck(state, "play", { handIndex: 0 }, now);
    expect(state.hand).toHaveLength(2); // annotate plus first non-attack lens
    expect(state.block).toBe(5); // +2 hollow quill
    state.block = 50;
    actDeck(state, "endTurn", {}, now);
    expect(state.block).toBe(8); // clasp keeps 5 + booklight 3
    state.floor = 3;
    state.phase = "map";
    state.gold = 10;
    actDeck(state, "choose", { node: "boss" }, now);
    state.enemy!.hp = 1;
    state.enemy!.poison = 1;
    const maxHp = state.maxHp;
    actDeck(state, "endTurn", {}, now);
    expect(state.gold).toBe(65); // 10 + 25 + 4×5 + collector10
    expect(state.relics).toContain("patched-cover");
    expect(new Set(state.relics).size).toBe(10);
    expect(state.maxHp).toBe(maxHp + 10);
  });
  it("daily content, event choices, shops, boss rewards, and draws repeat for the same action sequence", () => {
    const first = newDeck(now, "spark", "daily"),
      second = newDeck(now + 1000, "spark", "daily");
    const ids = [first.runId, second.runId];
    for (const state of [first, second]) {
      actDeck(state, "choose", { node: "event" }, now);
      actDeck(state, "event", { choice: "leave" }, now);
      actDeck(state, "choose", { node: "shop" }, now);
      actDeck(state, "choose", { node: "rest" }, now);
      actDeck(state, "rest", { choice: "upgrade", deckIndex: 7 }, now);
      actDeck(state, "choose", { node: "boss" }, now);
    }
    expect(first.enemy).toEqual(second.enemy);
    expect(first.hand).toEqual(second.hand);
    expect(first.rng).toBe(second.rng);
    expect([first.runId, second.runId]).toEqual(ids);
    const safe = publicDeck(first);
    expect(safe).not.toHaveProperty("rng");
    expect(safe).not.toHaveProperty("drawPile");
    expect(safe).not.toHaveProperty("discardPile");
    expect(safe).not.toHaveProperty("patterns");
    expect(safe.enemy).not.toHaveProperty("patterns");
  });
  it("old serialized runs retain identity, old route options, and the original enemy cycle", () => {
    const state = newDeck(now);
    const raw = state as unknown as Record<string, unknown>;
    for (const field of [
      "contentVersion",
      "removeCount",
      "dexterity",
      "weak",
      "vulnerable",
      "exhausted",
      "exhaustDraw",
      "exhaustBlock",
      "skillPoison",
      "attackBlock",
      "retainBlock",
      "cardsPlayed",
      "nextEnergy",
      "firstAttack",
      "firstBlock",
      "firstPoison",
      "firstSkill",
    ])
      delete raw[field];
    state.floor = 3;
    const runId = state.runId;
    expect(publicDeck(state).availableNodes).toEqual([
      "combat",
      "elite",
      "rest",
    ]);
    actDeck(state, "choose", { node: "combat" }, now);
    expect(state.enemy!.name).toBe("Ink Wraith");
    expect(state.enemy!.id).toBeUndefined();
    state.energy = 3;
    state.hand = ["strike"];
    const enemyHp = state.enemy!.hp;
    actDeck(state, "play", { handIndex: 0 }, now);
    expect(state.enemy!.hp).toBe(enemyHp - 6); // no new Striker passive
    actDeck(state, "endTurn", {}, now);
    expect(state.enemy!.intent).toBe(8);
    expect(state.runId).toBe(runId);
    state.phase = "map";
    state.floor = 11;
    actDeck(state, "choose", { node: "combat" }, now);
    expect(state.enemy!.name).toBe("The Final Index");
    state.enemy!.hp = 1;
    state.enemy!.poison = 1;
    actDeck(state, "endTurn", {}, now + 99);
    expect(state.phase).toBe("won");
    expect(state.completedAt).toBe(now + 99);
    expect(state.runId).toBe(runId);
  });
});
