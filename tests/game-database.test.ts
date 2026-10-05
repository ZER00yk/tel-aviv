import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db, getUser } from "@tell-aviv/database";
import { handleGames } from "../packages/platform/src/games";
import type { User } from "@tell-aviv/shared";

// Explicit opt-in: these tests create isolated throwaway users in a migrated local database.
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "game transactions and authorization",
  () => {
    let a: User;
    let b: User;
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const context = (user: User) => ({
      user,
      request: new Request("http://localhost:3000/api/games"),
    });
    const action = (
      user: User,
      command: string,
      payload: Record<string, unknown> = {},
    ) =>
      handleGames(["games", "casino", "action"], "POST", context(user), {
        action: command,
        payload,
      });
    beforeAll(async () => {
      const [rowA] =
        await db`INSERT INTO users(id,username,display_name) VALUES(${randomUUID()},${`gamea_${suffix}`},'Game test A') RETURNING id`;
      const [rowB] =
        await db`INSERT INTO users(id,username,display_name) VALUES(${randomUUID()},${`gameb_${suffix}`},'Game test B') RETURNING id`;
      a = (await getUser(rowA.id))!;
      b = (await getUser(rowB.id))!;
      await Promise.all([action(a, "state"), action(b, "state")]);
    });
    afterAll(async () => {
      if (a && b) await db`DELETE FROM users WHERE id IN (${a.id},${b.id})`;
    });
    it("commits opposing transfers without deadlocks or lost funds and journals both sides", async () => {
      await Promise.all([
        action(a, "transfer", { username: b.username, amount: 75 }),
        action(b, "transfer", { username: a.username, amount: 25 }),
      ]);
      const accounts =
        await db`SELECT user_id,balance FROM currency_accounts WHERE currency='casino-credits' AND user_id IN (${a.id},${b.id})`;
      expect(
        Number(accounts.find((account) => account.user_id === a.id)!.balance),
      ).toBe(950);
      expect(
        Number(accounts.find((account) => account.user_id === b.id)!.balance),
      ).toBe(1050);
      const ledger =
        await db`SELECT sum(amount)::bigint AS amount FROM currency_ledger WHERE reason LIKE 'player transfer%' AND user_id IN (${a.id},${b.id})`;
      expect(Number(ledger[0].amount)).toBe(0);
    });
    it("rejects concurrent overspending; losing transactions leave no partial journal", async () => {
      const results = await Promise.allSettled([
        action(a, "transfer", { username: b.username, amount: 700 }),
        action(a, "transfer", { username: b.username, amount: 700 }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const [account] =
        await db`SELECT balance FROM currency_accounts WHERE user_id=${a.id} AND currency='casino-credits'`;
      expect(Number(account.balance)).toBe(250);
      const [ledger] =
        await db`SELECT count(*)::integer AS n FROM currency_ledger WHERE user_id=${a.id} AND reason='player transfer sent'`;
      expect(ledger.n).toBe(2);
    });
    it("only grants periodic rewards once when two requests race", async () => {
      const results = await Promise.allSettled([
        action(a, "reward"),
        action(a, "reward"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const [reward] =
        await db`SELECT count(*)::integer AS n FROM currency_ledger WHERE user_id=${a.id} AND reason='periodic fictional reward'`;
      expect(reward.n).toBe(1);
    });
    it("isolates namespaces, rejects stale saves, and cannot mint rewards from a casual save", async () => {
      const save = (
        user: User,
        game: string,
        revision: number,
        data: unknown,
      ) =>
        handleGames(["games", game, "save"], "POST", context(user), {
          data,
          schemaVersion: 1,
          expectedRevision: revision,
        });
      await save(a, "ego-trip", 0, {
        xp: 999999,
        balance: 999999,
        score: 100000,
      });
      await save(a, "physics-sandbox", 0, { world: [] });
      await save(b, "ego-trip", 0, { different: true });
      const results = await Promise.allSettled([
        save(a, "ego-trip", 1, { winner: 1 }),
        save(a, "ego-trip", 1, { winner: 2 }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const egoA = (await handleGames(
        ["games", "ego-trip", "save"],
        "GET",
        context(a),
        {},
      )) as { data: unknown; revision: number };
      const egoB = (await handleGames(
        ["games", "ego-trip", "save"],
        "GET",
        context(b),
        {},
      )) as { data: unknown };
      const physics = (await handleGames(
        ["games", "physics-sandbox", "save"],
        "GET",
        context(a),
        {},
      )) as { data: unknown };
      expect(egoA.revision).toBe(2);
      expect(egoB.data).toEqual({ different: true });
      expect(physics.data).toEqual({ world: [] });
      expect((await getUser(a.id))!.xp).toBe(0);
      expect(
        (
          await db`SELECT 1 FROM leaderboard_entries WHERE user_id=${a.id} AND game_id='ego-trip'`
        ).length,
      ).toBe(0);
      await expect(
        handleGames(["games", "ego-trip", "action"], "POST", context(a), {
          action: "unlock",
          payload: { achievement: "deck-clear" },
        }),
      ).rejects.toThrow("casual");
    });
  },
);
