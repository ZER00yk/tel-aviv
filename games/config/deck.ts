export type CardArchetype = "attack" | "guard" | "ink" | "exhaust" | "utility";
export interface CardDefinition {
  name: string;
  cost: number;
  archetype?: CardArchetype;
  damage?: number;
  hits?: number;
  block?: number;
  draw?: number;
  poison?: number;
  heal?: number;
  energy?: number;
  strength?: number;
  dexterity?: number;
  weak?: number;
  vulnerable?: number;
  exhaust?: boolean;
  retainBlock?: boolean;
  blockDamage?: boolean;
  consumeBlock?: boolean;
  poisonMultiplier?: number;
  poisonDamageMultiplier?: number;
  consumePoison?: boolean;
  blockPerPoison?: number;
  damagePerExhaust?: number;
  exhaustHand?: number;
  exhaustDraw?: number;
  exhaustBlock?: number;
  skillPoison?: number;
  attackBlock?: number;
  returnDiscard?: number;
  lifeCost?: number;
  comboDamage?: number;
  nextEnergy?: number;
  cleanse?: boolean;
  stripEnemyBlock?: boolean;
  description: string;
}
// The original eighteen IDs remain valid in old runs and saved decks.
export const CARD_DEFS: Record<string, CardDefinition> = {
  strike: {
    name: "Margin strike",
    cost: 1,
    damage: 6,
    archetype: "attack",
    description: "Deal 6 damage.",
  },
  guard: {
    name: "Paper shield",
    cost: 1,
    block: 6,
    archetype: "guard",
    description: "Gain 6 block.",
  },
  spark: {
    name: "Bright idea",
    cost: 0,
    damage: 3,
    archetype: "attack",
    description: "Deal 3 damage for free.",
  },
  heavy: {
    name: "Hardcover",
    cost: 2,
    damage: 16,
    archetype: "attack",
    description: "Deal 16 damage.",
  },
  venom: {
    name: "Ink spill",
    cost: 1,
    poison: 5,
    archetype: "ink",
    description:
      "Apply 5 ink. Ink ticks before enemy actions, then decays by 1.",
  },
  focus: {
    name: "Quiet study",
    cost: 1,
    draw: 2,
    archetype: "utility",
    description: "Draw 2 cards.",
  },
  brace: {
    name: "Binding",
    cost: 2,
    block: 17,
    archetype: "guard",
    description: "Gain 17 block.",
  },
  surge: {
    name: "Flash of insight",
    cost: 0,
    energy: 2,
    exhaust: true,
    archetype: "exhaust",
    description: "Gain 2 energy. Exhaust.",
  },
  mend: {
    name: "Repair the spine",
    cost: 1,
    heal: 5,
    exhaust: true,
    archetype: "exhaust",
    description: "Recover 5 health. Exhaust.",
  },
  fury: {
    name: "Red underline",
    cost: 1,
    strength: 2,
    archetype: "attack",
    description: "Gain 2 strength this fight.",
  },
  riposte: {
    name: "Counterpoint",
    cost: 1,
    damage: 5,
    block: 5,
    archetype: "guard",
    description: "Deal 5 damage. Gain 5 block.",
  },
  thesis: {
    name: "Final thesis",
    cost: 3,
    damage: 30,
    archetype: "attack",
    description: "Deal 30 damage.",
  },
  annotate: {
    name: "Annotation",
    cost: 0,
    draw: 1,
    exhaust: true,
    archetype: "exhaust",
    description: "Draw 1 card. Exhaust.",
  },
  toxin: {
    name: "Corrosive ink",
    cost: 2,
    poison: 10,
    archetype: "ink",
    description: "Apply 10 ink.",
  },
  bastion: {
    name: "Stack of volumes",
    cost: 3,
    block: 28,
    archetype: "guard",
    description: "Gain 28 block.",
  },
  insight: {
    name: "Unexpected footnote",
    cost: 1,
    damage: 4,
    draw: 1,
    archetype: "attack",
    description: "Deal 4 damage. Draw 1 card.",
  },
  flourish: {
    name: "Calligraphy",
    cost: 2,
    damage: 10,
    poison: 3,
    archetype: "ink",
    description: "Deal 10 damage. Apply 3 ink.",
  },
  restitch: {
    name: "Restitch",
    cost: 2,
    block: 9,
    heal: 3,
    exhaust: true,
    archetype: "exhaust",
    description: "Gain 9 block. Recover 3 health. Exhaust.",
  },
  crossreference: {
    name: "Cross-reference",
    cost: 1,
    damage: 4,
    hits: 3,
    archetype: "attack",
    description: "Deal 4 damage three times. Strength applies to each hit.",
  },
  ambush: {
    name: "Pointed remark",
    cost: 1,
    damage: 8,
    vulnerable: 2,
    archetype: "attack",
    description:
      "Deal 8 damage. Apply 2 vulnerable after attacking (+50% attack damage).",
  },
  softcover: {
    name: "Soft cover",
    cost: 1,
    block: 8,
    weak: 2,
    archetype: "guard",
    description: "Gain 8 block. Apply 2 weak (−25% attack damage).",
  },
  fortify: {
    name: "Reinforced binding",
    cost: 1,
    dexterity: 2,
    exhaust: true,
    archetype: "guard",
    description:
      "Gain 2 dexterity this fight (+2 block per block card). Exhaust.",
  },
  enduring: {
    name: "Permanent edition",
    cost: 1,
    retainBlock: true,
    exhaust: true,
    archetype: "guard",
    description: "Keep leftover block between turns this fight. Exhaust.",
  },
  shieldbash: {
    name: "Weight of evidence",
    cost: 1,
    blockDamage: true,
    consumeBlock: true,
    archetype: "guard",
    description:
      "Deal damage equal to your current block, then consume all block. Attack modifiers apply.",
  },
  boundaries: {
    name: "Firm boundaries",
    cost: 2,
    block: 11,
    attackBlock: 3,
    exhaust: true,
    archetype: "guard",
    description:
      "Gain 11 block. Each later attack card grants 3 block this fight. Exhaust.",
  },
  precision: {
    name: "Fine print",
    cost: 0,
    strength: 1,
    exhaust: true,
    archetype: "attack",
    description: "Gain 1 strength this fight. Exhaust.",
  },
  inkwell: {
    name: "Bottomless inkwell",
    cost: 1,
    skillPoison: 2,
    exhaust: true,
    archetype: "ink",
    description:
      "Each later non-attack card applies 2 ink this fight. Exhaust.",
  },
  blot: {
    name: "Spreading blot",
    cost: 1,
    poisonMultiplier: 2,
    exhaust: true,
    archetype: "ink",
    description: "Double the enemy's current ink. Exhaust.",
  },
  purge: {
    name: "Blotting paper",
    cost: 1,
    poisonDamageMultiplier: 2,
    consumePoison: true,
    archetype: "ink",
    description:
      "Deal attack damage equal to twice current ink, then consume all ink.",
  },
  inkguard: {
    name: "Waterproof margins",
    cost: 1,
    block: 3,
    blockPerPoison: 1,
    archetype: "ink",
    description: "Gain 3 block plus 1 block for each ink on the enemy.",
  },
  etch: {
    name: "Etched warning",
    cost: 1,
    damage: 5,
    poison: 2,
    weak: 1,
    archetype: "ink",
    description: "Deal 5 damage. Apply 2 ink and 1 weak.",
  },
  drying: {
    name: "Fresh ink",
    cost: 0,
    poison: 3,
    exhaust: true,
    archetype: "ink",
    description: "Apply 3 ink. Exhaust.",
  },
  redaction: {
    name: "Redaction",
    cost: 1,
    damage: 6,
    damagePerExhaust: 4,
    archetype: "exhaust",
    description: "Deal 6 damage plus 4 for each card exhausted this fight.",
  },
  paperfuel: {
    name: "Kindling",
    cost: 0,
    energy: 1,
    draw: 1,
    exhaustHand: 1,
    exhaust: true,
    archetype: "exhaust",
    description:
      "Exhaust the leftmost remaining card in hand. Gain 1 energy, draw 1 card. Exhaust.",
  },
  rebind: {
    name: "Recycled pages",
    cost: 1,
    exhaustDraw: 1,
    exhaust: true,
    archetype: "exhaust",
    description:
      "Whenever a card exhausts, draw 1 card this fight (including this card). Exhaust.",
  },
  ashguard: {
    name: "Ashen cover",
    cost: 1,
    exhaustBlock: 4,
    exhaust: true,
    archetype: "exhaust",
    description:
      "Whenever a card exhausts, gain 4 block this fight (including this card). Exhaust.",
  },
  archiveburst: {
    name: "Out of the archive",
    cost: 2,
    damage: 10,
    damagePerExhaust: 5,
    archetype: "exhaust",
    description: "Deal 10 damage plus 5 for each card exhausted this fight.",
  },
  salvage: {
    name: "Salvage a page",
    cost: 0,
    returnDiscard: 1,
    exhaust: true,
    archetype: "exhaust",
    description:
      "Return the most recently discarded card to your hand. Exhaust.",
  },
  lastword: {
    name: "The last word",
    cost: 2,
    damage: 20,
    lifeCost: 4,
    vulnerable: 1,
    archetype: "attack",
    description:
      "Pay 4 health. Deal 20 damage. Apply 1 vulnerable after attacking.",
  },
  revise: {
    name: "A ruthless revision",
    cost: 1,
    draw: 3,
    exhaustHand: 1,
    archetype: "exhaust",
    description:
      "Exhaust the leftmost remaining card in hand, then draw 3 cards.",
  },
  opening: {
    name: "Running commentary",
    cost: 0,
    damage: 4,
    comboDamage: 3,
    archetype: "attack",
    description: "Deal 4 damage plus 3 for each card already played this turn.",
  },
  bookmark: {
    name: "Save your place",
    cost: 1,
    block: 5,
    nextEnergy: 2,
    exhaust: true,
    archetype: "utility",
    description: "Gain 5 block and 2 extra energy next turn. Exhaust.",
  },
  recovery: {
    name: "A clean draft",
    cost: 1,
    heal: 3,
    cleanse: true,
    exhaust: true,
    archetype: "utility",
    description: "Recover 3 health. Remove your weak and vulnerable. Exhaust.",
  },
  shatter: {
    name: "Break the seal",
    cost: 1,
    damage: 9,
    stripEnemyBlock: true,
    archetype: "attack",
    description: "Remove all enemy block, then deal 9 damage.",
  },
};

export const CHARACTER_DEFS = {
  striker: {
    name: "Striker",
    description:
      "First attack each turn deals 2 extra damage on its first hit.",
  },
  warden: {
    name: "Warden",
    description:
      "75 starting health. First block card each turn grants 2 extra block.",
  },
  spark: {
    name: "Spark",
    description: "First card that applies ink each turn adds 1 extra ink.",
  },
} as const;
export const RELIC_DEFS: Record<string, { name: string; description: string }> =
  {
    "red-pen": {
      name: "Red pen",
      description: "Start each battle with 1 strength.",
    },
    booklight: {
      name: "Booklight",
      description: "Start each turn with 3 block.",
    },
    "patched-cover": {
      name: "Patched cover",
      description: "On pickup, gain 10 maximum and current health.",
    },
    "brass-bookmark": {
      name: "Brass bookmark",
      description: "Draw 1 extra card on the first turn of each battle.",
    },
    "hollow-quill": {
      name: "Hollow quill",
      description: "Gain 2 block whenever a card exhausts.",
    },
    inkstone: {
      name: "Inkstone",
      description: "Enemies begin battles with 3 ink.",
    },
    "silver-clasp": {
      name: "Silver clasp",
      description: "Carry up to 5 leftover block into the next turn.",
    },
    "pocket-watch": {
      name: "Pocket watch",
      description: "Gain 1 extra energy on the first turn of each battle.",
    },
    "collectors-coin": {
      name: "Collector's coin",
      description: "Gain 10 extra gold after each battle.",
    },
    "reading-lens": {
      name: "Reading lens",
      description: "Your first non-attack card each turn draws 1 extra card.",
    },
  };
export interface EventChoice {
  id: string;
  label: string;
  description: string;
  goldCost?: number;
  hpCost?: number;
  gold?: number;
  heal?: number;
  maxHp?: number;
  relic?: boolean;
  card?: string;
  remove?: boolean;
  upgrade?: boolean;
}
export const EVENT_DEFS: Record<
  string,
  { name: string; description: string; choices: EventChoice[] }
> = {
  librarian: {
    name: "The night librarian",
    description: "A patient archivist offers to mend more than your cover.",
    choices: [
      {
        id: "repair",
        label: "Accept a repair",
        description: "Recover 12 health.",
        heal: 12,
      },
      {
        id: "binding",
        label: "Buy a stronger binding",
        description: "Pay 40 gold. Gain 6 maximum and current health.",
        goldCost: 40,
        maxHp: 6,
        heal: 6,
      },
      {
        id: "leave",
        label: "Leave",
        description: "Continue without a change.",
      },
    ],
  },
  merchant: {
    name: "The red merchant",
    description: "The price of a rare volume is written in unusually dark ink.",
    choices: [
      {
        id: "trade",
        label: "Trade a little blood",
        description: "Pay 8 health. Gain 70 gold.",
        hpCost: 8,
        gold: 70,
      },
      {
        id: "relic",
        label: "Buy a sealed relic",
        description: "Pay 50 gold. Gain a random unowned relic.",
        goldCost: 50,
        relic: true,
      },
      {
        id: "leave",
        label: "Decline",
        description: "Continue without a change.",
      },
    ],
  },
  desk: {
    name: "The rewriting desk",
    description: "One page may be perfected, or removed entirely.",
    choices: [
      {
        id: "upgrade",
        label: "Perfect a card",
        description:
          "Upgrade one card for free. Each card can be upgraded once.",
        upgrade: true,
      },
      {
        id: "remove",
        label: "Prune a card",
        description: "Pay 20 gold. Remove one card; keep at least 5 cards.",
        goldCost: 20,
        remove: true,
      },
      {
        id: "leave",
        label: "Leave the draft alone",
        description: "Continue without a change.",
      },
    ],
  },
  well: {
    name: "The sealed inkwell",
    description: "A familiar shape stirs beneath the lid.",
    choices: [
      {
        id: "relic",
        label: "Break the seal",
        description: "Pay 8 health. Gain a random unowned relic.",
        hpCost: 8,
        relic: true,
      },
      {
        id: "ink",
        label: "Take a sample",
        description: "Pay 25 gold. Add Bottomless inkwell to your deck.",
        goldCost: 25,
        card: "inkwell",
      },
      {
        id: "leave",
        label: "Keep it sealed",
        description: "Continue without a change.",
      },
    ],
  },
  fire: {
    name: "The burning shelf",
    description: "Some pages will survive only if others are sacrificed.",
    choices: [
      {
        id: "remove",
        label: "Sacrifice a page",
        description: "Pay 4 health. Remove one card; keep at least 5 cards.",
        hpCost: 4,
        remove: true,
      },
      {
        id: "recycle",
        label: "Gather the remnants",
        description: "Add Recycled pages to your deck.",
        card: "rebind",
      },
      {
        id: "leave",
        label: "Step back",
        description: "Continue without a change.",
      },
    ],
  },
  margin: {
    name: "A message in the margin",
    description: "Your earlier self left a surprisingly practical suggestion.",
    choices: [
      {
        id: "prepare",
        label: "Prepare for tomorrow",
        description: "Add Save your place to your deck. Recover 5 health.",
        card: "bookmark",
        heal: 5,
      },
      {
        id: "coin",
        label: "Follow the loose change",
        description: "Gain 25 gold.",
        gold: 25,
      },
      {
        id: "leave",
        label: "Turn the page",
        description: "Continue without a change.",
      },
    ],
  },
};

export function isAttack(card: CardDefinition) {
  return !!(card.damage || card.blockDamage || card.poisonDamageMultiplier);
}
// Upgrades keep string-based deck saves compatible and never stack more than once.
export function upgradeCardId(id: string): string | undefined {
  return Object.hasOwn(CARD_DEFS, id) ? `${id}+` : undefined;
}
export function getCardDefinition(id: string): CardDefinition | undefined {
  if (Object.hasOwn(CARD_DEFS, id)) return CARD_DEFS[id];
  if (!id.endsWith("+") || !Object.hasOwn(CARD_DEFS, id.slice(0, -1)))
    return undefined;
  const card = { ...CARD_DEFS[id.slice(0, -1)] };
  card.name += " +";
  let change: string;
  if (card.damage) {
    const bonus = card.hits ? 2 : 3;
    card.damage += bonus;
    change = `+${bonus} base damage${card.hits ? " per hit" : ""}`;
  } else if (card.block) {
    card.block += 4;
    change = "+4 base block";
  } else if (card.poison) {
    card.poison += 3;
    change = "+3 ink applied";
  } else if (card.draw) {
    card.draw++;
    change = "+1 card drawn";
  } else if (card.strength) {
    card.strength++;
    change = "+1 strength gained";
  } else if (card.energy) {
    card.energy++;
    change = "+1 energy gained";
  } else if (card.returnDiscard) {
    card.returnDiscard++;
    change = "+1 discarded card returned";
  } else if (card.heal) {
    card.heal += 3;
    change = "+3 health recovered";
  } else if (card.poisonMultiplier) {
    card.poisonMultiplier++;
    change = "triple ink instead of doubling";
  } else {
    card.cost = Math.max(0, card.cost - 1);
    change = "costs 1 less energy";
  }
  card.description += ` Upgrade: ${change}.`;
  return card;
}
