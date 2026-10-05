import { randomInt } from "node:crypto";
import { z } from "zod";
import { pokerValue } from "../server/poker";
export class PokerRuleError extends Error {}
export interface PokerSeat {
  userId: string;
  stack: number;
  /** Chips approved for this hand. Absent on legacy equal-buy-in checkpoints. */
  initialStack?: number;
  committed: number;
  streetBet: number;
  folded: boolean;
  allIn: boolean;
  hole: number[];
}
export interface PokerTableConfig {
  id: string;
  handNumber: number;
  minBuyIn: number;
  maxBuyIn: number;
  smallBlind: number;
  bigBlind: number;
  sittingOut: string[];
  pendingLeave: string[];
}
export interface PersistentPokerSeat {
  userId: string;
  stack: number;
}
export interface PokerState {
  kind: "poker";
  phase: "betting" | "settled" | "cancelled";
  buyIn: number;
  table?: PokerTableConfig;
  seats: PokerSeat[];
  pot: number;
  street: "preflop" | "flop" | "turn" | "river";
  community: number[];
  deck: number[];
  dealerIndex: number;
  turnIndex: number | null;
  currentBet: number;
  minRaise: number;
  acted: string[];
  lastActedBet?: Record<string, number>;
  deadline: number;
  revision: number;
  actionLog: { userId: string; action: string; amount: number; at: number }[];
  payouts?: Record<string, number>;
  pots?: { amount: number; eligible: string[]; winners: string[] }[];
  result?: {
    winners: string[];
    scores: Record<string, number>;
    reason: string;
  };
}
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new PokerRuleError(message);
}
function pay(s: PokerState, p: PokerSeat, amount: number) {
  const actual = Math.min(p.stack, amount);
  p.stack -= actual;
  p.committed += actual;
  p.streetBet += actual;
  s.pot += actual;
  p.allIn = p.stack === 0;
  return actual;
}
const live = (s: PokerState) => s.seats.filter((p) => !p.folded);
const active = (s: PokerState) => s.seats.filter((p) => !p.folded && !p.allIn);
const nextIndex = (s: PokerState, after: number, needsAction = false) => {
  for (let step = 1; step <= s.seats.length; step++) {
    const i = (after + step) % s.seats.length,
      p = s.seats[i];
    if (
      !p.folded &&
      !p.allIn &&
      (!needsAction ||
        !s.acted.includes(p.userId) ||
        p.streetBet < s.currentBet)
    )
      return i;
  }
  return null;
};
function log(
  s: PokerState,
  userId: string,
  action: string,
  amount: number,
  now: number,
) {
  s.actionLog = [
    ...s.actionLog.slice(-199),
    { userId, action, amount, at: now },
  ];
  s.revision++;
}
export function createPokerState(
  ids: string[],
  buyIn = 100,
  dealerIndex = 0,
  now = Date.now(),
): PokerState {
  assert(
    ids.length >= 2 && ids.length <= 6 && new Set(ids).size === ids.length,
    "Poker needs 2–6 different players",
  );
  assert(
    Number.isInteger(buyIn) && buyIn >= 100 && buyIn <= 10000,
    "Buy in with 100–10,000 fictional Credits",
  );
  return dealPokerHand(
    ids.map((userId) => ({ userId, stack: buyIn })),
    buyIn,
    dealerIndex,
    now,
  );
}
/** Blinds increase after each ten completed hands and stop at 100/200. */
export function pokerBlinds(handNumber: number) {
  assert(
    Number.isSafeInteger(handNumber) && handNumber >= 1,
    "Invalid poker hand number",
  );
  const tiers = [
    [5, 10],
    [10, 20],
    [20, 40],
    [50, 100],
    [100, 200],
  ] as const;
  const [smallBlind, bigBlind] =
    tiers[Math.min(tiers.length - 1, Math.floor((handNumber - 1) / 10))];
  return { smallBlind, bigBlind };
}
/** Wallet reservation belongs to SQL; this engine receives only approved retained stacks. */
export function createPersistentPokerHand(
  players: PersistentPokerSeat[],
  table: PokerTableConfig,
  dealerIndex = 0,
  now = Date.now(),
): PokerState {
  assert(
    players.length >= 2 &&
      players.length <= 6 &&
      new Set(players.map((p) => p.userId)).size === players.length,
    "Poker needs 2–6 different players",
  );
  assert(
    players.every(
      (p) =>
        typeof p.userId === "string" &&
        p.userId.length > 0 &&
        Number.isSafeInteger(p.stack) &&
        p.stack > 0 &&
        p.stack <= 60_000,
    ),
    "Persistent poker stacks must contain 1–60,000 chips",
  );
  assert(
    typeof table.id === "string" &&
      table.id.length > 0 &&
      table.id.length <= 256,
    "Invalid persistent poker table",
  );
  assert(
    Number.isSafeInteger(table.handNumber) &&
      table.handNumber >= 1 &&
      table.handNumber <= 10_000,
    "Invalid poker hand number",
  );
  assert(
    Number.isSafeInteger(dealerIndex) && Number.isFinite(now),
    "Invalid poker deal timing",
  );
  assert(
    Number.isSafeInteger(table.minBuyIn) &&
      Number.isSafeInteger(table.maxBuyIn) &&
      table.minBuyIn >= 100 &&
      table.maxBuyIn <= 10_000 &&
      table.minBuyIn <= table.maxBuyIn,
    "Buy-in limits must be 100–10,000 fictional Credits",
  );
  const blinds = pokerBlinds(table.handNumber);
  assert(
    table.smallBlind === blinds.smallBlind &&
      table.bigBlind === blinds.bigBlind,
    "Use the poker table's current blind level",
  );
  assert(
    Array.isArray(table.sittingOut) &&
      Array.isArray(table.pendingLeave) &&
      table.sittingOut.every((id) => typeof id === "string") &&
      table.pendingLeave.every((id) => typeof id === "string"),
    "Invalid poker seat status",
  );
  assert(
    players.every(
      (p) =>
        !table.sittingOut.includes(p.userId) &&
        !table.pendingLeave.includes(p.userId),
    ),
    "Sitting-out or leaving seats cannot start a hand",
  );
  return dealPokerHand(players, table.minBuyIn, dealerIndex, now, table);
}
function dealPokerHand(
  players: PersistentPokerSeat[],
  buyIn: number,
  dealerIndex: number,
  now: number,
  table?: PokerTableConfig,
): PokerState {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const seats: PokerSeat[] = players.map(({ userId, stack }) => ({
    userId,
    stack,
    ...(table ? { initialStack: stack } : {}),
    committed: 0,
    streetBet: 0,
    folded: false,
    allIn: false,
    hole: [] as number[],
  }));
  dealerIndex = ((dealerIndex % seats.length) + seats.length) % seats.length;
  for (let round = 0; round < 2; round++)
    for (let offset = 1; offset <= seats.length; offset++)
      seats[(dealerIndex + offset) % seats.length].hole.push(deck.pop()!);
  const s: PokerState = {
    kind: "poker",
    phase: "betting",
    buyIn,
    ...(table
      ? {
          table: {
            ...table,
            sittingOut: [...table.sittingOut],
            pendingLeave: [...table.pendingLeave],
          },
        }
      : {}),
    seats,
    pot: 0,
    street: "preflop",
    community: [],
    deck,
    dealerIndex,
    turnIndex: null,
    currentBet: table?.bigBlind ?? 10,
    minRaise: table?.bigBlind ?? 10,
    acted: [],
    lastActedBet: {},
    deadline: now + 30_000,
    // A delayed action from an earlier hand must not match the next hand's revision.
    revision: table ? (table.handNumber - 1) * 1_000_000 + 1 : 1,
    actionLog: [],
  };
  const small =
      seats.length === 2 ? dealerIndex : (dealerIndex + 1) % seats.length,
    big = (small + 1) % seats.length;
  pay(s, seats[small], table?.smallBlind ?? 5);
  pay(s, seats[big], table?.bigBlind ?? 10);
  s.turnIndex = nextIndex(s, big);
  if (table) {
    // With only one funded actor, only actual opposing commitments can be contested.
    if (active(s).length <= 1)
      s.currentBet = Math.max(...seats.map((p) => p.streetBet));
    advance(s, big, now);
  }
  return s;
}
function finish(s: PokerState, reason: string) {
  s.phase = "settled";
  s.turnIndex = null;
  s.deadline = 0;
  s.payouts = Object.fromEntries(s.seats.map((p) => [p.userId, p.stack]));
  s.result = {
    winners: s.seats
      .filter((p) => p.stack > (p.initialStack ?? s.buyIn))
      .map((p) => p.userId),
    scores: { ...s.payouts },
    reason,
  };
  s.revision++;
  assert(
    s.seats.reduce((n, p) => n + p.stack, 0) ===
      s.seats.reduce((n, p) => n + (p.initialStack ?? s.buyIn), 0),
    "Poker chip conservation failed",
  );
}
/** Layer contributions into side pots. Folded chips count; only eligible live seats can win. */
export function settlePokerState(s: PokerState, reason = "Showdown") {
  assert(s.phase === "betting", "This hand already ended");
  const survivors = live(s);
  if (!survivors.length) {
    cancelPokerState(s, "All players left the hand");
    return;
  }
  if (survivors.length > 1)
    while (s.community.length < 5) {
      s.deck.pop();
      const count = s.community.length === 0 ? 3 : 1;
      for (let i = 0; i < count; i++) s.community.push(s.deck.pop()!);
    }
  if (s.community.length === 5) s.street = "river";
  const values = new Map(
    survivors.map((p) => [
      p.userId,
      survivors.length === 1 ? 0 : pokerValue([...p.hole, ...s.community]),
    ]),
  );
  const levels = [
    ...new Set(s.seats.map((p) => p.committed).filter((n) => n > 0)),
  ].sort((a, b) => a - b);
  let prior = 0;
  s.pots = [];
  for (const level of levels) {
    const contributors = s.seats.filter((p) => p.committed >= level),
      amount = (level - prior) * contributors.length;
    const eligible = contributors.filter((p) => !p.folded);
    prior = level;
    if (!eligible.length) {
      for (const p of contributors) p.stack += amount / contributors.length;
      s.pots.push({
        amount,
        eligible: [],
        winners: contributors.map((p) => p.userId),
      });
      continue;
    }
    const best = Math.max(...eligible.map((p) => values.get(p.userId)!)),
      winners = eligible.filter((p) => values.get(p.userId) === best);
    const ordered = Array.from(
      { length: s.seats.length },
      (_, offset) => s.seats[(s.dealerIndex + 1 + offset) % s.seats.length],
    ).filter((p) => winners.includes(p));
    const share = Math.floor(amount / winners.length);
    let odd = amount % winners.length;
    for (const p of ordered) {
      p.stack += share + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
    }
    s.pots.push({
      amount,
      eligible: eligible.map((p) => p.userId),
      winners: winners.map((p) => p.userId),
    });
  }
  finish(s, reason);
}
export function cancelPokerState(s: PokerState, reason: string) {
  if (s.phase === "cancelled") return;
  for (const p of s.seats) p.stack = p.initialStack ?? s.buyIn;
  s.phase = "cancelled";
  s.turnIndex = null;
  s.deadline = 0;
  s.payouts = Object.fromEntries(s.seats.map((p) => [p.userId, p.stack]));
  s.result = { winners: [], scores: { ...s.payouts }, reason };
  s.revision++;
}
function advance(s: PokerState, after: number, now: number) {
  if (live(s).length <= 1) {
    settlePokerState(s, "All other players folded");
    return;
  }
  const actors = active(s);
  const pending = actors.filter(
    (p) => !s.acted.includes(p.userId) || p.streetBet < s.currentBet,
  );
  // Nobody can contest another bet, so expose only the canonical runout/showdown.
  if (
    !actors.length ||
    (actors.length === 1 && actors[0].streetBet >= s.currentBet)
  ) {
    settlePokerState(s);
    return;
  }
  if (pending.length) {
    s.turnIndex = nextIndex(s, after, true);
    s.deadline = now + 30_000;
    return;
  }
  if (s.street === "river") {
    settlePokerState(s);
    return;
  }
  s.deck.pop();
  if (s.street === "preflop") {
    s.street = "flop";
    s.community.push(s.deck.pop()!, s.deck.pop()!, s.deck.pop()!);
  } else {
    s.street = s.street === "flop" ? "turn" : "river";
    s.community.push(s.deck.pop()!);
  }
  for (const p of s.seats) p.streetBet = 0;
  s.currentBet = 0;
  s.minRaise = s.table?.bigBlind ?? 10;
  s.acted = [];
  s.lastActedBet = {};
  s.turnIndex = nextIndex(s, s.dealerIndex);
  s.deadline = now + 30_000;
}
const actionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("poker:fold"),
      revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("poker:check"),
      revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("poker:call"),
      revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("poker:all-in"),
      revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("poker:raise"),
      to: z.number().int().min(1).max(60000),
      revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .strict(),
]);
function canRaise(s: PokerState, userId: string) {
  return (
    !s.acted.includes(userId) ||
    s.currentBet - (s.lastActedBet?.[userId] ?? s.currentBet) >= s.minRaise
  );
}
export function applyPokerAction(
  s: PokerState,
  userId: string,
  input: unknown,
  now = Date.now(),
) {
  assert(s.phase === "betting", "This poker hand ended");
  const p = s.seats.find((p) => p.userId === userId);
  assert(p, "Join this poker hand first");
  assert(
    s.turnIndex !== null && s.seats[s.turnIndex].userId === userId,
    "Wait for your poker turn",
  );
  assert(!p.folded && !p.allIn, "This seat cannot act");
  const action = actionSchema.parse(input);
  assert(
    !s.table || action.revision !== undefined,
    "Persistent poker actions require the current hand revision",
  );
  assert(
    action.revision === undefined || action.revision === s.revision,
    "This poker action is stale; use the current hand revision",
  );
  const index = s.turnIndex,
    owed = Math.max(0, s.currentBet - p.streetBet);
  let amount = 0;
  if (action.type === "poker:fold") p.folded = true;
  else if (action.type === "poker:check")
    assert(owed === 0, "Call or fold against the outstanding bet");
  else if (action.type === "poker:call") {
    assert(owed > 0, "There is no bet to call");
    amount = pay(s, p, owed);
  } else {
    const target =
      action.type === "poker:all-in" ? p.streetBet + p.stack : action.to;
    assert(
      target <= p.streetBet + p.stack,
      "The raise exceeds your reserved stack",
    );
    if (target <= s.currentBet) {
      assert(action.type === "poker:all-in", "Raise above the current bet");
      amount = pay(s, p, p.stack);
    } else {
      assert(
        canRaise(s, userId),
        "A short all-in did not reopen your raising rights; call or fold",
      );
      const increase = target - s.currentBet;
      assert(
        increase >= s.minRaise || target === p.streetBet + p.stack,
        "Raise by at least the last full raise, or go all-in",
      );
      amount = pay(s, p, target - p.streetBet);
      s.currentBet = target;
      if (increase >= s.minRaise) {
        s.minRaise = increase;
        s.acted = [];
      }
    }
  }
  if (!s.acted.includes(userId)) s.acted.push(userId);
  (s.lastActedBet ??= {})[userId] = s.currentBet;
  log(s, userId, action.type, amount, now);
  advance(s, index, now);
}
export function foldDepartedPokerSeat(
  s: PokerState,
  userId: string,
  now = Date.now(),
) {
  if (s.phase !== "betting") return;
  const index = s.seats.findIndex((p) => p.userId === userId);
  if (index < 0) return;
  const p = s.seats[index];
  if (p.folded) return;
  if (!p.allIn) p.folded = true;
  log(s, userId, p.allIn ? "poker:leave-all-in" : "poker:leave", 0, now);
  advance(
    s,
    s.turnIndex === index ? index : (s.turnIndex ?? index) - 1 + s.seats.length,
    now,
  );
}
export function tickPokerState(s: PokerState, now: number) {
  if (s.phase !== "betting" || s.turnIndex === null || now < s.deadline)
    return false;
  const p = s.seats[s.turnIndex];
  applyPokerAction(
    s,
    p.userId,
    {
      type: p.streetBet === s.currentBet ? "poker:check" : "poker:fold",
      revision: s.revision,
    },
    now,
  );
  return true;
}
export function publicPokerTable(s: PokerState, userId: string) {
  const self = s.seats.find((p) => p.userId === userId);
  assert(self || s.table, "Join this poker table first");
  const turn = s.turnIndex === null ? null : s.seats[s.turnIndex].userId;
  return {
    kind: s.kind,
    phase: s.phase,
    buyIn: s.buyIn,
    table: s.table
      ? {
          ...s.table,
          sittingOut: [...s.table.sittingOut],
          pendingLeave: [...s.table.pendingLeave],
        }
      : undefined,
    street: s.street,
    pot: s.pot,
    currentBet: s.currentBet,
    community: s.community,
    dealerId: s.seats[s.dealerIndex].userId,
    turn,
    deadline: s.deadline,
    revision: s.revision,
    seats: s.seats.map((p) => ({
      userId: p.userId,
      stack: p.stack,
      initialStack: p.initialStack,
      committed: p.committed,
      streetBet: p.streetBet,
      folded: p.folded,
      allIn: p.allIn,
      hole:
        p.userId === userId ||
        (s.phase === "settled" &&
          !p.folded &&
          s.community.length === 5 &&
          live(s).length > 1)
          ? p.hole
          : [-1, -1],
    })),
    self: {
      toCall: self
        ? Math.min(self.stack, Math.max(0, s.currentBet - self.streetBet))
        : 0,
      minRaiseTo: self ? s.currentBet + s.minRaise : 0,
      maxRaiseTo: self ? self.streetBet + self.stack : 0,
      canRaise: !!self && canRaise(s, userId),
      canAct: !!self && turn === userId && !self.folded && !self.allIn,
    },
    actionLog: s.actionLog.slice(-20),
    pots: s.pots,
    result: s.result,
    payouts: s.payouts,
  };
}
export type PokerView = ReturnType<typeof publicPokerTable>;
