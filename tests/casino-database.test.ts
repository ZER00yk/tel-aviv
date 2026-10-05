import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import { handleGames } from "../packages/platform/src/games";

interface EconomyState {
  credits: number;
  loan: { principal: number; interest: number; total: number };
  collectibles: {
    id: string;
    itemId: string;
    serial: number;
    listingId: string | null;
  }[];
}

// Only opt-in against an already migrated local database; all records belong to test fixtures.
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "casino loans and collectible settlement",
  () => {
    let users: User[] = [];
    let stockId: string;
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
      )) as { state: EconomyState };

    beforeEach(async () => {
      stockId = `fixture-${randomUUID()}`;
      await db`INSERT INTO casino_collectible_stock(item_id,supply,price) VALUES(${stockId},1,200)`;
      for (let index = 0; index < 3; index++) {
        const id = randomUUID();
        await db`INSERT INTO users(id,username,display_name) VALUES(${id},${`casino_${id.slice(0, 8)}`},'Casino fixture')`;
        users.push((await getUser(id))!);
      }
      await Promise.all(users.map((user) => command(user, "state")));
    });
    afterEach(async () => {
      for (const user of users) await db`DELETE FROM users WHERE id=${user.id}`;
      users = [];
      if (stockId)
        await db`DELETE FROM casino_collectible_stock WHERE item_id=${stockId}`;
    });

    it("serializes loan requests, computes repayment interest on the server, and enforces cooldown after repayment", async () => {
      const user = users[0];
      const loans = await Promise.allSettled([
        command(user, "loans.borrow", { amount: 500 }),
        command(user, "loans.borrow", { amount: 500 }),
      ]);
      expect(
        loans.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect((await command(user, "state")).state.credits).toBe(1500);
      await db`UPDATE casino_loans SET borrowed_at=now()-interval '3 days' WHERE user_id=${user.id}`;
      const repaid = await command(user, "loans.repay", {
        amount: 0,
        interest: 0,
      });
      expect(repaid.state.credits).toBe(985);
      expect(repaid.state.loan.principal).toBe(0);
      await expect(
        command(user, "loans.borrow", { amount: 500 }),
      ).rejects.toThrow("server day");
      const ledger =
        await db`SELECT amount FROM currency_ledger WHERE user_id=${user.id} AND reason='fictional loan repayment and interest'`;
      expect(ledger).toHaveLength(1);
      expect(Number(ledger[0].amount)).toBe(-515);
    });

    it("issues a finite edition once under a race and leaves the unsuccessful buyer untouched", async () => {
      const results = await Promise.allSettled(
        users.slice(0, 2).map((user) =>
          command(user, "collect.buy", {
            itemId: stockId,
            price: 0,
            serial: 500,
          }),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const copies =
        await db`SELECT * FROM casino_collectibles WHERE item_id=${stockId}`;
      expect(copies).toHaveLength(1);
      expect(copies[0].serial).toBe(1);
      const [stock] =
        await db`SELECT issued FROM casino_collectible_stock WHERE item_id=${stockId}`;
      expect(stock.issued).toBe(1);
      const balances =
        await db`SELECT balance FROM currency_accounts WHERE user_id IN (${users[0].id},${users[1].id}) AND currency='casino-credits'`;
      expect(
        balances.map((row) => Number(row.balance)).sort((a, b) => a - b),
      ).toEqual([800, 1000]);
    });

    it("settles only one racing buyer, conserving Credits and transferring the numbered copy", async () => {
      const [seller, buyer, rival] = users;
      const purchased = await command(seller, "collect.buy", {
        itemId: stockId,
      });
      const copyId = purchased.state.collectibles[0].id;
      const listed = await command(seller, "marketplace.list", {
        copyId,
        price: 350,
      });
      const listingId = listed.state.collectibles[0].listingId!;
      await expect(
        command(buyer, "marketplace.cancel", { listingId }),
      ).rejects.toThrow("seller");
      await expect(
        command(seller, "collect.transfer", {
          copyId,
          username: buyer.username,
        }),
      ).rejects.toThrow("Cancel");
      const results = await Promise.allSettled([
        command(buyer, "marketplace.buy", { listingId, price: 0 }),
        command(rival, "marketplace.buy", { listingId }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const [copy] =
        await db`SELECT user_id FROM casino_collectibles WHERE id=${copyId}`;
      expect([buyer.id, rival.id]).toContain(copy.user_id);
      const [listing] =
        await db`SELECT status,buyer_id FROM casino_marketplace WHERE id=${listingId}`;
      expect(listing.status).toBe("sold");
      expect(listing.buyer_id).toBe(copy.user_id);
      const balances =
        await db`SELECT user_id,balance FROM currency_accounts WHERE user_id IN (${seller.id},${buyer.id},${rival.id}) AND currency='casino-credits'`;
      expect(balances.reduce((sum, row) => sum + Number(row.balance), 0)).toBe(
        2800,
      );
      expect(
        Number(balances.find((row) => row.user_id === seller.id)!.balance),
      ).toBe(1150);
      const ledger =
        await db`SELECT amount FROM currency_ledger WHERE reference_id=${listingId}`;
      expect(ledger).toHaveLength(2);
      expect(ledger.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(0);
    });

    it("checks ownership and blocking for direct gifts and marketplace purchases", async () => {
      const [seller, buyer] = users;
      const purchased = await command(seller, "collect.buy", {
        itemId: stockId,
      });
      const copyId = purchased.state.collectibles[0].id;
      await expect(
        command(buyer, "collect.transfer", {
          copyId,
          username: seller.username,
        }),
      ).rejects.toThrow("Owned");
      await db`INSERT INTO user_blocks(user_id,blocked_id) VALUES(${buyer.id},${seller.id})`;
      await expect(
        command(seller, "collect.transfer", {
          copyId,
          username: buyer.username,
        }),
      ).rejects.toThrow("unavailable");
      const listed = await command(seller, "marketplace.list", {
        copyId,
        price: 350,
      });
      await expect(
        command(buyer, "marketplace.buy", {
          listingId: listed.state.collectibles[0].listingId,
        }),
      ).rejects.toThrow("unavailable");
      expect((await command(buyer, "state")).state.credits).toBe(1000);
      const [copy] =
        await db`SELECT user_id FROM casino_collectibles WHERE id=${copyId}`;
      expect(copy.user_id).toBe(seller.id);
      await command(seller, "marketplace.cancel", {
        listingId: listed.state.collectibles[0].listingId,
      });
      await db`DELETE FROM user_blocks WHERE user_id=${buyer.id} AND blocked_id=${seller.id}`;
      const gifted = await command(seller, "collect.transfer", {
        copyId,
        username: buyer.username,
      });
      expect(gifted.state.collectibles).toHaveLength(0);
      const received = (await command(buyer, "state")).state.collectibles;
      expect(received).toMatchObject([
        { id: copyId, itemId: stockId, serial: 1 },
      ]);
    });

    it("rolls back an unaffordable market purchase without changing ownership, listing, or ledger", async () => {
      const [seller, buyer] = users;
      const purchased = await command(seller, "collect.buy", {
        itemId: stockId,
      });
      const copyId = purchased.state.collectibles[0].id;
      const listed = await command(seller, "marketplace.list", {
        copyId,
        price: 1001,
      });
      const listingId = listed.state.collectibles[0].listingId!;
      await expect(
        command(buyer, "marketplace.buy", { listingId }),
      ).rejects.toThrow("Not enough");
      const [copy] =
        await db`SELECT user_id FROM casino_collectibles WHERE id=${copyId}`;
      const [listing] =
        await db`SELECT status,buyer_id FROM casino_marketplace WHERE id=${listingId}`;
      expect(copy.user_id).toBe(seller.id);
      expect(listing.status).toBe("active");
      expect(listing.buyer_id).toBeNull();
      expect(
        (
          await db`SELECT 1 FROM currency_ledger WHERE reference_id=${listingId}`
        ).length,
      ).toBe(0);
      expect((await command(buyer, "state")).state.credits).toBe(1000);
      expect((await command(seller, "state")).state.credits).toBe(800);
    });
  },
);
