import { GameRuleError } from "./rules";
import { createHash, randomInt } from "node:crypto";
import {
  CARD_DEFS,
  EVENT_DEFS,
  RELIC_DEFS,
  getCardDefinition,
  isAttack,
  upgradeCardId,
} from "../config/deck";

export type DeckPhase =
  "map" | "combat" | "reward" | "event" | "rest" | "lost" | "won";
interface EnemyPattern {
  damage?: number;
  hits?: number;
  block?: number;
  strength?: number;
  weak?: number;
  vulnerable?: number;
  cleanse?: boolean;
}
export interface DeckEnemy {
  name: string;
  hp: number;
  maxHp: number;
  intent: number;
  poison: number;
  id?: string;
  block?: number;
  strength?: number;
  weak?: number;
  vulnerable?: number;
  intentHits?: number;
  intentBaseDamage?: number;
  intentLabel?: string;
  intentBlock?: number;
  intentStrength?: number;
  intentWeak?: number;
  intentVulnerable?: number;
  intentCleanse?: boolean;
}
export interface DeckState {
  phase: DeckPhase;
  floor: number;
  hp: number;
  maxHp: number;
  energy: number;
  gold: number;
  block: number;
  character: string;
  mode: string;
  hand: string[];
  deck: string[];
  drawPile: string[];
  discardPile: string[];
  enemy?: DeckEnemy;
  rewardCards: string[];
  relics: string[];
  log: string[];
  score: number;
  rng: number;
  strength: number;
  turn: number;
  node: string;
  runId: string;
  completedAt?: number;
  shopCards: string[];
  contentVersion?: 2;
  eventId?: string;
  removeCount: number;
  dexterity: number;
  weak: number;
  vulnerable: number;
  exhausted: string[];
  exhaustDraw: number;
  exhaustBlock: number;
  skillPoison: number;
  attackBlock: number;
  retainBlock: boolean;
  cardsPlayed: number;
  nextEnergy: number;
  firstAttack: boolean;
  firstBlock: boolean;
  firstPoison: boolean;
  firstSkill: boolean;
}
export const ENEMY_DEFS: Record<
  string,
  { name: string; hpFactor: number; patterns: EnemyPattern[] }
> = {
  page: {
    name: "Loose Page",
    hpFactor: 0.9,
    patterns: [{ damage: 4 }, { damage: 3, hits: 2 }, { damage: 7 }],
  },
  wraith: {
    name: "Ink Wraith",
    hpFactor: 0.85,
    patterns: [{ damage: 5 }, { block: 8, weak: 1 }, { damage: 7 }],
  },
  errata: {
    name: "Errata Beast",
    hpFactor: 1.05,
    patterns: [{ damage: 4 }, { strength: 2 }, { damage: 3, hits: 2 }],
  },
  sentinel: {
    name: "Folded Sentinel",
    hpFactor: 1,
    patterns: [{ damage: 4, block: 4 }, { block: 13 }, { damage: 8 }],
  },
  moth: {
    name: "Archive Moth",
    hpFactor: 0.8,
    patterns: [
      { damage: 3, hits: 2 },
      { damage: 5, vulnerable: 1 },
      { damage: 7 },
    ],
  },
  censor: {
    name: "Margin Censor",
    hpFactor: 0.95,
    patterns: [
      { damage: 5 },
      { block: 6, cleanse: true },
      { damage: 6, weak: 1 },
    ],
  },
  vaultkeeper: {
    name: "Vaultkeeper",
    hpFactor: 1.4,
    patterns: [
      { damage: 7, block: 6 },
      { strength: 2, block: 10 },
      { damage: 5, hits: 2 },
    ],
  },
  duelist: {
    name: "Quill Duelist",
    hpFactor: 1.3,
    patterns: [
      { damage: 4, hits: 2 },
      { vulnerable: 2, block: 8 },
      { damage: 12 },
    ],
  },
  archivist: {
    name: "The Glass Archivist",
    hpFactor: 1.35,
    patterns: [
      { damage: 8 },
      { block: 18, vulnerable: 1 },
      { damage: 5, hits: 2 },
    ],
  },
  editor: {
    name: "The Clockwork Editor",
    hpFactor: 1.55,
    patterns: [
      { damage: 9 },
      { strength: 3, block: 10 },
      { damage: 4, hits: 3 },
      { damage: 7, weak: 2 },
    ],
  },
  index: {
    name: "The Final Index",
    hpFactor: 1.8,
    patterns: [
      { damage: 11 },
      { block: 20, weak: 2 },
      { damage: 5, hits: 3 },
      { damage: 9, cleanse: true },
    ],
  },
};
const normalEnemies = [
  "page",
  "wraith",
  "errata",
  "sentinel",
  "moth",
  "censor",
];
const bosses: Record<number, string> = {
  4: "archivist",
  8: "editor",
  12: "index",
};
const clamp = (value: number, max = 999) => Math.max(0, Math.min(max, value));
function hydrate(state: DeckState) {
  // Persisted first-pass runs have no new combat fields. Keep their routes and
  // old enemy attack cycle; add defaults without restarting or replacing runId.
  state.removeCount ??= 0;
  state.dexterity ??= 0;
  state.weak ??= 0;
  state.vulnerable ??= 0;
  state.exhausted ??= [];
  state.exhaustDraw ??= 0;
  state.exhaustBlock ??= 0;
  state.skillPoison ??= 0;
  state.attackBlock ??= 0;
  state.retainBlock ??= false;
  state.cardsPlayed ??= 0;
  state.nextEnergy ??= 0;
  state.firstAttack ??= false;
  state.firstBlock ??= false;
  state.firstPoison ??= false;
  state.firstSkill ??= false;
  if (state.enemy) {
    state.enemy.block ??= 0;
    state.enemy.strength ??= 0;
    state.enemy.weak ??= 0;
    state.enemy.vulnerable ??= 0;
    state.enemy.intentHits ??= 1;
    state.enemy.intentBaseDamage ??= state.enemy.intent;
  }
  return state;
}
function random(state: DeckState) {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}
function shuffle(state: DeckState, cards: string[]) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random(state) * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
function draw(state: DeckState, count: number) {
  for (let i = 0; i < count && state.hand.length < 10; i++) {
    if (!state.drawPile.length) {
      state.drawPile = shuffle(state, state.discardPile);
      state.discardPile = [];
    }
    const card = state.drawPile.pop();
    if (card) state.hand.push(card);
  }
}
function log(state: DeckState, message: string) {
  state.log = [...state.log.slice(-7), message];
}
function resetTurnFlags(state: DeckState) {
  state.cardsPlayed = 0;
  state.firstAttack = false;
  state.firstBlock = false;
  state.firstPoison = false;
  state.firstSkill = false;
}
function applyAttackModifiers(
  damage: number,
  weak: number,
  vulnerable: number,
) {
  return Math.floor(
    damage * (weak > 0 ? 0.75 : 1) * (vulnerable > 0 ? 1.5 : 1),
  );
}
function refreshIntent(state: DeckState) {
  const enemy = state.enemy!;
  const perHit = enemy.intentBaseDamage
    ? applyAttackModifiers(
        enemy.intentBaseDamage + (enemy.strength ?? 0),
        enemy.weak ?? 0,
        state.vulnerable,
      )
    : 0;
  enemy.intent = perHit * (enemy.intentHits ?? 1);
  const effects: string[] = [];
  if (perHit)
    effects.push(
      `Attack ${perHit}${(enemy.intentHits ?? 1) > 1 ? ` × ${enemy.intentHits}` : ""}`,
    );
  if (enemy.intentBlock) effects.push(`guard ${enemy.intentBlock}`);
  if (enemy.intentStrength)
    effects.push(`gain ${enemy.intentStrength} strength`);
  if (enemy.intentWeak) effects.push(`apply ${enemy.intentWeak} weak`);
  if (enemy.intentVulnerable)
    effects.push(`apply ${enemy.intentVulnerable} vulnerable`);
  if (enemy.intentCleanse) effects.push("halve ink");
  enemy.intentLabel = effects.join(" · ") || "Wait";
}
function planEnemy(state: DeckState) {
  const enemy = state.enemy!;
  const definition = enemy.id && ENEMY_DEFS[enemy.id];
  if (!definition) {
    enemy.intentBaseDamage =
      4 +
      state.floor +
      (state.node === "elite" ? 4 : 0) +
      (state.floor === 12 ? 5 : 0) +
      (state.turn % 3 === 0 ? 3 : 0);
    enemy.intentHits = 1;
  } else {
    const pattern =
      definition.patterns[(state.turn - 1) % definition.patterns.length];
    const enraged = enemy.id === "index" && enemy.hp <= enemy.maxHp / 2;
    enemy.intentBaseDamage = pattern.damage
      ? pattern.damage + Math.ceil(state.floor * 0.65) + (enraged ? 3 : 0)
      : 0;
    enemy.intentHits = pattern.hits ?? 1;
    enemy.intentBlock = pattern.block
      ? pattern.block + Math.floor(state.floor / 2)
      : 0;
    enemy.intentStrength = pattern.strength ?? 0;
    enemy.intentWeak = pattern.weak ?? 0;
    enemy.intentVulnerable = pattern.vulnerable ?? 0;
    enemy.intentCleanse = pattern.cleanse ?? false;
  }
  refreshIntent(state);
}
function availableNodes(state: DeckState) {
  if (state.contentVersion === 2)
    return state.floor % 4 === 3
      ? ["boss"]
      : ["combat", "elite", "rest", "event", "shop"];
  return state.floor >= 11
    ? ["boss"]
    : state.floor % 4 === 3
      ? ["combat", "elite", "rest"]
      : ["combat", "event", "shop"];
}
function unownedRelics(state: DeckState) {
  return Object.keys(RELIC_DEFS).filter((id) => !state.relics.includes(id));
}
function giveRelic(state: DeckState) {
  const choices = unownedRelics(state);
  if (!choices.length) return;
  const relic = choices[Math.floor(random(state) * choices.length)];
  state.relics.push(relic);
  if (relic === "patched-cover") {
    state.maxHp += 10;
    state.hp += 10;
  }
  log(state, `Found ${RELIC_DEFS[relic].name}.`);
}
export function newDeck(
  now: number,
  character = "striker",
  mode = "campaign",
): DeckState {
  if (!["striker", "warden", "spark"].includes(character))
    throw new GameRuleError("Unknown character.");
  if (!["campaign", "daily"].includes(mode))
    throw new GameRuleError("Unknown run mode.");
  const seed =
    mode === "daily"
      ? createHash("sha256")
          .update(new Date(now).toISOString().slice(0, 10))
          .digest()
          .readUInt32LE()
      : randomInt(1, 2147483647);
  const deck = [
    "strike",
    "strike",
    "strike",
    "guard",
    "guard",
    "guard",
    "focus",
    character === "striker"
      ? "heavy"
      : character === "warden"
        ? "brace"
        : "venom",
  ];
  return {
    phase: "map",
    floor: 0,
    hp: character === "warden" ? 75 : 60,
    maxHp: character === "warden" ? 75 : 60,
    energy: 3,
    gold: 60,
    block: 0,
    character,
    mode,
    hand: [],
    deck,
    drawPile: [],
    discardPile: [],
    rewardCards: [],
    relics: [],
    log: [
      "The archive opens. Three guardians stand between you and the Final Index.",
    ],
    score: 0,
    rng: seed,
    strength: 0,
    turn: 0,
    node: "",
    runId: `${now}-${randomInt(1, 2147483647)}`,
    shopCards: [],
    contentVersion: 2,
    removeCount: 0,
    dexterity: 0,
    weak: 0,
    vulnerable: 0,
    exhausted: [],
    exhaustDraw: 0,
    exhaustBlock: 0,
    skillPoison: 0,
    attackBlock: 0,
    retainBlock: false,
    cardsPlayed: 0,
    nextEnergy: 0,
    firstAttack: false,
    firstBlock: false,
    firstPoison: false,
    firstSkill: false,
  };
}
function startBattle(state: DeckState, node: string) {
  let enemy: DeckEnemy;
  if (state.contentVersion === 2) {
    const id =
      bosses[state.floor] ??
      (node === "elite"
        ? random(state) < 0.5
          ? "vaultkeeper"
          : "duelist"
        : normalEnemies[Math.floor(random(state) * normalEnemies.length)]);
    const definition = ENEMY_DEFS[id];
    const hp = Math.floor((24 + state.floor * 7) * definition.hpFactor);
    enemy = {
      id,
      name: definition.name,
      hp,
      maxHp: hp,
      intent: 0,
      poison: state.relics.includes("inkstone") ? 3 : 0,
    };
  } else {
    const elite = node === "elite",
      boss = state.floor === 12;
    const hp = Math.floor(
      (24 + state.floor * 7) * (boss ? 2 : elite ? 1.5 : 1),
    );
    enemy = {
      name: boss
        ? "The Final Index"
        : elite
          ? "Vaultkeeper"
          : ["Loose Page", "Ink Wraith", "Errata Beast"][state.floor % 3],
      hp,
      maxHp: hp,
      intent: 4 + state.floor + (elite ? 4 : 0) + (boss ? 5 : 0),
      poison: 0,
    };
  }
  state.enemy = enemy;
  state.phase = "combat";
  state.node = node;
  state.strength = state.relics.includes("red-pen") ? 1 : 0;
  state.dexterity = 0;
  state.weak = state.vulnerable = 0;
  state.exhausted = [];
  state.exhaustDraw =
    state.exhaustBlock =
    state.skillPoison =
    state.attackBlock =
    state.nextEnergy =
      0;
  state.retainBlock = false;
  resetTurnFlags(state);
  state.block = state.relics.includes("booklight") ? 3 : 0;
  state.turn = 1;
  state.energy = 3 + (state.relics.includes("pocket-watch") ? 1 : 0);
  state.drawPile = shuffle(state, [...state.deck]);
  state.hand = [];
  state.discardPile = [];
  hydrate(state);
  planEnemy(state);
  draw(state, 5 + (state.relics.includes("brass-bookmark") ? 1 : 0));
  log(state, `${state.enemy.name} blocks your path.`);
}
function victory(state: DeckState, now: number) {
  state.enemy!.hp = 0;
  state.gold +=
    25 + state.floor * 5 + (state.relics.includes("collectors-coin") ? 10 : 0);
  state.score += 100 + state.floor * 20 + Math.max(0, 20 - state.turn) * 5;
  state.hand = [];
  state.drawPile = [];
  state.discardPile = [];
  if (state.floor === 12) {
    state.phase = "won";
    state.completedAt = now;
    state.score += state.hp * 10;
    log(state, "The Final Index falls. The archive is yours.");
    return;
  }
  if (
    state.node === "elite" ||
    (state.contentVersion === 2 && bosses[state.floor])
  )
    giveRelic(state);
  state.phase = "reward";
  state.rewardCards = shuffle(
    state,
    Object.keys(CARD_DEFS).filter((key) => !["strike", "guard"].includes(key)),
  ).slice(0, 3);
  log(state, "Choose a new card for your deck.");
}
function deckIndex(state: DeckState, value: unknown, upgrade: boolean) {
  const index = Number(value);
  if (
    typeof value !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= state.deck.length
  )
    throw new GameRuleError("Choose a card in your deck.");
  if (upgrade && !upgradeCardId(state.deck[index]))
    throw new GameRuleError("That card is already upgraded.");
  if (!upgrade && state.deck.length <= 5)
    throw new GameRuleError("Keep at least five cards in your deck.");
  return index;
}
function exhaust(state: DeckState, card: string) {
  state.exhausted.push(card);
  state.block = clamp(
    state.block +
      state.exhaustBlock +
      (state.relics.includes("hollow-quill") ? 2 : 0),
  );
  draw(state, state.exhaustDraw);
}
export function publicDeck(state: DeckState) {
  hydrate(state);
  const { rng: _rng, drawPile, discardPile, ...safe } = state;
  const event = state.eventId ? EVENT_DEFS[state.eventId] : undefined;
  return {
    ...safe,
    drawCount: drawPile.length,
    discardCount: discardPile.length,
    availableNodes: availableNodes(state),
    removeCost: 55 + state.removeCount * 15,
    nextBoss:
      ENEMY_DEFS[bosses[(Math.floor(state.floor / 4) + 1) * 4] ?? "index"].name,
    event: event
      ? {
          name: event.name,
          description: event.description,
          choices: event.choices.map((choice) => ({
            ...choice,
            unavailable:
              state.gold < (choice.goldCost ?? 0) ||
              state.hp <= (choice.hpCost ?? 0) ||
              (choice.relic && !unownedRelics(state).length) ||
              (choice.remove && state.deck.length <= 5) ||
              (choice.upgrade && !state.deck.some((id) => !!upgradeCardId(id))),
          })),
        }
      : undefined,
  };
}
export function actDeck(
  state: DeckState,
  action: string,
  payload: Record<string, unknown>,
  now: number,
) {
  if (action === "start")
    return newDeck(
      now,
      String(payload.character ?? "striker"),
      String(payload.mode ?? "campaign"),
    );
  hydrate(state);
  if (action === "state") return state;
  if (state.phase === "lost" || state.phase === "won")
    throw new GameRuleError("This run is complete. Start a new run.");
  if (action === "choose") {
    if (state.phase !== "map")
      throw new GameRuleError("Finish the current encounter.");
    const node = String(payload.node);
    const allowed = availableNodes(state);
    // Original saved runs accepted "combat" as an alias for the final boss.
    if (!(
      allowed.includes(node) ||
      (!state.contentVersion && state.floor >= 11 && node === "combat")
    ))
      throw new GameRuleError("That route is unavailable on this floor.");
    state.floor++;
    state.node = node;
    state.shopCards = [];
    delete state.eventId;
    if (node === "rest") {
      if (state.contentVersion === 2) {
        state.phase = "rest";
        log(state, "Rest or perfect one page at the reading room.");
      } else {
        state.hp = Math.min(
          state.maxHp,
          state.hp + Math.ceil(state.maxHp * 0.3),
        );
        log(state, "A quiet reading room restores your health.");
      }
    } else if (node === "event") {
      if (state.contentVersion === 2) {
        const ids = Object.keys(EVENT_DEFS);
        state.eventId = ids[Math.floor(random(state) * ids.length)];
        state.phase = "event";
        log(state, EVENT_DEFS[state.eventId].name);
      } else if (random(state) < 0.5) {
        state.gold += 35;
        log(state, "A forgotten bookmark contains 35 gold.");
      } else {
        state.maxHp += 4;
        state.hp = Math.min(state.maxHp, state.hp + 8);
        log(state, "A kind librarian repairs your binding.");
      }
    } else if (node === "shop") {
      state.shopCards = shuffle(
        state,
        Object.keys(CARD_DEFS).filter(
          (key) => !["strike", "guard"].includes(key),
        ),
      ).slice(0, 3);
      log(state, "The bookstall offers cards and a deck-pruning service.");
    } else startBattle(state, node);
    return state;
  }
  if (action === "rest") {
    if (state.phase !== "rest")
      throw new GameRuleError("No reading room is available.");
    const choice = String(payload.choice);
    if (choice === "heal") {
      state.hp = Math.min(state.maxHp, state.hp + Math.ceil(state.maxHp * 0.3));
      log(state, "A quiet reading room restores your health.");
    } else if (choice === "upgrade") {
      const index = deckIndex(state, payload.deckIndex, true);
      state.deck[index] = upgradeCardId(state.deck[index])!;
      log(state, `Perfected ${getCardDefinition(state.deck[index])!.name}.`);
    } else throw new GameRuleError("Choose rest or a card upgrade.");
    state.phase = "map";
    return state;
  }
  if (action === "event") {
    if (state.phase !== "event" || !state.eventId)
      throw new GameRuleError("No event is available.");
    const choice = EVENT_DEFS[state.eventId]?.choices.find(
      (entry) => entry.id === payload.choice,
    );
    if (!choice) throw new GameRuleError("Choose an offered event option.");
    const index =
      choice.upgrade || choice.remove
        ? deckIndex(state, payload.deckIndex, !!choice.upgrade)
        : undefined;
    if (state.gold < (choice.goldCost ?? 0))
      throw new GameRuleError("You need more gold for that option.");
    if (state.hp <= (choice.hpCost ?? 0))
      throw new GameRuleError("You need more health for that option.");
    if (choice.relic && !unownedRelics(state).length)
      throw new GameRuleError("You already own every relic.");
    state.gold += (choice.gold ?? 0) - (choice.goldCost ?? 0);
    state.maxHp += choice.maxHp ?? 0;
    state.hp = Math.min(
      state.maxHp,
      state.hp - (choice.hpCost ?? 0) + (choice.heal ?? 0),
    );
    if (choice.card) state.deck.push(choice.card);
    if (choice.relic) giveRelic(state);
    if (choice.upgrade) state.deck[index!] = upgradeCardId(state.deck[index!])!;
    if (choice.remove) state.deck.splice(index!, 1);
    log(state, choice.description);
    delete state.eventId;
    state.phase = "map";
    return state;
  }
  if (action === "shop") {
    const card = String(payload.card);
    if (state.phase !== "map" || !state.shopCards.includes(card))
      throw new GameRuleError("Card not offered in this shop.");
    if (state.gold < 45) throw new GameRuleError("You need 45 gold.");
    state.gold -= 45;
    state.deck.push(card);
    state.shopCards = state.shopCards.filter((id) => id !== card);
    return state;
  }
  if (action === "remove") {
    if (state.phase !== "map" || state.node !== "shop")
      throw new GameRuleError("Visit a bookstall to remove a card.");
    const index = deckIndex(state, payload.deckIndex, false),
      cost = 55 + state.removeCount * 15;
    if (state.gold < cost) throw new GameRuleError(`You need ${cost} gold.`);
    state.gold -= cost;
    const [card] = state.deck.splice(index, 1);
    state.removeCount++;
    log(state, `Removed ${getCardDefinition(card)!.name}.`);
    return state;
  }
  if (action === "reward") {
    if (state.phase !== "reward")
      throw new GameRuleError("No card reward is available.");
    const card = String(payload.card);
    if (card !== "skip" && !state.rewardCards.includes(card))
      throw new GameRuleError("Choose an offered card.");
    if (card !== "skip") state.deck.push(card);
    state.rewardCards = [];
    state.phase = "map";
    return state;
  }
  if (state.phase !== "combat" || !state.enemy)
    throw new GameRuleError("Choose a combat route first.");
  if (action === "play") {
    const index = Number(payload.handIndex);
    if (
      typeof payload.handIndex !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= state.hand.length
    )
      throw new GameRuleError("Choose a card in your hand.");
    const cardId = state.hand[index],
      card = getCardDefinition(cardId);
    if (!card) throw new GameRuleError("This card is unavailable.");
    if (state.energy < card.cost) throw new GameRuleError("Not enough energy.");
    if (card.lifeCost && state.hp <= card.lifeCost)
      throw new GameRuleError("Not enough health to play that card.");
    state.energy -= card.cost;
    state.hp -= card.lifeCost ?? 0;
    state.hand.splice(index, 1);
    // Capture the targets before exhaust-triggered draws change the hand.
    const targets = state.hand.splice(0, card.exhaustHand ?? 0);
    const attack = isAttack(card),
      oldSkillPoison = state.skillPoison,
      oldPoison = state.enemy.poison;
    const bonus =
      state.character === "striker" &&
      state.contentVersion === 2 &&
      attack &&
      !state.firstAttack
        ? 2
        : 0;
    if (card.stripEnemyBlock) state.enemy.block = 0;
    if (attack) {
      const base =
        (card.damage ?? 0) +
        (card.blockDamage ? state.block : 0) +
        (card.poisonDamageMultiplier ?? 0) * state.enemy.poison +
        (card.damagePerExhaust ?? 0) * state.exhausted.length +
        (card.comboDamage ?? 0) * state.cardsPlayed +
        state.strength;
      for (let hit = 0; hit < (card.hits ?? 1); hit++) {
        const damage = applyAttackModifiers(
          base + (hit === 0 ? bonus : 0),
          state.weak,
          state.enemy.vulnerable ?? 0,
        );
        const absorbed = Math.min(state.enemy.block ?? 0, damage);
        state.enemy.block = (state.enemy.block ?? 0) - absorbed;
        state.enemy.hp -= damage - absorbed;
      }
      state.firstAttack = true;
      state.block = clamp(state.block + state.attackBlock);
    }
    if (card.consumeBlock) state.block = 0;
    if (card.consumePoison) state.enemy.poison = 0;
    const block =
      (card.block ?? 0) + (card.blockPerPoison ?? 0) * state.enemy.poison;
    if (block > 0) {
      state.block = clamp(
        state.block +
          block +
          state.dexterity +
          (state.character === "warden" &&
          state.contentVersion === 2 &&
          !state.firstBlock
            ? 2
            : 0),
      );
      state.firstBlock = true;
    }
    state.enemy.poison = clamp(
      state.enemy.poison + (card.poison ?? 0) + (!attack ? oldSkillPoison : 0),
    );
    if (card.poisonMultiplier)
      state.enemy.poison = clamp(state.enemy.poison * card.poisonMultiplier);
    if (
      state.enemy.poison > oldPoison &&
      state.character === "spark" &&
      state.contentVersion === 2 &&
      !state.firstPoison
    ) {
      state.enemy.poison = clamp(state.enemy.poison + 1);
      state.firstPoison = true;
    }
    state.enemy.weak = clamp((state.enemy.weak ?? 0) + (card.weak ?? 0), 20);
    state.enemy.vulnerable = clamp(
      (state.enemy.vulnerable ?? 0) + (card.vulnerable ?? 0),
      20,
    );
    state.hp = Math.min(state.maxHp, state.hp + (card.heal ?? 0));
    state.energy = clamp(state.energy + (card.energy ?? 0), 99);
    state.strength = clamp(state.strength + (card.strength ?? 0));
    state.dexterity = clamp(state.dexterity + (card.dexterity ?? 0));
    state.nextEnergy = clamp(state.nextEnergy + (card.nextEnergy ?? 0), 99);
    state.exhaustDraw = clamp(state.exhaustDraw + (card.exhaustDraw ?? 0), 10);
    state.exhaustBlock = clamp(state.exhaustBlock + (card.exhaustBlock ?? 0));
    state.skillPoison = clamp(state.skillPoison + (card.skillPoison ?? 0));
    state.attackBlock = clamp(state.attackBlock + (card.attackBlock ?? 0));
    state.retainBlock ||= card.retainBlock ?? false;
    if (card.cleanse) state.weak = state.vulnerable = 0;
    for (
      let i = 0;
      i < (card.returnDiscard ?? 0) && state.hand.length < 10;
      i++
    ) {
      const returned = state.discardPile.pop();
      if (returned) state.hand.push(returned);
    }
    targets.forEach((target) => exhaust(state, target));
    if (card.exhaust) exhaust(state, cardId);
    else state.discardPile.push(cardId);
    const lensDraw =
      !attack && !state.firstSkill && state.relics.includes("reading-lens")
        ? 1
        : 0;
    if (!attack) state.firstSkill = true;
    draw(state, (card.draw ?? 0) + lensDraw);
    state.cardsPlayed++;
    refreshIntent(state);
    log(state, `Played ${card.name}.`);
    if (state.enemy.hp <= 0) victory(state, now);
    return state;
  }
  if (action === "endTurn") {
    const enemy = state.enemy;
    enemy.hp -= enemy.poison;
    enemy.poison = Math.max(0, enemy.poison - 1);
    if (enemy.hp <= 0) {
      victory(state, now);
      return state;
    }
    refreshIntent(state);
    enemy.block = 0;
    const perHit = enemy.intent / (enemy.intentHits ?? 1);
    let taken = 0;
    for (let hit = 0; hit < (enemy.intentHits ?? 1); hit++) {
      const absorbed = Math.min(state.block, perHit);
      state.block -= absorbed;
      taken += perHit - absorbed;
    }
    state.hp -= taken;
    log(
      state,
      enemy.intent
        ? `${enemy.name} deals ${taken} damage.`
        : `${enemy.name}: ${enemy.intentLabel}.`,
    );
    if (state.hp <= 0) {
      state.hp = 0;
      state.phase = "lost";
      state.completedAt = now;
      log(state, "Your story ends here. A new run awaits.");
      return state;
    }
    // Existing player statuses expire before fresh enemy statuses are applied.
    state.weak = Math.max(0, state.weak - 1) + (enemy.intentWeak ?? 0);
    state.vulnerable =
      Math.max(0, state.vulnerable - 1) + (enemy.intentVulnerable ?? 0);
    enemy.weak = Math.max(0, (enemy.weak ?? 0) - 1);
    enemy.vulnerable = Math.max(0, (enemy.vulnerable ?? 0) - 1);
    enemy.block = enemy.intentBlock ?? 0;
    enemy.strength = clamp((enemy.strength ?? 0) + (enemy.intentStrength ?? 0));
    if (enemy.intentCleanse) enemy.poison = Math.floor(enemy.poison / 2);
    state.discardPile.push(...state.hand);
    state.hand = [];
    state.block = state.retainBlock
      ? state.block
      : state.relics.includes("silver-clasp")
        ? Math.min(5, state.block)
        : 0;
    state.energy = Math.min(99, 3 + state.nextEnergy);
    state.nextEnergy = 0;
    state.turn++;
    resetTurnFlags(state);
    if (state.relics.includes("booklight"))
      state.block = clamp(state.block + 3);
    planEnemy(state);
    draw(state, 5);
    return state;
  }
  throw new GameRuleError("Unknown deck action.");
}
