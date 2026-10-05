import { createHash } from "node:crypto";
import type { TransactionSql, JSONValue } from "postgres";
import { fail } from "@tell-aviv/shared";
import { z } from "zod";
import type { PokerState } from "../../../games/casino/multiplayer-poker";
type Sql = TransactionSql;
const json = (value: unknown): JSONValue =>
  JSON.parse(JSON.stringify(value)) as JSONValue;
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, ordered(child)]),
    );
  return value;
}
const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(ordered(value)))
    .digest("hex");
export interface PersistentPokerTable {
  id: string;
  minBuyIn: number;
  maxBuyIn: number;
  handNumber: number;
  closed?: boolean;
  seats: {
    userId: string;
    stack: number;
    sittingOut: boolean;
    pendingLeave: boolean;
  }[];
  pendingOperation?: {
    type: "seat" | "leave" | "close";
    userId: string;
    requestId: string;
    amount?: number;
    sittingOut?: boolean;
  };
}
interface TableLobby {
  code: string;
  matchId: string;
  visibility: string;
  status: string;
  startedAt?: number;
  players: { id: string; username: string }[];
  state: unknown;
  pokerTable?: PersistentPokerTable;
}
const amount = z.number().int().min(0).max(60000);
const financialState = z
  .object({
    kind: z.literal("poker"),
    phase: z.enum(["betting", "settled", "cancelled"]),
    revision: z.number().int().min(1).max(1e12),
    table: z
      .object({
        id: z.string().uuid(),
        handNumber: z.number().int().min(1).max(10000),
        minBuyIn: z.number().int().min(100).max(10000),
        maxBuyIn: z.number().int().min(100).max(10000),
      })
      .passthrough(),
    seats: z
      .array(
        z.object({
          userId: z.string().uuid(),
          stack: amount,
          initialStack: z.number().int().min(1).max(60000),
          committed: amount,
          streetBet: amount,
          folded: z.boolean(),
          allIn: z.boolean(),
          hole: z.array(z.number().int().min(0).max(51)).length(2),
        }),
      )
      .min(2)
      .max(6),
    pot: amount,
    community: z.array(z.number().int().min(0).max(51)).max(5),
    deck: z.array(z.number().int().min(0).max(51)).max(52),
    payouts: z.record(z.string(), amount).optional(),
  })
  .passthrough();
async function wallet(
  sql: Sql,
  id: string,
  change: number,
  reason: string,
  reference: string,
) {
  const opening =
    await sql`INSERT INTO currency_accounts(user_id,currency,balance) VALUES(${id},'casino-credits',1000) ON CONFLICT DO NOTHING RETURNING balance`;
  if (opening.length)
    await sql`INSERT INTO currency_ledger(user_id,currency,amount,balance_after,reason) VALUES(${id},'casino-credits',1000,1000,'opening fictional credits')`;
  const [row] =
    await sql`SELECT balance FROM currency_accounts WHERE user_id=${id} AND currency='casino-credits' FOR UPDATE`;
  const next = Number(row.balance) + change;
  if (!Number.isSafeInteger(next) || next < 0)
    fail(400, "Not enough fictional Credits for this table seat");
  if (!change) return;
  await sql`UPDATE currency_accounts SET balance=${next} WHERE user_id=${id} AND currency='casino-credits'`;
  await sql`INSERT INTO currency_ledger(user_id,currency,amount,balance_after,reason,reference_id) VALUES(${id},'casino-credits',${change},${next},${reason},${reference})`;
}
async function withdraw(
  sql: Sql,
  tableId: string,
  userId: string,
  reason: string,
  reference: string,
) {
  const [seat] =
    await sql`SELECT * FROM casino_poker_table_seats WHERE table_id=${tableId} AND user_id=${userId} AND status='active' FOR UPDATE`;
  if (!seat) return;
  await wallet(sql, userId, Number(seat.stack), reason, reference);
  await sql`UPDATE casino_poker_table_seats SET stack=0,status='left',pending_leave=false,leave_request_id=NULL WHERE table_id=${tableId} AND user_id=${userId}`;
}
export async function closePersistentPokerTable(
  sql: Sql,
  tableId: string,
  reason = "persistent poker close",
) {
  const [table] =
    await sql`SELECT * FROM casino_poker_tables WHERE id=${tableId} FOR UPDATE`;
  if (!table || table.status === "closed") return false;
  const hands =
    await sql`SELECT match_id FROM casino_poker_table_hands WHERE table_id=${tableId} AND status='active' FOR UPDATE`;
  for (const hand of hands) {
    await sql`UPDATE casino_poker_table_seats s SET stack=h.starting_stack FROM casino_poker_table_hand_seats h WHERE h.match_id=${hand.match_id} AND h.user_id=s.user_id AND s.table_id=${tableId} AND s.status='active'`;
    await sql`UPDATE casino_poker_table_hands SET status='refunded',settled_at=now(),public_summary=${sql.json({ reason: "Table aborted; the current hand's starting stacks were returned" })} WHERE match_id=${hand.match_id}`;
  }
  const seats =
    await sql`SELECT user_id FROM casino_poker_table_seats WHERE table_id=${tableId} AND status='active' ORDER BY user_id FOR UPDATE`;
  for (const seat of seats)
    await withdraw(sql, tableId, String(seat.user_id), reason, tableId);
  await sql`UPDATE casino_poker_tables SET status='closed',closed_at=now(),updated_at=now() WHERE id=${tableId}`;
  return true;
}
export async function cancelPersistentPokerForAccount(
  sql: Sql,
  userId: string,
) {
  const tables =
    await sql`SELECT t.id FROM casino_poker_tables t JOIN casino_poker_table_seats s ON s.table_id=t.id WHERE s.user_id=${userId} AND s.status='active' AND t.status='active' ORDER BY t.id`;
  for (const table of tables)
    await closePersistentPokerTable(
      sql,
      String(table.id),
      "persistent poker abort refund",
    );
}
export async function expirePersistentPokerTables(
  sql: Sql,
  limit: number,
  ownerId?: string,
) {
  const owned = ownerId
    ? sql`AND EXISTS(SELECT 1 FROM casino_poker_table_seats s WHERE s.table_id=t.id AND s.user_id=${ownerId} AND s.status='active')`
    : sql``;
  const tables =
    await sql`SELECT t.id FROM casino_poker_tables t WHERE t.status='active' AND t.updated_at<now()-interval '24 hours' ${owned} AND NOT EXISTS(SELECT 1 FROM multiplayer_checkpoints c WHERE c.namespace=t.namespace AND c.lobby_code=t.lobby_code AND c.expires_at>now()) ORDER BY t.id FOR UPDATE SKIP LOCKED LIMIT ${limit}`;
  let count = 0;
  for (const table of tables)
    if (
      await closePersistentPokerTable(
        sql,
        String(table.id),
        "persistent poker abort refund",
      )
    )
      count++;
  return count;
}
export async function syncPersistentPoker(
  sql: Sql,
  lobby: TableLobby,
  namespace: string,
) {
  const table = lobby.pokerTable!;
  if (lobby.visibility !== "private")
    fail(403, "Persistent poker tables are private");
  if (
    !z.string().uuid().safeParse(table.id).success ||
    !Number.isInteger(table.minBuyIn) ||
    !Number.isInteger(table.maxBuyIn) ||
    table.minBuyIn < 100 ||
    table.maxBuyIn > 10000 ||
    table.maxBuyIn < table.minBuyIn
  )
    fail(409, "Persistent poker bounds are invalid");
  // Account erasure locks the owner before closing their table. Keep participant
  // references in the same user -> table order, before any hand/wallet FK writes.
  const activeSeats =
    await sql`SELECT user_id FROM casino_poker_table_seats WHERE table_id=${table.id} AND status='active'`;
  const stateSeats = financialState.safeParse(lobby.state);
  const participantIds = [
    ...lobby.players.map((player) => player.id),
    ...table.seats.map((seat) => seat.userId),
    ...activeSeats.map((seat) => String(seat.user_id)),
    ...(stateSeats.success
      ? stateSeats.data.seats.map((seat) => seat.userId)
      : []),
    ...(table.pendingOperation ? [table.pendingOperation.userId] : []),
  ];
  const lockedIds = [
    ...new Set(
      participantIds.filter((id) => z.string().uuid().safeParse(id).success),
    ),
  ].sort();
  await sql`SELECT id FROM users WHERE id=ANY(${lockedIds}::uuid[]) ORDER BY id FOR SHARE`;
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`casino-poker-table:${table.id}`},0))`;
  await sql`INSERT INTO casino_poker_tables(id,namespace,lobby_code,minimum_buy_in,maximum_buy_in) VALUES(${table.id},${namespace},${lobby.code},${table.minBuyIn},${table.maxBuyIn}) ON CONFLICT(id) DO NOTHING`;
  const [stored] =
    await sql`SELECT * FROM casino_poker_tables WHERE id=${table.id} FOR UPDATE`;
  if (
    stored.namespace !== namespace ||
    stored.lobby_code !== lobby.code ||
    Number(stored.minimum_buy_in) !== table.minBuyIn ||
    Number(stored.maximum_buy_in) !== table.maxBuyIn
  )
    fail(409, "Persistent poker identity changed");
  if (stored.status === "closed") {
    table.closed = true;
    table.seats = [];
    delete table.pendingOperation;
    return { status: "refunded" };
  }
  // Another transaction may have added a seat while this caller waited. Retry
  // from the committed checkpoint instead of acquiring a new user lock late.
  if (
    (
      await sql`SELECT 1 FROM casino_poker_table_seats WHERE table_id=${table.id} AND status='active' AND NOT(user_id=ANY(${lockedIds}::uuid[])) LIMIT 1`
    ).length
  )
    fail(409, "Persistent poker participants changed; retry shortly");
  if (
    lobby.state &&
    typeof lobby.state === "object" &&
    "kind" in lobby.state &&
    lobby.state.kind === "poker" &&
    "table" in lobby.state &&
    lobby.state.table
  ) {
    const parsed = financialState.safeParse(lobby.state);
    if (!parsed.success)
      fail(409, "Persistent poker financial state is invalid");
    const s = lobby.state as PokerState;
    const cards = [
      ...s.deck,
      ...s.community,
      ...s.seats.flatMap((p) => p.hole),
    ];
    const total = s.seats.reduce((sum, p) => sum + (p.initialStack ?? 0), 0);
    if (
      new Set(s.seats.map((p) => p.userId)).size !== s.seats.length ||
      new Set(cards).size !== cards.length ||
      total > 60000
    )
      fail(409, "Persistent poker seat or deck state is invalid");
    if (
      s.table!.id !== table.id ||
      s.table!.minBuyIn !== table.minBuyIn ||
      s.table!.maxBuyIn !== table.maxBuyIn
    )
      fail(409, "Persistent poker hand identity changed");
    if (
      (s.phase === "betting" &&
        (s.seats.reduce((sum, p) => sum + p.stack, 0) + s.pot !== total ||
          s.seats.reduce((sum, p) => sum + p.committed, 0) !== s.pot ||
          s.seats.some(
            (p) =>
              p.stack + p.committed !== p.initialStack ||
              p.streetBet > p.committed,
          ))) ||
      (s.phase === "settled" &&
        (s.seats.reduce((sum, p) => sum + p.stack, 0) !== total ||
          !s.payouts ||
          Object.keys(s.payouts).length !== s.seats.length ||
          s.seats.some((p) => s.payouts![p.userId] !== p.stack)))
    )
      fail(409, "Persistent poker chip conservation failed");
    const stateDigest = digest(s);
    let [hand] =
      await sql`SELECT * FROM casino_poker_table_hands WHERE match_id=${lobby.matchId} FOR UPDATE`;
    if (hand) {
      if (
        hand.table_id !== table.id ||
        Number(hand.hand_number) !== s.table!.handNumber
      )
        fail(409, "Persistent poker hand identity changed");
      if (hand.status === "refunded") return { status: "refunded" };
      if (Number(hand.last_revision) > s.revision)
        fail(409, "Persistent poker checkpoint is stale");
      if (
        Number(hand.last_revision) === s.revision &&
        hand.state_digest !== stateDigest
      )
        fail(409, "Persistent poker revision was reused");
      if (Number(hand.last_revision) < s.revision && hand.status === "settled")
        fail(409, "Persistent poker hand already settled");
    } else {
      if (
        s.table!.handNumber !== Number(stored.hand_number) + 1 ||
        s.phase === "cancelled"
      )
        fail(409, "Persistent poker hand number is stale");
      const seats =
        await sql`SELECT * FROM casino_poker_table_seats WHERE table_id=${table.id} AND status='active' AND sitting_out=false AND pending_leave=false AND stack>0 ORDER BY user_id FOR UPDATE`;
      if (
        seats.length !== s.seats.length ||
        seats.some(
          (p) =>
            !s.seats.some(
              (seat) =>
                seat.userId === p.user_id &&
                seat.initialStack === Number(p.stack),
            ),
        )
      )
        fail(409, "Persistent poker reserved stacks changed");
      const ids = s.seats.map((p) => p.userId);
      const users =
        await sql`SELECT id FROM users WHERE id IN ${sql(ids)} AND disabled=false`;
      if (users.length !== ids.length)
        fail(403, "A poker participant is unavailable");
      if (
        (
          await sql`SELECT 1 FROM user_blocks WHERE user_id IN ${sql(ids)} AND blocked_id IN ${sql(ids)} LIMIT 1`
        ).length
      )
        fail(403, "Poker table is unavailable");
      await sql`INSERT INTO casino_poker_table_hands(match_id,table_id,hand_number,started_at) VALUES(${lobby.matchId},${table.id},${s.table!.handNumber},${new Date(lobby.startedAt ?? Date.now()).toISOString()})`;
      for (const p of s.seats)
        await sql`INSERT INTO casino_poker_table_hand_seats(match_id,user_id,starting_stack,own_cards) VALUES(${lobby.matchId},${p.userId},${p.initialStack!},${sql.json(p.hole)})`;
      await sql`UPDATE casino_poker_tables SET hand_number=${s.table!.handNumber} WHERE id=${table.id}`;
      [hand] =
        await sql`SELECT * FROM casino_poker_table_hands WHERE match_id=${lobby.matchId}`;
    }
    if (Number(hand.last_revision) < s.revision) {
      const start =
        await sql`SELECT user_id,starting_stack FROM casino_poker_table_hand_seats WHERE match_id=${lobby.matchId}`;
      if (
        start.length !== s.seats.length ||
        start.some(
          (p) =>
            !s.seats.some(
              (seat) =>
                seat.userId === p.user_id &&
                seat.initialStack === Number(p.starting_stack),
            ),
        )
      )
        fail(409, "Persistent poker initial stacks changed");
      const summary = {
        street: s.street,
        actions: s.actionLog,
        community: s.community,
        pots: s.pots ?? [],
        result: s.result ?? null,
        reason: s.result?.reason ?? "",
        persistent: true,
        tableId: table.id,
        handNumber: s.table!.handNumber,
        revealed:
          s.phase === "settled" &&
          s.community.length === 5 &&
          s.seats.filter((p) => !p.folded).length >= 2
            ? s.seats
                .filter((p) => !p.folded)
                .map((p) => ({ userId: p.userId, hole: p.hole }))
            : [],
      };
      if (s.phase === "settled" || s.phase === "cancelled") {
        for (const p of s.seats) {
          const stack = s.phase === "cancelled" ? p.initialStack! : p.stack;
          await sql`UPDATE casino_poker_table_seats SET stack=${stack} WHERE table_id=${table.id} AND user_id=${p.userId} AND status='active'`;
          await sql`UPDATE casino_poker_table_hand_seats SET final_stack=${stack} WHERE match_id=${lobby.matchId} AND user_id=${p.userId}`;
        }
      }
      await sql`INSERT INTO casino_poker_table_journal(match_id,revision,phase,financial_state,action_log) VALUES(${lobby.matchId},${s.revision},${s.phase},${sql.json(json({ pot: s.pot, seats: s.seats.map(({ userId, stack, initialStack, committed, streetBet, folded, allIn }) => ({ userId, stack, initialStack, committed, streetBet, folded, allIn })) }))},${sql.json(json(s.actionLog))})`;
      await sql`UPDATE casino_poker_table_hands SET status=${s.phase === "betting" ? "active" : s.phase === "settled" ? "settled" : "refunded"},last_revision=${s.revision},state_digest=${stateDigest},public_summary=${sql.json(json(summary))},settled_at=CASE WHEN ${s.phase !== "betting"} THEN now() ELSE settled_at END WHERE match_id=${lobby.matchId}`;
    }
  }
  // Departures can arrive together during timeout or account pruning. A
  // retained all-in stays funded until the canonical hand settles.
  await sql`UPDATE casino_poker_table_seats SET pending_leave=true,leave_request_id=gen_random_uuid() WHERE table_id=${table.id} AND status='active' AND pending_leave=false AND NOT(user_id=ANY(${lobby.players.map((p) => p.id)}::uuid[]))`;
  const op = table.pendingOperation;
  if (op) {
    if (
      !z.string().uuid().safeParse(op.requestId).success ||
      !z.string().uuid().safeParse(op.userId).success
    )
      fail(400, "Poker operation ID is invalid");
    const opDigest = digest(op),
      [previous] =
        await sql`SELECT * FROM casino_poker_table_operations WHERE request_id=${op.requestId}`;
    if (previous) {
      if (
        previous.table_id !== table.id ||
        previous.user_id !== op.userId ||
        previous.digest !== opDigest
      )
        fail(409, "Poker request ID was reused");
    } else {
      const [playing] =
        await sql`SELECT 1 FROM casino_poker_table_hands WHERE table_id=${table.id} AND status='active'`;
      if (op.type === "seat") {
        if (playing) fail(409, "Change your seat between hands");
        if (!lobby.players.some((p) => p.id === op.userId))
          fail(403, "Join the table first");
        const memberIds = lobby.players.map((p) => p.id);
        const available =
          await sql`SELECT id FROM users WHERE id IN ${sql(memberIds)} AND disabled=false`;
        if (available.length !== memberIds.length)
          fail(403, "A poker participant is unavailable");
        if (
          (
            await sql`SELECT 1 FROM user_blocks WHERE user_id IN ${sql(memberIds)} AND blocked_id IN ${sql(memberIds)} LIMIT 1`
          ).length
        )
          fail(403, "Poker table is unavailable");
        const addition = op.amount ?? 0;
        if (
          !Number.isInteger(addition) ||
          addition < 0 ||
          addition > table.maxBuyIn
        )
          fail(400, "Choose a valid fictional table amount");
        const [old] =
          await sql`SELECT * FROM casino_poker_table_seats WHERE table_id=${table.id} AND user_id=${op.userId} FOR UPDATE`;
        const current = old?.status === "active" ? Number(old.stack) : 0,
          next = current + addition;
        if ((!old || old.status !== "active") && addition === 0)
          fail(400, "Reserve a funded seat first");
        if (addition > 0 && (next < table.minBuyIn || next > table.maxBuyIn))
          fail(400, "The resulting stack must fit this table's buy-in bounds");
        const [sum] =
          await sql`SELECT coalesce(sum(stack),0)::integer AS chips FROM casino_poker_table_seats WHERE table_id=${table.id} AND status='active'`;
        if (Number(sum.chips) + addition > 60000)
          fail(400, "This table's fictional chip limit is 60000");
        await wallet(
          sql,
          op.userId,
          -addition,
          "persistent poker buy-in",
          op.requestId,
        );
        const others =
          await sql`SELECT user_id FROM casino_poker_table_seats WHERE user_id=${op.userId} AND status='active' AND table_id<>${table.id}`;
        const legacy =
          await sql`SELECT 1 FROM casino_poker_escrows WHERE user_id=${op.userId} AND status='active'`;
        if (others.length || legacy.length)
          fail(
            409,
            "A player already has fictional Credits at another poker table",
          );
        await sql`INSERT INTO casino_poker_table_seats(table_id,user_id,username,stack,buy_in_total,sitting_out) VALUES(${table.id},${op.userId},${lobby.players.find((p) => p.id === op.userId)!.username},${next},${addition},${op.sittingOut ?? false}) ON CONFLICT(table_id,user_id) DO UPDATE SET stack=${next},buy_in_total=casino_poker_table_seats.buy_in_total+${addition},status='active',sitting_out=${op.sittingOut ?? (old?.status === "active" ? Boolean(old.sitting_out) : false)},pending_leave=false,leave_request_id=NULL`;
      } else if (op.type === "leave") {
        if (playing)
          await sql`UPDATE casino_poker_table_seats SET pending_leave=true,leave_request_id=${op.requestId} WHERE table_id=${table.id} AND user_id=${op.userId} AND status='active'`;
        else
          await withdraw(
            sql,
            table.id,
            op.userId,
            "persistent poker leave",
            op.requestId,
          );
      } else {
        if (playing) fail(409, "Close the table between hands");
        await closePersistentPokerTable(sql, table.id);
      }
      await sql`INSERT INTO casino_poker_table_operations(request_id,table_id,user_id,digest) VALUES(${op.requestId},${table.id},${op.userId},${opDigest})`;
    }
    delete table.pendingOperation;
  }
  if (
    !(
      await sql`SELECT 1 FROM casino_poker_table_hands WHERE table_id=${table.id} AND status='active'`
    ).length
  ) {
    const leaving =
      await sql`SELECT user_id,leave_request_id FROM casino_poker_table_seats WHERE table_id=${table.id} AND status='active' AND pending_leave=true ORDER BY user_id FOR UPDATE`;
    for (const p of leaving)
      await withdraw(
        sql,
        table.id,
        String(p.user_id),
        "persistent poker leave",
        String(p.leave_request_id),
      );
    if (!lobby.players.length) await closePersistentPokerTable(sql, table.id);
  }
  const [final] =
    await sql`SELECT status,hand_number FROM casino_poker_tables WHERE id=${table.id}`;
  const seats =
    await sql`SELECT user_id,stack,sitting_out,pending_leave FROM casino_poker_table_seats WHERE table_id=${table.id} AND status='active' ORDER BY user_id`;
  table.closed = final.status === "closed";
  table.handNumber = Number(final.hand_number);
  table.seats = seats.map((p) => ({
    userId: String(p.user_id),
    stack: Number(p.stack),
    sittingOut: Boolean(p.sitting_out),
    pendingLeave: Boolean(p.pending_leave),
  }));
  await sql`UPDATE casino_poker_tables SET updated_at=now() WHERE id=${table.id}`;
  return {
    status: table.closed
      ? "refunded"
      : (lobby.state as PokerState | null)?.phase === "settled"
        ? "settled"
        : "active",
  };
}
