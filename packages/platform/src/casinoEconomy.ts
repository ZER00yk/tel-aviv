import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { z } from "zod";
import { fail } from "@tell-aviv/shared";
import type { CasinoState } from "../../../games/server/casino";
import { casinoPokerHistory } from "./casinoPoker";
import {
  casinoMarketplaceAction,
  casinoOffersView,
  assertCollectibleAvailable,
  idempotentCasinoOperation,
  recordCasinoTrade,
} from "./casinoMarketplace";

type Sql = TransactionSql;
type EnsureAccount = (
  sql: Sql,
  userId: string,
  currency: string,
) => Promise<void>;
type ChangeBalance = (
  sql: Sql,
  userId: string,
  currency: string,
  amount: number,
  reason: string,
  reference: string,
) => Promise<void>;
function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success)
    fail(400, result.error.issues.map((issue) => issue.message).join("; "));
  return result.data;
}
export const COLLECTIBLE_DEFS = [
  {
    id: "velvet-joker",
    name: "Velvet Joker",
    icon: "🃏",
    description: "A numbered card from the original velvet deck.",
  },
  {
    id: "moon-chip",
    name: "Moon Chip",
    icon: "🌙",
    description:
      "A moonlit keepsake. Collectible only, with no gameplay advantage.",
  },
  {
    id: "glass-die",
    name: "Glass Die",
    icon: "🎲",
    description: "A rare etched glass die with a unique edition number.",
  },
];
export function loanDebt(
  principal: number,
  borrowedAt?: Date | string | null,
  now = Date.now(),
) {
  const ageDays = borrowedAt
    ? Math.max(0, (now - new Date(borrowedAt).getTime()) / 86400000)
    : 0;
  const interest = principal
    ? Math.min(principal, Math.floor(principal * ageDays * 0.01))
    : 0;
  return { principal, interest, total: principal + interest };
}
async function recipient(sql: Sql, userId: string, username: string) {
  const [user] =
    await sql`SELECT id FROM users WHERE lower(username)=lower(${username}) AND disabled=false`;
  if (!user || user.id === userId) fail(400, "Choose another active player");
  const blocked =
    await sql`SELECT 1 FROM user_blocks WHERE (user_id=${userId} AND blocked_id=${user.id}) OR (user_id=${user.id} AND blocked_id=${userId})`;
  if (blocked.length) fail(403, "Trade unavailable");
  return String(user.id);
}
export async function casinoEconomyAction(
  sql: Sql,
  userId: string,
  state: CasinoState,
  action: string,
  payload: Record<string, unknown>,
  ensure: EnsureAccount,
  change: ChangeBalance,
): Promise<boolean> {
  if (
    [
      "collect.transfer",
      "marketplace.list",
      "marketplace.buy",
      "marketplace.cancel",
    ].includes(action) &&
    payload.operationId !== undefined
  ) {
    const { operationId: _operationId, ...details } = payload;
    return idempotentCasinoOperation(sql, userId, state, action, payload, () =>
      casinoEconomyAction(sql, userId, state, action, details, ensure, change),
    );
  }
  if (
    await casinoMarketplaceAction(
      sql,
      userId,
      state,
      action,
      payload,
      ensure,
      change,
    )
  )
    return true;
  const reference = randomUUID();
  if (action === "loans.borrow" || action === "loans.repay") {
    await sql`INSERT INTO casino_loans(user_id) VALUES(${userId}) ON CONFLICT DO NOTHING`;
    const [loan] =
      await sql`SELECT * FROM casino_loans WHERE user_id=${userId} FOR UPDATE`;
    if (action === "loans.borrow") {
      const { amount } = parse(
        z.object({ amount: z.number().int().min(100).max(1000) }),
        payload,
      );
      if (Number(loan.principal) > 0)
        fail(409, "Repay your current fictional loan first");
      if (
        loan.last_borrowed_at &&
        Date.now() - new Date(loan.last_borrowed_at).getTime() < 86400000
      )
        fail(429, "One fictional loan is available per server day");
      await change(
        sql,
        userId,
        "casino-credits",
        amount,
        "fictional loan disbursement",
        reference,
      );
      await sql`UPDATE casino_loans SET principal=${amount},borrowed_at=now(),last_borrowed_at=now() WHERE user_id=${userId}`;
      state.lastResult = { game: "loan", operation: "borrow", amount };
    } else {
      const debt = loanDebt(Number(loan.principal), loan.borrowed_at);
      if (!debt.principal) fail(400, "There is no fictional debt to repay");
      await change(
        sql,
        userId,
        "casino-credits",
        -debt.total,
        "fictional loan repayment and interest",
        reference,
      );
      await sql`UPDATE casino_loans SET principal=0,borrowed_at=NULL WHERE user_id=${userId}`;
      state.lastResult = {
        game: "loan",
        operation: "repay",
        amount: debt.total,
        interest: debt.interest,
      };
    }
    return true;
  }
  if (action === "collect.buy") {
    const { itemId } = parse(z.object({ itemId: z.string().max(60) }), payload);
    const [stock] =
      await sql`SELECT * FROM casino_collectible_stock WHERE item_id=${itemId} FOR UPDATE`;
    if (!stock) fail(404, "Collectible not found");
    if (stock.issued >= stock.supply) fail(409, "This edition has sold out");
    await change(
      sql,
      userId,
      "casino-credits",
      -Number(stock.price),
      "collectible issuance",
      reference,
    );
    const serial = Number(stock.issued) + 1;
    await sql`UPDATE casino_collectible_stock SET issued=${serial} WHERE item_id=${itemId}`;
    const [copy] =
      await sql`INSERT INTO casino_collectibles(user_id,item_id,serial) VALUES(${userId},${itemId},${serial}) RETURNING id`;
    state.lastResult = {
      game: "collectible",
      operation: "buy",
      copyId: copy.id,
      itemId,
      serial,
      price: Number(stock.price),
    };
    return true;
  }
  if (action === "collect.transfer" || action === "marketplace.list") {
    const { copyId } = parse(z.object({ copyId: z.string().uuid() }), payload);
    const [copy] =
      await sql`SELECT * FROM casino_collectibles WHERE id=${copyId} AND user_id=${userId} FOR UPDATE`;
    if (!copy) fail(404, "Owned collectible not found");
    await assertCollectibleAvailable(sql, copyId);
    if (
      (
        await sql`SELECT 1 FROM casino_marketplace WHERE collectible_id=${copyId} AND status='active'`
      ).length
    )
      fail(409, "Cancel the active listing before trading this collectible");
    if (action === "collect.transfer") {
      const { username } = parse(
        z.object({ username: z.string().min(3).max(24) }),
        payload,
      );
      const target = await recipient(sql, userId, username);
      await sql`UPDATE casino_collectibles SET user_id=${target},acquired_at=now() WHERE id=${copyId}`;
      await recordCasinoTrade(sql, "gift", reference, userId, target, 0, 0, [
        { id: copyId, itemId: copy.item_id, serial: copy.serial },
      ]);
      state.lastResult = {
        game: "collectible",
        operation: "transfer",
        copyId,
        username,
      };
    } else {
      const { price } = parse(
        z.object({ price: z.number().int().min(1).max(100000) }),
        payload,
      );
      const [listing] =
        await sql`INSERT INTO casino_marketplace(collectible_id,seller_id,price) VALUES(${copyId},${userId},${price}) RETURNING id`;
      state.lastResult = {
        game: "marketplace",
        operation: "list",
        listingId: listing.id,
        copyId,
        price,
      };
    }
    return true;
  }
  if (action === "marketplace.buy" || action === "marketplace.cancel") {
    const { listingId } = parse(
      z.object({ listingId: z.string().uuid() }),
      payload,
    );
    const [listing] =
      await sql`SELECT * FROM casino_marketplace WHERE id=${listingId} AND status='active' FOR UPDATE`;
    if (!listing) fail(404, "Active listing not found");
    if (action === "marketplace.cancel") {
      if (listing.seller_id !== userId)
        fail(403, "Only the seller can cancel this listing");
      await sql`UPDATE casino_marketplace SET status='cancelled',settled_at=now() WHERE id=${listingId}`;
      state.lastResult = {
        game: "marketplace",
        operation: "cancel",
        listingId,
      };
    } else {
      if (listing.seller_id === userId)
        fail(400, "You already own this collectible");
      const blocked =
        await sql`SELECT 1 FROM user_blocks WHERE (user_id=${userId} AND blocked_id=${listing.seller_id}) OR (user_id=${listing.seller_id} AND blocked_id=${userId})`;
      if (blocked.length) fail(403, "Trade unavailable");
      const [copy] =
        await sql`SELECT * FROM casino_collectibles WHERE id=${listing.collectible_id} FOR UPDATE`;
      if (!copy || copy.user_id !== listing.seller_id)
        fail(409, "Collectible ownership changed; listing cannot settle");
      await assertCollectibleAvailable(sql, String(copy.id));
      await ensure(sql, listing.seller_id, "casino-credits");
      await sql`SELECT user_id FROM currency_accounts WHERE currency='casino-credits' AND user_id IN (${userId},${listing.seller_id}) ORDER BY user_id FOR UPDATE`;
      await change(
        sql,
        userId,
        "casino-credits",
        -Number(listing.price),
        "marketplace purchase",
        listingId,
      );
      await change(
        sql,
        listing.seller_id,
        "casino-credits",
        Number(listing.price),
        "marketplace sale",
        listingId,
      );
      await sql`UPDATE casino_collectibles SET user_id=${userId},acquired_at=now() WHERE id=${listing.collectible_id}`;
      await sql`UPDATE casino_marketplace SET status='sold',buyer_id=${userId},settled_at=now() WHERE id=${listingId}`;
      await recordCasinoTrade(
        sql,
        "marketplace",
        listingId,
        String(listing.seller_id),
        userId,
        0,
        Number(listing.price),
        [{ id: copy.id, itemId: copy.item_id, serial: copy.serial }],
      );
      state.lastResult = {
        game: "marketplace",
        operation: "buy",
        listingId,
        copyId: listing.collectible_id,
        price: Number(listing.price),
      };
    }
    return true;
  }
  return false;
}
export async function casinoEconomyView(sql: Sql, userId: string) {
  const [loan] =
    await sql`SELECT principal,borrowed_at,last_borrowed_at FROM casino_loans WHERE user_id=${userId}`;
  const stock =
    await sql`SELECT item_id AS "itemId",price,supply,issued FROM casino_collectible_stock ORDER BY price`;
  const collectibles =
    await sql`SELECT c.id,c.item_id AS "itemId",c.serial,c.acquired_at AS "acquiredAt",m.id AS "listingId",m.price,r.offer_id AS "reservationOfferId" FROM casino_collectibles c LEFT JOIN casino_marketplace m ON m.collectible_id=c.id AND m.status='active' LEFT JOIN casino_collectible_reservations r ON r.collectible_id=c.id WHERE c.user_id=${userId} ORDER BY c.acquired_at DESC LIMIT 100`;
  const marketplace =
    await sql`SELECT m.id,m.price,m.seller_id AS "sellerId",u.username AS "sellerUsername",c.item_id AS "itemId",c.serial,m.created_at AS "createdAt" FROM casino_marketplace m JOIN casino_collectibles c ON c.id=m.collectible_id JOIN users u ON u.id=m.seller_id WHERE m.status='active' AND u.disabled=false AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=${userId} AND b.blocked_id=u.id) OR (b.user_id=u.id AND b.blocked_id=${userId})) ORDER BY m.created_at DESC LIMIT 50`;
  return {
    loan: {
      ...loanDebt(Number(loan?.principal ?? 0), loan?.borrowed_at),
      nextBorrowAt: loan?.last_borrowed_at
        ? new Date(
            new Date(loan.last_borrowed_at).getTime() + 86400000,
          ).toISOString()
        : null,
    },
    collectibleShop: stock.map((item) => ({
      ...item,
      ...COLLECTIBLE_DEFS.find((def) => def.id === item.itemId),
    })),
    collectibles,
    marketplace,
    ...(await casinoOffersView(sql, userId)),
    ...(await casinoPokerHistory(sql, userId)),
  };
}
