import { randomInt } from "node:crypto";
import { GameRuleError } from "./rules";
export interface PokerHand {
  phase: "playing" | "settled";
  street: "preflop" | "flop" | "turn" | "river";
  playerCards: number[];
  botCards: number[];
  community: number[];
  deck: number[];
  pot: number;
  toCall: number;
  baseBet: number;
  playerContribution: number;
  botContribution: number;
  outcome?: string;
  payout?: number;
  log: string[];
}
const rank = (card: number) => (card % 13 === 0 ? 14 : (card % 13) + 1);
function five(cards: number[]) {
  const ranks = cards.map(rank).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every(
    (c) => Math.floor(c / 13) === Math.floor(cards[0] / 13),
  );
  const unique = [...new Set(ranks)];
  if (unique.includes(14)) unique.push(1);
  let straight = 0;
  for (let i = 0; i <= unique.length - 5; i++)
    if (unique[i] - unique[i + 4] === 4) {
      straight = unique[i];
      break;
    }
  let result: number[];
  if (flush && straight) result = [8, straight];
  else if (groups[0][1] === 4) result = [7, groups[0][0], groups[1][0]];
  else if (groups[0][1] === 3 && groups[1][1] === 2)
    result = [6, groups[0][0], groups[1][0]];
  else if (flush) result = [5, ...ranks];
  else if (straight) result = [4, straight];
  else if (groups[0][1] === 3)
    result = [3, groups[0][0], ...groups.slice(1).map((g) => g[0])];
  else if (groups[0][1] === 2 && groups[1][1] === 2)
    result = [
      2,
      Math.max(groups[0][0], groups[1][0]),
      Math.min(groups[0][0], groups[1][0]),
      groups[2][0],
    ];
  else if (groups[0][1] === 2)
    result = [1, groups[0][0], ...groups.slice(1).map((g) => g[0])];
  else result = [0, ...ranks];
  while (result.length < 6) result.push(0);
  return result.reduce((value, digit) => value * 15 + digit, 0);
}
export function pokerValue(cards: number[]) {
  if (
    cards.length < 5 ||
    cards.length > 7 ||
    new Set(cards).size !== cards.length
  )
    throw new GameRuleError(
      "Poker evaluation needs five to seven distinct cards.",
    );
  let best = 0;
  for (let a = 0; a < cards.length - 4; a++)
    for (let b = a + 1; b < cards.length - 3; b++)
      for (let c = b + 1; c < cards.length - 2; c++)
        for (let d = c + 1; d < cards.length - 1; d++)
          for (let e = d + 1; e < cards.length; e++)
            best = Math.max(
              best,
              five([cards[a], cards[b], cards[c], cards[d], cards[e]]),
            );
  return best;
}
export function startPoker(bet: number): PokerHand {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return {
    phase: "playing",
    street: "preflop",
    playerCards: [deck.pop()!, deck.pop()!],
    botCards: [deck.pop()!, deck.pop()!],
    community: [],
    deck,
    pot: bet * 2,
    toCall: 0,
    baseBet: bet,
    playerContribution: bet,
    botContribution: bet,
    log: [
      "Heads-up against the house bot. Both players post the starting stake.",
    ],
  };
}
function finish(hand: PokerHand, outcome: string, payout: number) {
  hand.phase = "settled";
  hand.outcome = outcome;
  hand.payout = payout;
  hand.toCall = 0;
  hand.log = [...hand.log.slice(-5), outcome];
  return { debit: 0, credit: payout };
}
function nextStreet(hand: PokerHand) {
  hand.toCall = 0;
  if (hand.street === "river") {
    const own = pokerValue([...hand.playerCards, ...hand.community]);
    const bot = pokerValue([...hand.botCards, ...hand.community]);
    return finish(
      hand,
      own > bot
        ? "You win the showdown"
        : own === bot
          ? "Split pot"
          : "House wins the showdown",
      own > bot ? hand.pot : own === bot ? Math.floor(hand.pot / 2) : 0,
    );
  }
  hand.deck.pop();
  if (hand.street === "preflop") {
    hand.street = "flop";
    hand.community.push(hand.deck.pop()!, hand.deck.pop()!, hand.deck.pop()!);
  } else {
    hand.street = hand.street === "flop" ? "turn" : "river";
    hand.community.push(hand.deck.pop()!);
  }
  hand.log = [
    ...hand.log.slice(-5),
    `The ${hand.street} is dealt. Your action.`,
  ];
  return { debit: 0, credit: 0 };
}
function botStrength(hand: PokerHand) {
  if (hand.community.length >= 3)
    return Math.floor(
      pokerValue([...hand.botCards, ...hand.community]) / Math.pow(15, 5),
    );
  return rank(hand.botCards[0]) === rank(hand.botCards[1])
    ? 2
    : Math.max(...hand.botCards.map(rank)) >= 12
      ? 1
      : 0;
}
export function actPoker(
  hand: PokerHand,
  action: string,
  payload: Record<string, unknown>,
) {
  if (hand.phase !== "playing")
    throw new GameRuleError("Start a poker hand first.");
  if (action === "poker.fold") return finish(hand, "You fold", 0);
  if (action === "poker.check") {
    if (hand.toCall)
      throw new GameRuleError("Call, raise, or fold against the current bet.");
    const strength = botStrength(hand);
    if (randomInt(0, 100) < 25 + strength * 10) {
      const amount =
        hand.baseBet *
        (hand.street === "preflop" ? 1 : hand.street === "river" ? 3 : 2);
      hand.botContribution += amount;
      hand.pot += amount;
      hand.toCall = amount;
      hand.log = [...hand.log.slice(-5), `House bets ${amount}.`];
      return { debit: 0, credit: 0 };
    }
    hand.log = [...hand.log.slice(-5), "House checks."];
    return nextStreet(hand);
  }
  if (action === "poker.call") {
    if (!hand.toCall)
      throw new GameRuleError("There is no bet to call. Check or raise.");
    const debit = hand.toCall;
    hand.playerContribution += debit;
    hand.pot += debit;
    const result = nextStreet(hand);
    return { ...result, debit };
  }
  if (action === "poker.raise") {
    const amount = Number(payload.amount);
    if (
      !Number.isInteger(amount) ||
      amount < hand.toCall + hand.baseBet ||
      amount > 100000 ||
      hand.playerContribution + amount > 500000
    )
      throw new GameRuleError(
        "Raise by at least the call amount plus the starting stake, up to 100,000; each hand is capped at 500,000.",
      );
    const botCall = amount - hand.toCall;
    hand.playerContribution += amount;
    hand.pot += amount;
    hand.toCall = 0;
    if (randomInt(0, 100) < Math.max(5, 30 - botStrength(hand) * 8))
      return {
        ...finish(hand, "House folds. You win", hand.pot),
        debit: amount,
      };
    hand.botContribution += botCall;
    hand.pot += botCall;
    hand.log = [...hand.log.slice(-5), `House calls ${botCall}.`];
    return { ...nextStreet(hand), debit: amount };
  }
  throw new GameRuleError("Unknown poker decision.");
}
export function publicPoker(hand?: PokerHand) {
  if (!hand) return undefined;
  const { deck: _deck, ...safe } = hand;
  return {
    ...safe,
    botCards: hand.phase === "playing" ? [-1, -1] : hand.botCards,
  };
}
