import { createHash, randomUUID } from "node:crypto";
import type { TransactionSql, JSONValue } from "postgres";
import { z } from "zod";
import { db } from "@tell-aviv/database";
import { fail } from "@tell-aviv/shared";
import type { CasinoState } from "../../../games/server/casino";
import { publishEvent } from "../../../apps/realtime/src/events";

type Sql = TransactionSql;
const json = (value: unknown): JSONValue =>
  JSON.parse(JSON.stringify(value)) as JSONValue;
type Ensure = (sql: Sql, userId: string, currency: string) => Promise<void>;
type Change = (
  sql: Sql,
  userId: string,
  currency: string,
  amount: number,
  reason: string,
  reference: string,
) => Promise<void>;
const wanted = z
  .object({
    itemId: z.string().min(1).max(100),
    count: z.number().int().min(1).max(5),
  })
  .strict();
const createSchema = z
  .object({
    operationId: z.string().uuid(),
    username: z.string().min(3).max(24),
    copyIds: z.array(z.string().uuid()).max(5).default([]),
    offeredCredits: z.number().int().min(0).max(100000).default(0),
    requestedCredits: z.number().int().min(0).max(100000).default(0),
    requestedItems: z.array(wanted).max(5).default([]),
    expiresInHours: z.number().int().min(1).max(72).default(24),
  })
  .strict();
const resolveSchema = z
  .object({
    operationId: z.string().uuid(),
    offerId: z.string().uuid(),
    copyIds: z.array(z.string().uuid()).max(5).default([]),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success)
    fail(400, result.error.issues.map((issue) => issue.message).join("; "));
  return result.data;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
export async function idempotentCasinoOperation(
  sql: Sql,
  userId: string,
  state: CasinoState,
  action: string,
  payload: Record<string, unknown>,
  perform: () => Promise<boolean>,
) {
  const operationId = parse(z.string().uuid(), payload.operationId);
  const digest = createHash("sha256")
    .update(JSON.stringify(canonical({ action, payload })))
    .digest("hex");
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`casino-operation:${userId}:${operationId}`},0))`;
  const [existing] =
    await sql`SELECT action,payload_digest,result FROM casino_market_operations WHERE user_id=${userId} AND operation_id=${operationId}`;
  if (existing) {
    if (existing.action !== action || existing.payload_digest !== digest)
      fail(409, "Operation ID was already used with different trade details");
    state.lastResult = existing.result;
    return true;
  }
  const handled = await perform();
  if (!handled) return false;
  await sql`INSERT INTO casino_market_operations(user_id,operation_id,action,payload_digest,result) VALUES(${userId},${operationId},${action},${digest},${sql.json(json(state.lastResult ?? {}))})`;
  return true;
}
export async function assertCollectibleAvailable(sql: Sql, copyId: string) {
  if (
    (
      await sql`SELECT 1 FROM casino_collectible_reservations WHERE collectible_id=${copyId}`
    ).length
  )
    fail(
      409,
      "Cancel the pending offer before trading this reserved collectible",
    );
}
async function counterpart(sql: Sql, sender: string, username: string) {
  const [target] =
    await sql`SELECT id,username FROM users WHERE lower(username)=lower(${username}) AND disabled=false`;
  if (!target || target.id === sender)
    fail(400, "Choose another active player");
  await unblocked(sql, sender, String(target.id));
  return String(target.id);
}
async function unblocked(sql: Sql, a: string, b: string) {
  if (
    (
      await sql`SELECT 1 FROM user_blocks WHERE (user_id=${a} AND blocked_id=${b}) OR (user_id=${b} AND blocked_id=${a})`
    ).length
  )
    fail(403, "Trade unavailable");
}
/** Refunds are guaranteed even if later earnings filled the normal spending limit. */
async function refund(
  sql: Sql,
  senderId: string,
  amount: number,
  reference: string,
  reason: string,
) {
  if (!amount) return;
  const [account] =
    await sql`UPDATE currency_accounts SET balance=balance+${amount} WHERE user_id=${senderId} AND currency='casino-credits' RETURNING balance`;
  if (!account) fail(409, "Escrow account is unavailable");
  await sql`INSERT INTO currency_ledger(user_id,currency,amount,balance_after,reason,reference_id) VALUES(${senderId},'casino-credits',${amount},${account.balance},${reason},${reference})`;
}
async function release(
  sql: Sql,
  offer: Record<string, unknown>,
  status: string,
) {
  if (offer.status !== "pending") return;
  await refund(
    sql,
    String(offer.sender_id),
    Number(offer.offered_credits),
    String(offer.id),
    `offer escrow refund: ${status}`,
  );
  await sql`DELETE FROM casino_collectible_reservations WHERE offer_id=${String(offer.id)}`;
  await sql`UPDATE casino_trade_offers SET status=${status},settled_at=now() WHERE id=${String(offer.id)} AND status='pending'`;
}
export async function recordCasinoTrade(
  sql: Sql,
  kind: "gift" | "marketplace" | "barter",
  reference: string,
  senderId: string,
  recipientId: string,
  offeredCredits: number,
  requestedCredits: number,
  offeredItems: unknown[],
  requestedItems: unknown[] = [],
) {
  const users =
    await sql`SELECT id,username FROM users WHERE id IN (${senderId},${recipientId})`;
  const username = (id: string) =>
    String(users.find((user) => user.id === id)?.username ?? "removed-player");
  await sql`INSERT INTO casino_trade_history(kind,reference_id,sender_id,recipient_id,sender_username,recipient_username,offered_credits,requested_credits,offered_items,requested_items) VALUES(${kind},${reference},${senderId},${recipientId},${username(senderId)},${username(recipientId)},${offeredCredits},${requestedCredits},${sql.json(json(offeredItems))},${sql.json(json(requestedItems))}) ON CONFLICT(reference_id) DO NOTHING`;
}
export async function casinoMarketplaceAction(
  sql: Sql,
  userId: string,
  state: CasinoState,
  action: string,
  payload: Record<string, unknown>,
  ensure: Ensure,
  change: Change,
): Promise<boolean> {
  if (!action.startsWith("marketplace.offer.")) return false;
  if (
    ![
      "marketplace.offer.create",
      "marketplace.offer.accept",
      "marketplace.offer.reject",
      "marketplace.offer.cancel",
    ].includes(action)
  )
    fail(400, "Unknown offer action");
  const input =
    action === "marketplace.offer.create"
      ? parse(createSchema, payload)
      : parse(resolveSchema, payload);
  return idempotentCasinoOperation(
    sql,
    userId,
    state,
    action,
    input,
    async () => {
      if ("username" in input) {
        const target = await counterpart(sql, userId, input.username);
        const ids = [...new Set(input.copyIds)].sort();
        if (
          ids.length !== input.copyIds.length ||
          new Set(input.requestedItems.map((item) => item.itemId)).size !==
            input.requestedItems.length
        )
          fail(400, "Trade items cannot repeat");
        if (!ids.length && !input.offeredCredits)
          fail(400, "An offer must reserve an item or fictional Credits");
        if (input.requestedItems.reduce((sum, item) => sum + item.count, 0) > 5)
          fail(400, "At most five collectibles can be requested");
        const [counts] =
          await sql`SELECT count(*) FILTER(WHERE status='pending')::integer AS active FROM casino_trade_offers WHERE sender_id=${userId}`;
        if (Number(counts.active) >= 20)
          fail(429, "Resolve existing offers before sending more");
        const [rate] =
          await sql`SELECT count(*)::integer AS count FROM casino_market_operations WHERE user_id=${userId} AND action='marketplace.offer.create' AND created_at>now()-interval '1 minute'`;
        if (Number(rate.count) >= 10)
          fail(429, "Please wait before sending more offers");
        for (const item of input.requestedItems)
          if (
            !(
              await sql`SELECT 1 FROM casino_collectible_stock WHERE item_id=${item.itemId}`
            ).length
          )
            fail(400, "Requested collectible edition does not exist");
        const copies = ids.length
          ? await sql`SELECT id,user_id,item_id AS "itemId",serial FROM casino_collectibles WHERE id IN ${sql(ids)} ORDER BY id FOR UPDATE`
          : [];
        if (
          copies.length !== ids.length ||
          copies.some((copy) => copy.user_id !== userId)
        )
          fail(403, "Only owned collectibles can be offered");
        for (const copy of copies) {
          await assertCollectibleAvailable(sql, String(copy.id));
          if (
            (
              await sql`SELECT 1 FROM casino_marketplace WHERE collectible_id=${copy.id} AND status='active'`
            ).length
          )
            fail(409, "Cancel the listing before reserving its collectible");
        }
        const offerId = randomUUID();
        if (input.offeredCredits)
          await change(
            sql,
            userId,
            "casino-credits",
            -input.offeredCredits,
            "offer escrow reservation",
            offerId,
          );
        await sql`INSERT INTO casino_trade_offers(id,sender_id,recipient_id,offered_credits,requested_credits,requested_items,expires_at) VALUES(${offerId},${userId},${target},${input.offeredCredits},${input.requestedCredits},${sql.json(input.requestedItems)},now()+${input.expiresInHours}*interval '1 hour')`;
        for (const copy of copies) {
          await sql`INSERT INTO casino_offer_items(offer_id,collectible_id,item_id,serial) VALUES(${offerId},${copy.id},${copy.itemId},${copy.serial})`;
          await sql`INSERT INTO casino_collectible_reservations(collectible_id,offer_id) VALUES(${copy.id},${offerId})`;
        }
        await sql`INSERT INTO notifications(user_id,actor_id,kind,title,link) VALUES(${target},${userId},'marketplace','A collectible trade offer is waiting','/games/casino/play')`;
        state.lastResult = {
          game: "offer",
          operation: "create",
          offerId,
          status: "pending",
          reservedCredits: input.offeredCredits,
        };
        return true;
      }
      const [offer] =
        await sql`SELECT * FROM casino_trade_offers WHERE id=${input.offerId} FOR UPDATE`;
      if (!offer || ![offer.sender_id, offer.recipient_id].includes(userId))
        fail(404, "Offer not found");
      const cancelling = action === "marketplace.offer.cancel";
      if (
        cancelling ? offer.sender_id !== userId : offer.recipient_id !== userId
      )
        fail(
          403,
          cancelling
            ? "Only the sender can cancel this offer"
            : "Only the recipient can resolve this offer",
        );
      if (offer.status !== "pending")
        fail(409, "This offer has already been resolved");
      if (new Date(offer.expires_at).getTime() <= Date.now()) {
        await release(sql, offer, "expired");
        state.lastResult = {
          game: "offer",
          operation: "expired",
          offerId: offer.id,
          status: "expired",
        };
        return true;
      }
      if (cancelling || action === "marketplace.offer.reject") {
        await release(sql, offer, cancelling ? "cancelled" : "rejected");
        state.lastResult = {
          game: "offer",
          operation: cancelling ? "cancel" : "reject",
          offerId: offer.id,
          status: cancelling ? "cancelled" : "rejected",
        };
        return true;
      }
      await unblocked(sql, String(offer.sender_id), userId);
      if (
        !(
          await sql`SELECT 1 FROM users WHERE id=${offer.sender_id} AND disabled=false`
        ).length
      )
        fail(403, "Trade unavailable");
      const offered =
        await sql`SELECT collectible_id AS id,item_id AS "itemId",serial FROM casino_offer_items WHERE offer_id=${offer.id} ORDER BY collectible_id`;
      if (offered.some((copy) => !copy.id))
        fail(409, "An offered collectible no longer exists");
      const selected = [...new Set(input.copyIds)].sort();
      if (selected.length !== input.copyIds.length)
        fail(400, "Trade items cannot repeat");
      const requested = offer.requested_items as {
        itemId: string;
        count: number;
      }[];
      if (
        selected.length !== requested.reduce((sum, item) => sum + item.count, 0)
      )
        fail(400, "Select the requested collectible copies to accept");
      const allIds = [
        ...new Set([...offered.map((copy) => String(copy.id)), ...selected]),
      ].sort();
      const locked = allIds.length
        ? await sql`SELECT id,user_id,item_id AS "itemId",serial FROM casino_collectibles WHERE id IN ${sql(allIds)} ORDER BY id FOR UPDATE`
        : [];
      const received = locked.filter((copy) =>
        selected.includes(String(copy.id)),
      );
      if (
        received.length !== selected.length ||
        received.some((copy) => copy.user_id !== userId)
      )
        fail(403, "Requested collectible ownership changed");
      for (const item of requested)
        if (
          received.filter((copy) => copy.itemId === item.itemId).length !==
          item.count
        )
          fail(400, "Selected copies do not match the requested editions");
      for (const copy of received) {
        await assertCollectibleAvailable(sql, String(copy.id));
        if (
          (
            await sql`SELECT 1 FROM casino_marketplace WHERE collectible_id=${copy.id} AND status='active'`
          ).length
        )
          fail(409, "Cancel the listing before accepting with its collectible");
      }
      for (const copy of offered) {
        if (
          !locked.some(
            (owned) =>
              owned.id === copy.id && owned.user_id === offer.sender_id,
          ) ||
          !(
            await sql`SELECT 1 FROM casino_collectible_reservations WHERE collectible_id=${copy.id} AND offer_id=${offer.id}`
          ).length
        )
          fail(409, "Offered collectible reservation changed");
      }
      for (const owner of [String(offer.sender_id), userId].sort())
        await ensure(sql, owner, "casino-credits");
      await sql`SELECT user_id FROM currency_accounts WHERE currency='casino-credits' AND user_id IN (${offer.sender_id},${userId}) ORDER BY user_id FOR UPDATE`;
      // The recipient funds their side before touching any escrow or item ownership.
      if (Number(offer.requested_credits))
        await change(
          sql,
          userId,
          "casino-credits",
          -Number(offer.requested_credits),
          "offer barter payment",
          String(offer.id),
        );
      if (Number(offer.offered_credits))
        await change(
          sql,
          userId,
          "casino-credits",
          Number(offer.offered_credits),
          "offer escrow received",
          String(offer.id),
        );
      if (Number(offer.requested_credits))
        await change(
          sql,
          String(offer.sender_id),
          "casino-credits",
          Number(offer.requested_credits),
          "offer barter proceeds",
          String(offer.id),
        );
      for (const copy of offered)
        await sql`UPDATE casino_collectibles SET user_id=${userId},acquired_at=now() WHERE id=${copy.id}`;
      for (const copy of received)
        await sql`UPDATE casino_collectibles SET user_id=${offer.sender_id},acquired_at=now() WHERE id=${copy.id}`;
      await sql`DELETE FROM casino_collectible_reservations WHERE offer_id=${offer.id}`;
      await sql`UPDATE casino_trade_offers SET status='accepted',settled_at=now() WHERE id=${offer.id}`;
      await recordCasinoTrade(
        sql,
        "barter",
        String(offer.id),
        String(offer.sender_id),
        userId,
        Number(offer.offered_credits),
        Number(offer.requested_credits),
        offered,
        received,
      );
      await sql`INSERT INTO notifications(user_id,actor_id,kind,title,link) VALUES(${offer.sender_id},${userId},'marketplace','Your collectible trade offer was accepted','/games/casino/play')`;
      state.lastResult = {
        game: "offer",
        operation: "accept",
        offerId: offer.id,
        status: "accepted",
      };
      return true;
    },
  );
}
export async function casinoOffersView(
  sql: Sql,
  userId: string,
  allRecords = false,
) {
  const pageLimit = allRecords ? sql`` : sql`LIMIT 100`;
  const offers =
    await sql`SELECT o.id,o.sender_id AS "senderId",o.recipient_id AS "recipientId",s.username AS "senderUsername",r.username AS "recipientUsername",o.offered_credits AS "offeredCredits",o.requested_credits AS "requestedCredits",o.requested_items AS "requestedItems",o.status,o.expires_at AS "expiresAt",o.created_at AS "createdAt",coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.collectible_id,'itemId',i.item_id,'serial',i.serial)) FROM casino_offer_items i WHERE i.offer_id=o.id),'[]'::jsonb) AS "offeredItems" FROM casino_trade_offers o JOIN users s ON s.id=o.sender_id JOIN users r ON r.id=o.recipient_id WHERE o.sender_id=${userId} OR o.recipient_id=${userId} ORDER BY o.created_at DESC ${pageLimit}`;
  const tradeHistory =
    await sql`SELECT id,kind,sender_id AS "senderId",recipient_id AS "recipientId",sender_username AS "senderUsername",recipient_username AS "recipientUsername",offered_credits AS "offeredCredits",requested_credits AS "requestedCredits",offered_items AS "offeredItems",requested_items AS "requestedItems",created_at AS "createdAt" FROM casino_trade_history WHERE sender_id=${userId} OR recipient_id=${userId} ORDER BY created_at DESC ${pageLimit}`;
  const [held] =
    await sql`SELECT coalesce(sum(offered_credits),0) AS credits FROM casino_trade_offers WHERE sender_id=${userId} AND status='pending'`;
  return {
    offers: offers.map((offer) => ({
      ...offer,
      direction: offer.senderId === userId ? "outgoing" : "incoming",
      offeredCredits: Number(offer.offeredCredits),
      requestedCredits: Number(offer.requestedCredits),
    })),
    tradeHistory,
    escrowCredits: Number(held.credits),
  };
}
export async function casinoMarketplaceExport(sql: Sql, userId: string) {
  return casinoOffersView(sql, userId, true);
}
export async function expireCasinoOffers(limit = 50, ownerId?: string) {
  return db.begin(async (sql) => {
    const batch = Number.isFinite(limit)
      ? Math.min(100, Math.max(1, Math.floor(limit)))
      : 50;
    const expired = ownerId
      ? await sql`SELECT * FROM casino_trade_offers WHERE status='pending' AND expires_at<=now() AND (sender_id=${ownerId} OR recipient_id=${ownerId}) ORDER BY sender_id,id FOR UPDATE SKIP LOCKED LIMIT ${batch}`
      : await sql`SELECT * FROM casino_trade_offers WHERE status='pending' AND expires_at<=now() ORDER BY sender_id,id FOR UPDATE SKIP LOCKED LIMIT ${batch}`;
    for (const offer of expired) await release(sql, offer, "expired");
    return expired.length;
  });
}
export async function cancelCasinoOffersForAccount(sql: Sql, userId: string) {
  const pending =
    await sql`SELECT * FROM casino_trade_offers WHERE status='pending' AND (sender_id=${userId} OR recipient_id=${userId}) ORDER BY sender_id,id FOR UPDATE`;
  for (const offer of pending) await release(sql, offer, "cancelled");
}
/** Called only after the market transaction commits. The event carries no trade data. */
export async function publishCasinoMarketUpdate(_userId: string) {
  await publishEvent({
    type: "casino:market:changed",
    payload: { refresh: true },
  });
}
