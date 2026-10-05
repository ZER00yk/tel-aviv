export type WeaponId =
  "pulse" | "scatter" | "blade" | "comet" | "lance" | "boomerang" | "prism";
export const weapons: Record<
  WeaponId,
  {
    name: string;
    description: string;
    damage: number;
    interval: number;
    speed: number;
  }
> = {
  pulse: {
    name: "Pulse pen",
    description: "Accurate quick projectiles. Alternate: piercing burst.",
    damage: 9,
    interval: 0.23,
    speed: 520,
  },
  scatter: {
    name: "Static bloom",
    description: "Five short-range pellets. Alternate: wide fan.",
    damage: 4,
    interval: 0.6,
    speed: 380,
  },
  blade: {
    name: "Margin blade",
    description: "A close-range arc with knockback. Alternate: spinning slash.",
    damage: 23,
    interval: 0.45,
    speed: 0,
  },
  comet: {
    name: "Pocket comet",
    description: "Slow explosive bolts. Alternate: a large blast.",
    damage: 20,
    interval: 0.85,
    speed: 240,
  },
  lance: {
    name: "Underline lance",
    description:
      "A narrow long melee thrust. Alternate: lunging thrust with a brief guard.",
    damage: 32,
    interval: 0.68,
    speed: 0,
  },
  boomerang: {
    name: "Return receipt",
    description:
      "A returning disc strikes once on each pass. Alternate: three ricocheting discs.",
    damage: 14,
    interval: 0.72,
    speed: 370,
  },
  prism: {
    name: "Prism argument",
    description:
      "A short beam chains to nearby foes. Alternate: wide beam with an extra link.",
    damage: 12,
    interval: 0.48,
    speed: 0,
  },
};
export type ArenaId =
  | "orbit"
  | "grid"
  | "track"
  | "signal"
  | "glass"
  | "furnace"
  | "archive"
  | "eclipse";
export const bosses = [
  {
    name: "Rowan",
    title: "The center of attention",
    color: 0xc27fff,
    hp: 340,
    dialogue: "Every orbit comes back to me.",
    reward: "Orbit breaker",
    rewardMod: "orbit",
    attacks: ["rings", "fan", "cross"],
    arena: "orbit",
    achievement: "ego-orbit-breaker",
    phaseDialogue: [
      "There is only room for one center.",
      "Then I will move the whole room.",
    ],
  },
  {
    name: "Bennett",
    title: "The perfect planner",
    color: 0xffcb75,
    hp: 430,
    dialogue: "You are exactly where I planned.",
    reward: "Margin shield",
    rewardMod: "shield",
    attacks: ["grid", "sniper", "mines"],
    arena: "grid",
    achievement: "ego-plan-b",
    phaseDialogue: [
      "That was not in the plan.",
      "I can still redraw the margins.",
    ],
  },
  {
    name: "Austin",
    title: "All forward momentum",
    color: 0xff796e,
    hp: 500,
    dialogue: "Keep up. Or get out of the way.",
    reward: "Second wind",
    rewardMod: "dash",
    attacks: ["charge", "walls", "fan"],
    arena: "track",
    achievement: "ego-second-wind",
    phaseDialogue: ["Now we are finally moving.", "No brakes. No excuses."],
  },
  {
    name: "Dakota",
    title: "The last signal",
    color: 0x79d9ef,
    hp: 620,
    dialogue: "Let us see what survives the noise.",
    reward: "Signal companion",
    rewardMod: "helper",
    attacks: ["orbit", "cross", "rings"],
    arena: "signal",
    achievement: "ego-clear-frequency",
    phaseDialogue: [
      "The noise is part of the message.",
      "Listen for the silence between pulses.",
    ],
  },
  {
    name: "Mira",
    title: "The glass curator",
    color: 0xeaa8ef,
    hp: 600,
    dialogue: "I kept every version of you. None of them fits.",
    reward: "Prismatic memory",
    rewardMod: "refraction",
    attacks: ["mirror", "shatter", "reflection"],
    arena: "glass",
    achievement: "ego-through-glass",
    phaseDialogue: [
      "One reflection was never enough.",
      "Let the collection break.",
    ],
  },
  {
    name: "Sol",
    title: "The beautiful burnout",
    color: 0xffa34f,
    hp: 680,
    dialogue: "If I stop shining, will anyone stay?",
    reward: "Heat sink",
    rewardMod: "heat-sink",
    attacks: ["furnace", "flare", "solar"],
    arena: "furnace",
    achievement: "ego-afterglow",
    phaseDialogue: [
      "I can burn a little brighter.",
      "There is nothing left to spare.",
    ],
  },
  {
    name: "Inez",
    title: "Keeper of promises",
    color: 0x89bfa2,
    hp: 710,
    dialogue: "Every promise has a weight. Show me yours.",
    reward: "Unbroken promise",
    rewardMod: "promise",
    attacks: ["index", "binding", "erasure"],
    arena: "archive",
    achievement: "ego-unbroken",
    phaseDialogue: [
      "You have forgotten the fine print.",
      "Then we will write a different ending.",
    ],
  },
  {
    name: "Noa",
    title: "The unwritten ending",
    color: 0xc8ccff,
    hp: 820,
    dialogue: "You made it this far. Who gets to decide what comes next?",
    reward: "Open ending",
    rewardMod: "finale",
    attacks: ["eclipse", "echo", "verdict"],
    arena: "eclipse",
    achievement: "ego-open-ending",
    phaseDialogue: [
      "There is more than one way through.",
      "Take the opening. It belongs to you.",
    ],
  },
] as const;
export const CLASSIC_BOSS_COUNT = 4;
export const CAMPAIGN_ROOM_COUNT = 40;
export const mods = [
  {
    id: "orbit",
    name: "Orbit breaker",
    rarity: "Rare",
    description: "Alternate attacks recover one second faster.",
  },
  {
    id: "split",
    name: "Split decision",
    rarity: "Rare",
    description: "An extra projectile on ranged attacks.",
  },
  {
    id: "venom",
    name: "Corrosive ink",
    rarity: "Uncommon",
    description: "Hits apply damage over time.",
  },
  {
    id: "shield",
    name: "Margin shield",
    rarity: "Rare",
    description:
      "Reduce contact damage and gain maximum health. Stacks up to five times.",
  },
  {
    id: "tempo",
    name: "Fast thoughts",
    rarity: "Common",
    description: "Reduce weapon cooldown with diminishing returns.",
  },
  {
    id: "dash",
    name: "Second wind",
    rarity: "Uncommon",
    description: "Dash more often and travel farther.",
  },
  {
    id: "vampire",
    name: "Borrowed confidence",
    rarity: "Epic",
    description: "Every fifth hit restores health; melee restores more.",
  },
  {
    id: "critical",
    name: "Perfect emphasis",
    rarity: "Rare",
    description: "Every fourth hit deals extra damage.",
  },
  {
    id: "helper",
    name: "Signal companion",
    rarity: "Epic",
    description: "A vulnerable helper automatically fires at enemies.",
  },
  {
    id: "ricochet",
    name: "Echoing ink",
    rarity: "Legendary",
    description: "Ranged projectiles rebound once from arena walls.",
  },
  {
    id: "refraction",
    name: "Prismatic memory",
    rarity: "Epic",
    description:
      "Prism chains farther; other weapons deal bonus opening damage.",
  },
  {
    id: "heat-sink",
    name: "Heat sink",
    rarity: "Rare",
    description:
      "Every eighth shot clears some alternate cooldown. Dashing leaves a damaging wake.",
  },
  {
    id: "promise",
    name: "Unbroken promise",
    rarity: "Epic",
    description: "Ignore one lethal blow per room and recover 12 health.",
  },
  {
    id: "finale",
    name: "Open ending",
    rarity: "Legendary",
    description:
      "Deal more damage to weakened bosses. A room clear restores health.",
  },
  {
    id: "reach",
    name: "Long sentence",
    rarity: "Uncommon",
    description:
      "Melee and beam reach increase by 25%; ranged shots last longer.",
  },
  {
    id: "momentum",
    name: "Running argument",
    rarity: "Rare",
    description: "Moving quickly or dashing increases hit damage.",
  },
  {
    id: "guardian",
    name: "Companion bond",
    rarity: "Rare",
    description: "Helpers attack or heal faster and resist projectile damage.",
  },
  {
    id: "parry",
    name: "Counterpoint",
    rarity: "Epic",
    description:
      "Melee hits clear nearby hostile projectiles; alternate melee grants a brief guard.",
  },
  {
    id: "glass",
    name: "Glass confidence",
    rarity: "Epic",
    description: "Deal 25% more damage but take 20% more. Does not stack.",
  },
  {
    id: "boss-hunter",
    name: "Read the room",
    rarity: "Rare",
    description:
      "Bosses take extra damage during their visible recovery openings.",
  },
  {
    id: "return",
    name: "Return address",
    rarity: "Uncommon",
    description:
      "Returning discs hit harder on their way back; ranged hits reduce dash cooldown.",
  },
  {
    id: "anchor",
    name: "Quiet certainty",
    rarity: "Rare",
    description:
      "Standing still briefly builds a guard. Guard reduces the next hit and then breaks.",
  },
  {
    id: "mercy",
    name: "Held breath",
    rarity: "Legendary",
    description:
      "Shrine refusals restore health on clears and reveal the pilgrim's route.",
  },
] as const;
export const modLimits: Record<string, number> = {
  shield: 5,
  tempo: 5,
  dash: 4,
  orbit: 1,
  split: 1,
  venom: 1,
  vampire: 1,
  critical: 1,
  helper: 1,
  ricochet: 1,
  refraction: 1,
  "heat-sink": 1,
  promise: 1,
  finale: 1,
  reach: 1,
  momentum: 1,
  guardian: 1,
  parry: 1,
  glass: 1,
  "boss-hunter": 1,
  return: 1,
  anchor: 1,
  mercy: 1,
};
