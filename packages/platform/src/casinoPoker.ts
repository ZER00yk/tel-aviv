import { createHash } from "node:crypto";
import type { TransactionSql, JSONValue } from "postgres";
import { z } from "zod";
import { db } from "@tell-aviv/database";
import { fail } from "@tell-aviv/shared";
import {
  syncPersistentPoker,
  cancelPersistentPokerForAccount,
  expirePersistentPokerTables,
  type PersistentPokerTable,
} from "./casinoPokerTables";
const json = (value: unknown): JSONValue =>
  JSON.parse(JSON.stringify(value)) as JSONValue;
const integer = z.number().int().min(0).max(60000);
const card = z.number().int().min(0).max(51);
const seat = z.object({
  userId: z.string().uuid(),
  stack: integer,
  committed: integer,
  streetBet: integer,
  folded: z.boolean(),
  allIn: z.boolean(),
  hole: z.array(card).length(2),
});
const stateSchema = z.object({
  kind: z.literal("poker"),
  phase: z.enum(["betting", "settled", "cancelled"]),
  buyIn: z.number().int().min(100).max(10000),
  seats: z.array(seat).min(2).max(6),
  pot: integer,
  street: z.string().max(20),
  community: z.array(card).max(5),
  revision: z.number().int().min(0).max(1000000),
  actionLog: z
    .array(
      z.object({
        userId: z.string().uuid(),
        action: z.string().max(40),
        amount: integer,
        at: z.number().finite(),
      }),
    )
    .max(1000),
  payouts: z.record(z.string(), integer).optional(),
  pots: z
    .array(
      z.object({
        amount: integer,
        eligible: z.array(z.string().uuid()).max(6),
        winners: z.array(z.string().uuid()).max(6),
      }),
    )
    .max(6)
    .optional(),
  result: z
    .object({
      winners: z.array(z.string().uuid()).max(6),
      scores: z.record(z.string(), integer),
      reason: z.string().max(500),
    })
    .optional(),
});
type FinancialState = z.infer<typeof stateSchema>;
function orderedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, orderedJson(child)]),
    );
  return value;
}
const hashState = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function legacySeatOrderedState(state: FinancialState): FinancialState {
  const orderRecord = (record: Record<string, number>) => {
    const ids = state.seats.map((seat) => seat.userId);
    return Object.fromEntries([
      ...ids
        .filter((id) => Object.hasOwn(record, id))
        .map((id) => [id, record[id]]),
      ...Object.entries(record).filter(([key]) => !ids.includes(key)),
    ]);
  };
  // The original engine constructs these two records from the seats array.
  // Restore only their insertion order; never drop keys or alter values.
  return {
    ...state,
    ...(state.payouts ? { payouts: orderRecord(state.payouts) } : {}),
    ...(state.result
      ? {
          result: { ...state.result, scores: orderRecord(state.result.scores) },
        }
      : {}),
  };
}
type Sql = TransactionSql;
export interface PokerEconomyLobby {
  matchId: string;
  code: string;
  visibility: string;
  status: string;
  startedAt?: number;
  players: { id: string; username: string }[];
  state: unknown;
  pokerTable?: PersistentPokerTable;
}
async function ensureWallet(sql: Sql, userId: string) {
  const rows =
    await sql`INSERT INTO currency_accounts(user_id,currency,balance) VALUES(${userId},'casino-credits',1000) ON CONFLICT DO NOTHING RETURNING balance`;
  if (rows.length)
    await sql`INSERT INTO currency_ledger(user_id,currency,amount,balance_after,reason) VALUES(${userId},'casino-credits',1000,1000,'opening fictional credits')`;
}
async function adjustWallet(
  sql: Sql,
  userId: string,
  amount: number,
  reason: string,
  reference: string,
) {
  if (!amount) return;
  const [wallet] =
    await sql`SELECT balance FROM currency_accounts WHERE user_id=${userId} AND currency='casino-credits' FOR UPDATE`;
  if (!wallet) fail(409, "Poker wallet is unavailable");
  const next = Number(wallet.balance) + amount;
  if (!Number.isSafeInteger(next) || next < 0)
    fail(400, "Not enough fictional Credits for this poker buy-in");
  await sql`UPDATE currency_accounts SET balance=${next} WHERE user_id=${userId} AND currency='casino-credits'`;
  await sql`INSERT INTO currency_ledger(user_id,currency,amount,balance_after,reason,reference_id) VALUES(${userId},'casino-credits',${amount},${next},${reason},${reference})`;
}
async function eligible(sql: Sql, ids: string[]) {
  const users =
    await sql`SELECT id FROM users WHERE id IN ${sql(ids)} AND disabled=false`;
  if (users.length !== ids.length)
    fail(403, "A poker participant is unavailable");
  const blocks =
    await sql`SELECT 1 FROM user_blocks WHERE user_id IN ${sql(ids)} AND blocked_id IN ${sql(ids)} LIMIT 1`;
  if (blocks.length) fail(403, "Poker table is unavailable");
}
export async function requireCasinoPokerEligibility(
  userId: string,
  existingUserIds: string[],
) {
  const ids = [...new Set([userId, ...existingUserIds])];
  if (ids.length > 6) fail(400, "Private poker tables have at most six seats");
  await db.begin((sql) => eligible(sql, ids));
}
/** The caller must save the canonical private lobby checkpoint in THIS transaction. */
export async function syncCasinoPoker(
  sql: Sql,
  lobby: PokerEconomyLobby,
  namespace = "tell-aviv",
) {
  if (lobby.pokerTable) return syncPersistentPoker(sql, lobby, namespace);
  if (
    !lobby.state ||
    typeof lobby.state !== "object" ||
    !("kind" in lobby.state) ||
    lobby.state.kind !== "poker"
  )
    return;
  if (lobby.visibility !== "private") fail(403, "Poker tables are private");
  const parsed = stateSchema.safeParse(lobby.state);
  if (!parsed.success) fail(409, "Poker financial state is invalid");
  const s = parsed.data,
    ids = s.seats.map((player) => player.userId).sort();
  if (new Set(ids).size !== ids.length) fail(409, "Poker seats cannot repeat");
  const cards = [...s.seats.flatMap((player) => player.hole), ...s.community];
  if (new Set(cards).size !== cards.length)
    fail(409, "Poker card state is invalid");
  const total = ids.length * s.buyIn,
    stackTotal = s.seats.reduce((sum, player) => sum + player.stack, 0);
  if (
    (s.phase === "betting" && stackTotal + s.pot !== total) ||
    (s.phase === "settled" && stackTotal !== total)
  )
    fail(409, "Poker chip conservation failed");
  if (
    s.phase === "betting" &&
    (s.seats.some(
      (player) =>
        player.stack + player.committed !== s.buyIn ||
        player.streetBet > player.committed,
    ) ||
      s.seats.reduce((sum, player) => sum + player.committed, 0) !== s.pot)
  )
    fail(409, "Poker contribution conservation failed");
  if (
    s.phase === "settled" &&
    (!s.payouts ||
      Object.keys(s.payouts).length !== ids.length ||
      s.seats.some((player) => s.payouts![player.userId] !== player.stack))
  )
    fail(409, "Poker payout state is invalid");
  // JSONB changes object-key order. Arrays (seats, actions, cards) remain ordered.
  const digest = hashState(orderedJson(s));
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`casino-poker:${lobby.matchId}`},0))`;
  let [hand] =
    await sql`SELECT * FROM casino_poker_hands WHERE match_id=${lobby.matchId} FOR UPDATE`;
  if (hand) {
    if (
      hand.namespace !== namespace ||
      hand.lobby_code !== lobby.code ||
      Number(hand.buy_in) !== s.buyIn
    )
      fail(409, "Poker hand identity changed");
    if (hand.status === "refunded") return { status: "refunded" };
    if (Number(hand.last_revision) > s.revision)
      fail(
        409,
        "Poker checkpoint is stale; reconnect to recover the committed hand",
      );
    if (Number(hand.last_revision) === s.revision) {
      if (hand.state_digest !== digest) {
        if (
          hand.state_digest !== hashState(s) &&
          hand.state_digest !== hashState(legacySeatOrderedState(s))
        )
          fail(409, "Poker revision was reused with different state");
        // Upgrade a matching legacy digest without paying or journaling again.
        await sql`UPDATE casino_poker_hands SET state_digest=${digest} WHERE match_id=${lobby.matchId}`;
      }
      return { status: String(hand.status) };
    }
    if (hand.status === "settled") fail(409, "This poker hand already settled");
  } else {
    if (
      s.phase !== "betting" ||
      lobby.status !== "playing" ||
      lobby.players.length !== ids.length ||
      lobby.players.some((player) => !ids.includes(player.id))
    )
      fail(409, "A poker hand must begin with its complete table");
    await eligible(sql, ids);
    for (const id of ids) await ensureWallet(sql, id);
    await sql`SELECT user_id FROM currency_accounts WHERE currency='casino-credits' AND user_id IN ${sql(ids)} ORDER BY user_id FOR UPDATE`;
    if (
      (
        await sql`SELECT 1 FROM casino_poker_escrows WHERE user_id IN ${sql(ids)} AND status='active' UNION ALL SELECT 1 FROM casino_poker_table_seats WHERE user_id IN ${sql(ids)} AND status='active'`
      ).length
    )
      fail(409, "A player already has fictional Credits in another poker hand");
    await sql`INSERT INTO casino_poker_hands(match_id,namespace,lobby_code,buy_in,started_at) VALUES(${lobby.matchId},${namespace},${lobby.code},${s.buyIn},${new Date(lobby.startedAt ?? Date.now()).toISOString()})`;
    for (const player of s.seats) {
      await adjustWallet(
        sql,
        player.userId,
        -s.buyIn,
        "multiplayer poker buy-in",
        lobby.matchId,
      );
      await sql`INSERT INTO casino_poker_escrows(match_id,user_id,username,amount,own_cards) VALUES(${lobby.matchId},${player.userId},${lobby.players.find((member) => member.id === player.userId)?.username ?? "player"},${s.buyIn},${sql.json(player.hole)})`;
    }
    [hand] =
      await sql`SELECT * FROM casino_poker_hands WHERE match_id=${lobby.matchId} FOR UPDATE`;
  }
  const escrow =
    await sql`SELECT * FROM casino_poker_escrows WHERE match_id=${lobby.matchId} ORDER BY user_id FOR UPDATE`;
  if (
    escrow.length !== ids.length ||
    escrow.some(
      (player) =>
        !ids.includes(String(player.user_id)) ||
        Number(player.amount) !== s.buyIn,
    )
  )
    fail(409, "Poker escrow participants changed");
  const abort =
    s.phase === "cancelled" ||
    (lobby.status === "finished" && s.phase !== "settled");
  if (s.phase === "settled" || abort) {
    await sql`SELECT user_id FROM currency_accounts WHERE currency='casino-credits' AND user_id IN ${sql(ids)} ORDER BY user_id FOR UPDATE`;
    for (const player of s.seats) {
      const amount = abort ? s.buyIn : player.stack;
      await adjustWallet(
        sql,
        player.userId,
        amount,
        abort ? "multiplayer poker abort refund" : "multiplayer poker cash-out",
        lobby.matchId,
      );
      await sql`UPDATE casino_poker_escrows SET payout=${amount},status=${abort ? "refunded" : "settled"} WHERE match_id=${lobby.matchId} AND user_id=${player.userId}`;
    }
  }
  const summary = {
    street: s.street,
    actions: s.actionLog,
    community: s.community,
    pots: s.pots ?? [],
    result: s.result ?? null,
    reason: abort
      ? "Poker hand cancelled; original buy-ins returned"
      : (s.result?.reason ?? ""),
    revealed:
      s.phase === "settled" &&
      s.community.length === 5 &&
      s.seats.filter((player) => !player.folded).length >= 2
        ? s.seats
            .filter((player) => !player.folded)
            .map((player) => ({ userId: player.userId, hole: player.hole }))
        : [],
  };
  await sql`INSERT INTO casino_poker_chip_journal(match_id,revision,phase,financial_state,action_log) VALUES(${lobby.matchId},${s.revision},${s.phase},${sql.json({ pot: s.pot, seats: s.seats.map(({ userId, stack, committed, streetBet, folded, allIn }) => ({ userId, stack, committed, streetBet, folded, allIn })) })},${sql.json(s.actionLog)})`;
  await sql`UPDATE casino_poker_hands SET status=${abort ? "refunded" : s.phase === "settled" ? "settled" : "active"},last_revision=${s.revision},state_digest=${digest},public_summary=${sql.json(json(summary))},updated_at=now(),settled_at=CASE WHEN ${s.phase === "settled" || abort} THEN now() ELSE settled_at END WHERE match_id=${lobby.matchId}`;
  return {
    status: abort ? "refunded" : s.phase === "settled" ? "settled" : "active",
  };
}
async function abortHand(sql: Sql, matchId: string, reason: string) {
  const [hand] =
    await sql`SELECT * FROM casino_poker_hands WHERE match_id=${matchId} FOR UPDATE`;
  if (!hand || hand.status !== "active") return false;
  const players =
    await sql`SELECT * FROM casino_poker_escrows WHERE match_id=${matchId} AND status='active' ORDER BY user_id FOR UPDATE`;
  for (const player of players)
    await adjustWallet(
      sql,
      String(player.user_id),
      Number(player.amount),
      "multiplayer poker abort refund",
      matchId,
    );
  await sql`UPDATE casino_poker_escrows SET status='refunded',payout=amount WHERE match_id=${matchId}`;
  await sql`UPDATE casino_poker_hands SET status='refunded',settled_at=now(),public_summary=${sql.json({ reason })} WHERE match_id=${matchId}`;
  return true;
}
export async function cancelCasinoPokerForAccount(sql: Sql, userId: string) {
  await cancelPersistentPokerForAccount(sql, userId);
  const hands =
    await sql`SELECT h.match_id FROM casino_poker_hands h JOIN casino_poker_escrows e ON e.match_id=h.match_id WHERE e.user_id=${userId} AND h.status='active' ORDER BY h.match_id`;
  for (const hand of hands)
    await abortHand(
      sql,
      String(hand.match_id),
      "A poker participant account was removed",
    );
}
export async function expireCasinoPokerHands(limit = 50, ownerId?: string) {
  return db.begin(async (sql) => {
    const cap = Number.isFinite(limit)
      ? Math.min(100, Math.max(1, Math.floor(limit)))
      : 50;
    const hands = ownerId
      ? await sql`SELECT h.match_id FROM casino_poker_hands h JOIN casino_poker_escrows e ON e.match_id=h.match_id WHERE e.user_id=${ownerId} AND h.status='active' AND h.updated_at<now()-interval '24 hours' AND NOT EXISTS(SELECT 1 FROM multiplayer_checkpoints c WHERE c.namespace=h.namespace AND c.match_id=h.match_id AND c.expires_at>now()) ORDER BY h.match_id FOR UPDATE OF h SKIP LOCKED LIMIT ${cap}`
      : await sql`SELECT h.match_id FROM casino_poker_hands h WHERE h.status='active' AND h.updated_at<now()-interval '24 hours' AND NOT EXISTS(SELECT 1 FROM multiplayer_checkpoints c WHERE c.namespace=h.namespace AND c.match_id=h.match_id AND c.expires_at>now()) ORDER BY h.match_id FOR UPDATE SKIP LOCKED LIMIT ${cap}`;
    let count = 0;
    for (const hand of hands)
      if (
        await abortHand(
          sql,
          String(hand.match_id),
          "Expired poker recovery window; original buy-ins returned",
        )
      )
        count++;
    count += await expirePersistentPokerTables(sql, cap, ownerId);
    return count;
  });
}
export async function casinoPokerHistory(
  sql: Sql,
  userId: string,
  allRecords = false,
) {
  const limit = allRecords ? sql`` : sql`LIMIT 50`;
  const hands = await sql`SELECT * FROM (
      SELECT h.match_id AS "matchId",h.lobby_code AS "lobbyCode",h.status,h.buy_in AS "buyIn",h.public_summary AS summary,h.started_at AS "startedAt",h.settled_at AS "settledAt",e.amount AS "yourBuyIn",e.payout AS "yourPayout",e.own_cards AS "yourCards",NULL::uuid AS "tableId",NULL::integer AS "handNumber"
      FROM casino_poker_hands h JOIN casino_poker_escrows e ON e.match_id=h.match_id WHERE e.user_id=${userId}
      UNION ALL
      SELECT h.match_id,t.lobby_code,h.status,t.minimum_buy_in,h.public_summary,h.started_at,h.settled_at,s.starting_stack,s.final_stack,s.own_cards,t.id,h.hand_number
      FROM casino_poker_table_hands h JOIN casino_poker_tables t ON t.id=h.table_id JOIN casino_poker_table_hand_seats s ON s.match_id=h.match_id WHERE s.user_id=${userId}
    ) history ORDER BY "startedAt" DESC ${limit}`;
  const [held] =
    await sql`SELECT (SELECT coalesce(sum(amount),0) FROM casino_poker_escrows WHERE user_id=${userId} AND status='active') + (SELECT coalesce(sum(stack),0) FROM casino_poker_table_seats WHERE user_id=${userId} AND status='active') AS credits`;
  const pokerTables =
    await sql`SELECT t.id AS "tableId",t.lobby_code AS "lobbyCode",t.status,t.minimum_buy_in AS "minimumBuyIn",t.maximum_buy_in AS "maximumBuyIn",t.hand_number AS "handNumber",s.stack,s.status AS "seatStatus",s.sitting_out AS "sittingOut",s.buy_in_total AS "totalBuyIn" FROM casino_poker_tables t JOIN casino_poker_table_seats s ON s.table_id=t.id WHERE s.user_id=${userId} ORDER BY t.created_at DESC ${limit}`;
  return {
    pokerHands: hands,
    pokerTables,
    pokerEscrowCredits: Number(held.credits),
  };
}
