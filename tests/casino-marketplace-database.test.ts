import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import { handleGames } from "../packages/platform/src/games";
import { expireCasinoOffers } from "../packages/platform/src/casinoMarketplace";
interface View {
  credits: number;
  escrowCredits: number;
  collectibles: {
    id: string;
    itemId: string;
    serial: number;
    reservationOfferId: string | null;
    listingId: string | null;
  }[];
  offers: { id: string; status: string; direction: string }[];
  tradeHistory: { kind: string }[];
  lastResult: { offerId: string; status: string };
}
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "casino atomic escrow and barter",
  () => {
    let users: User[] = [];
    let edition: string;
    let otherEdition: string;
    const command = async (
      user: User,
      action: string,
      payload: Record<string, unknown> = {},
    ) =>
      (await handleGames(
        ["games", "casino", "action"],
        "POST",
        {
          user,
          request: new Request("http://localhost:3000/api/games/casino/action"),
        },
        { action, payload },
      )) as { state: View };
    const create = async (
      sender: User,
      target: User,
      details: Record<string, unknown> = {},
    ) =>
      command(sender, "marketplace.offer.create", {
        operationId: randomUUID(),
        username: target.username,
        offeredCredits: 100,
        ...details,
      });
    const resolve = (
      user: User,
      action: string,
      offerId: string,
      copyIds: string[] = [],
      operationId = randomUUID(),
    ) =>
      command(user, `marketplace.offer.${action}`, {
        operationId,
        offerId,
        copyIds,
      });
    const buy = async (user: User, itemId = edition) =>
      (await command(user, "collect.buy", { itemId })).state.collectibles.find(
        (copy) => copy.itemId === itemId,
      )!;
    const balances = async () =>
      (
        await db`SELECT balance FROM currency_accounts WHERE user_id IN ${db(users.map((user) => user.id))} AND currency='casino-credits'`
      ).reduce((sum, row) => sum + Number(row.balance), 0);
    beforeEach(async () => {
      edition = `market-${randomUUID()}`;
      otherEdition = `other-${randomUUID()}`;
      await db`INSERT INTO casino_collectible_stock(item_id,supply,price) VALUES(${edition},30,1),(${otherEdition},30,1)`;
      for (let i = 0; i < 4; i++) {
        const id = randomUUID();
        await db`INSERT INTO users(id,username,display_name) VALUES(${id},${`market_${id.slice(0, 8)}`},'Marketplace fixture')`;
        users.push((await getUser(id))!);
      }
      for (const user of users) await command(user, "state");
    });
    afterEach(async () => {
      for (const user of users) await db`DELETE FROM users WHERE id=${user.id}`;
      users = [];
      await db`DELETE FROM casino_collectible_stock WHERE item_id IN (${edition},${otherEdition})`;
    });
    it("reserves and atomically exchanges both Credits and numbered copies with exactly-once acceptance", async () => {
      const [sender, recipient] = users;
      const give = await buy(sender),
        take = await buy(recipient);
      const total = await balances();
      const created = await create(sender, recipient, {
        copyIds: [give.id],
        offeredCredits: 100,
        requestedCredits: 50,
        requestedItems: [{ itemId: edition, count: 1 }],
      });
      const id = created.state.lastResult.offerId;
      expect(created.state.credits).toBe(899);
      expect(created.state.escrowCredits).toBe(100);
      expect(created.state.collectibles[0].reservationOfferId).toBe(id);
      expect((await balances()) + 100).toBe(total);
      const operationId = randomUUID();
      const accepted = await resolve(
        recipient,
        "accept",
        id,
        [take.id],
        operationId,
      );
      expect(accepted.state.credits).toBe(1049);
      expect(accepted.state.offers[0].status).toBe("accepted");
      expect(accepted.state.tradeHistory[0].kind).toBe("barter");
      expect(await balances()).toBe(total);
      expect((await command(sender, "state")).state.credits).toBe(949);
      const copies =
        await db`SELECT id,user_id FROM casino_collectibles WHERE id IN (${give.id},${take.id})`;
      expect(copies.find((copy) => copy.id === give.id)?.user_id).toBe(
        recipient.id,
      );
      expect(copies.find((copy) => copy.id === take.id)?.user_id).toBe(
        sender.id,
      );
      await resolve(recipient, "accept", id, [take.id], operationId);
      expect(await balances()).toBe(total);
      const ledger =
        await db`SELECT amount FROM currency_ledger WHERE reference_id=${id}`;
      expect(ledger).toHaveLength(4);
      expect(ledger.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(0);
      expect(
        (await db`SELECT 1 FROM casino_trade_history WHERE reference_id=${id}`)
          .length,
      ).toBe(1);
    });
    it("serializes simultaneous acceptance and cancellation without duplicate Credits", async () => {
      const [sender, recipient] = users;
      const created = await create(sender, recipient, { offeredCredits: 200 });
      const id = created.state.lastResult.offerId;
      const attempts = await Promise.allSettled([
        resolve(recipient, "accept", id),
        resolve(sender, "cancel", id),
      ]);
      expect(
        attempts.filter((attempt) => attempt.status === "fulfilled"),
      ).toHaveLength(1);
      expect(await balances()).toBe(4000);
      const [offer] =
        await db`SELECT status FROM casino_trade_offers WHERE id=${id}`;
      expect(["accepted", "cancelled"]).toContain(offer.status);
      const ledger =
        await db`SELECT amount FROM currency_ledger WHERE reference_id=${id}`;
      expect(ledger.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(0);
    });
    it("deduplicates concurrent creates and rejects operation-ID reuse with changed terms", async () => {
      const [sender, recipient] = users;
      const operationId = randomUUID();
      const payload = {
        operationId,
        username: recipient.username,
        offeredCredits: 150,
      };
      const results = await Promise.all([
        command(sender, "marketplace.offer.create", payload),
        command(sender, "marketplace.offer.create", payload),
      ]);
      expect(results[0].state.lastResult.offerId).toBe(
        results[1].state.lastResult.offerId,
      );
      expect((await command(sender, "state")).state.credits).toBe(850);
      expect(
        (
          await db`SELECT 1 FROM casino_trade_offers WHERE sender_id=${sender.id}`
        ).length,
      ).toBe(1);
      await expect(
        command(sender, "marketplace.offer.create", {
          ...payload,
          offeredCredits: 500,
        }),
      ).rejects.toThrow("Operation ID");
      expect((await command(sender, "state")).state.credits).toBe(850);
      await expect(
        create(sender, recipient, { status: "accepted" }),
      ).rejects.toThrow();
    });
    it("enforces participant roles and item ownership without exposing unrelated offers", async () => {
      const [sender, recipient, outsider] = users;
      const copy = await buy(outsider);
      await expect(
        create(sender, recipient, { copyIds: [copy.id] }),
      ).rejects.toThrow("owned");
      const created = await create(sender, recipient);
      const id = created.state.lastResult.offerId;
      await expect(resolve(outsider, "accept", id)).rejects.toThrow(
        "not found",
      );
      await expect(resolve(sender, "accept", id)).rejects.toThrow("recipient");
      await expect(resolve(recipient, "cancel", id)).rejects.toThrow("sender");
      expect((await command(outsider, "state")).state.offers).toHaveLength(0);
      expect(
        (await command(recipient, "state")).state.offers[0].direction,
      ).toBe("incoming");
    });
    it("locks reserved copies against listing and gifting, then releases them on rejection", async () => {
      const [sender, recipient] = users;
      const copy = await buy(sender);
      const created = await create(sender, recipient, {
        copyIds: [copy.id],
        offeredCredits: 0,
      });
      const id = created.state.lastResult.offerId;
      await expect(
        command(sender, "marketplace.list", { copyId: copy.id, price: 50 }),
      ).rejects.toThrow("pending offer");
      await expect(
        command(sender, "collect.transfer", {
          copyId: copy.id,
          username: recipient.username,
        }),
      ).rejects.toThrow("pending offer");
      await resolve(recipient, "reject", id);
      await command(sender, "collect.transfer", {
        copyId: copy.id,
        username: recipient.username,
        operationId: randomUUID(),
      });
      expect(
        (await command(recipient, "state")).state.tradeHistory[0].kind,
      ).toBe("gift");
    });
    it("rolls back mismatched, unowned and unaffordable incoming settlements", async () => {
      const [sender, recipient, outsider] = users;
      const wrong = await buy(recipient, otherEdition),
        unowned = await buy(outsider),
        give = await buy(sender);
      const total = await balances();
      const created = await create(sender, recipient, {
        copyIds: [give.id],
        offeredCredits: 100,
        requestedCredits: 1001,
        requestedItems: [{ itemId: edition, count: 1 }],
      });
      const id = created.state.lastResult.offerId;
      await expect(
        resolve(recipient, "accept", id, [wrong.id]),
      ).rejects.toThrow("match");
      await expect(
        resolve(recipient, "accept", id, [unowned.id]),
      ).rejects.toThrow("ownership");
      const actual = await buy(recipient);
      await expect(
        resolve(recipient, "accept", id, [actual.id]),
      ).rejects.toThrow("Not enough");
      const [offer] =
        await db`SELECT status FROM casino_trade_offers WHERE id=${id}`;
      expect(offer.status).toBe("pending");
      expect((await balances()) + 100).toBe(total - 1);
      expect(
        (
          await db`SELECT 1 FROM casino_collectible_reservations WHERE offer_id=${id}`
        ).length,
      ).toBe(1);
    });
    it("checks new blocks at acceptance while allowing safe rejection and refunds", async () => {
      const [sender, recipient] = users;
      const created = await create(sender, recipient);
      const id = created.state.lastResult.offerId;
      await db`INSERT INTO user_blocks(user_id,blocked_id) VALUES(${recipient.id},${sender.id})`;
      await expect(resolve(recipient, "accept", id)).rejects.toThrow(
        "unavailable",
      );
      await resolve(recipient, "reject", id);
      expect((await command(sender, "state")).state.credits).toBe(1000);
      expect(await balances()).toBe(4000);
    });
    it("expires owned offers once under racing maintenance workers and releases escrow", async () => {
      const [sender, recipient] = users;
      const copy = await buy(sender);
      const created = await create(sender, recipient, {
        copyIds: [copy.id],
        offeredCredits: 250,
      });
      const id = created.state.lastResult.offerId;
      await db`UPDATE casino_trade_offers SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=${id}`;
      const counts = await Promise.all([
        expireCasinoOffers(50, sender.id),
        expireCasinoOffers(50, sender.id),
      ]);
      expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
      expect((await command(sender, "state")).state.credits).toBe(999);
      expect(
        (
          await db`SELECT 1 FROM casino_collectible_reservations WHERE offer_id=${id}`
        ).length,
      ).toBe(0);
      const ledger =
        await db`SELECT amount FROM currency_ledger WHERE reference_id=${id}`;
      expect(ledger).toHaveLength(2);
      expect(ledger.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(0);
    });
    it("account deletion refunds another sender's escrow through the defensive database trigger", async () => {
      const [sender, recipient] = users;
      await create(sender, recipient, { offeredCredits: 450 });
      expect((await command(sender, "state")).state.credits).toBe(550);
      await db`DELETE FROM users WHERE id=${recipient.id}`;
      expect((await command(sender, "state")).state.credits).toBe(1000);
      expect(
        (
          await db`SELECT 1 FROM casino_trade_offers WHERE sender_id=${sender.id}`
        ).length,
      ).toBe(0);
    });
    it("gift retries and sold listing retries are idempotent when the client supplies an operation ID", async () => {
      const [sender, recipient] = users;
      const copy = await buy(sender);
      const operationId = randomUUID();
      const payload = {
        copyId: copy.id,
        username: recipient.username,
        operationId,
      };
      await command(sender, "collect.transfer", payload);
      await command(sender, "collect.transfer", payload);
      expect(
        (await command(recipient, "state")).state.collectibles,
      ).toHaveLength(1);
      expect(
        (await command(recipient, "state")).state.tradeHistory,
      ).toHaveLength(1);
      const listing = await command(recipient, "marketplace.list", {
        copyId: copy.id,
        price: 30,
        operationId: randomUUID(),
      });
      const listingId = listing.state.collectibles[0].listingId;
      const buyPayload = { listingId, operationId: randomUUID() };
      await command(sender, "marketplace.buy", buyPayload);
      await command(sender, "marketplace.buy", buyPayload);
      expect((await command(sender, "state")).state.collectibles).toHaveLength(
        1,
      );
      expect(
        (
          await db`SELECT 1 FROM casino_trade_history WHERE kind='marketplace' AND reference_id=${String(listingId)}`
        ).length,
      ).toBe(1);
    });
  },
);
