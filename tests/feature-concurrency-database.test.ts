import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import { createPersistentPokerHand } from "../games/casino/multiplayer-poker";
import { newIncremental } from "../games/server/incremental";
import {
  cancelPersistentPokerForAccount,
  syncPersistentPoker,
} from "../packages/platform/src/casinoPokerTables";
import { handleAdminSeasons } from "../packages/platform/src/seasons";
import { handleGames } from "../packages/platform/src/games";

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function waitUntil(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 4000;
  while (!(await predicate())) {
    if (Date.now() >= deadline)
      throw new Error("The scoped PostgreSQL lock barrier was not reached");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function errorCode(result: PromiseSettledResult<unknown>) {
  return result.status === "rejected"
    ? (result.reason as { code?: string }).code
    : undefined;
}

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "feature lifecycle SQL lock ordering",
  () => {
    const users: string[] = [],
      tables: string[] = [],
      seasons: string[] = [];
    async function fixture(label: string, role = "user") {
      const id = randomUUID();
      users.push(id);
      await db`INSERT INTO users(id,username,display_name,role) VALUES(${id},${`fr_${label}_${id.slice(0, 8)}`},'Concurrency fixture',${role})`;
      return id;
    }
    afterEach(async () => {
      for (const id of seasons.splice(0))
        await db`DELETE FROM game_seasons WHERE id=${id}`;
      for (const id of tables.splice(0))
        await db`DELETE FROM casino_poker_tables WHERE id=${id}`;
      for (const id of users.splice(0))
        await db`DELETE FROM users WHERE id=${id}`;
    });

    it("serializes persistent hand start behind account cancellation without a user/table deadlock or duplicate refund", async () => {
      const first = await fixture("first"),
        second = await fixture("second"),
        tableId = randomUUID(),
        namespace = `feature-review-${randomUUID()}`,
        code = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
      tables.push(tableId);
      await db`INSERT INTO casino_poker_tables(id,namespace,lobby_code,minimum_buy_in,maximum_buy_in) VALUES(${tableId},${namespace},${code},100,1000)`;
      for (const id of [first, second]) {
        await db`INSERT INTO currency_accounts(user_id,currency,balance) VALUES(${id},'casino-credits',900)`;
        await db`INSERT INTO casino_poker_table_seats(table_id,user_id,username,stack,buy_in_total) VALUES(${tableId},${id},'fixture',100,100)`;
      }
      const pokerTable = {
          id: tableId,
          minBuyIn: 100,
          maxBuyIn: 1000,
          handNumber: 0,
          seats: [first, second].map((userId) => ({
            userId,
            stack: 100,
            sittingOut: false,
            pendingLeave: false,
          })),
        },
        state = createPersistentPokerHand(
          [first, second].map((userId) => ({ userId, stack: 100 })),
          {
            id: tableId,
            handNumber: 1,
            minBuyIn: 100,
            maxBuyIn: 1000,
            smallBlind: 5,
            bigBlind: 10,
            sittingOut: [],
            pendingLeave: [],
          },
        );
      const userHeld = barrier(),
        cancelNow = barrier();
      let deletingPid = 0,
        startingPid = 0;
      const deletion = db.begin(async (sql) => {
        await sql`SET LOCAL lock_timeout='8s'`;
        await sql`SET LOCAL statement_timeout='10s'`;
        const [backend] = await sql`SELECT pg_backend_pid() AS pid`;
        deletingPid = backend.pid;
        // This is the first lock and exact poker cancellation sequence used by
        // deleteAccount. No artificial table lock imposes the previous ordering.
        await sql`SELECT id FROM users WHERE id=${first} FOR UPDATE`;
        userHeld.release();
        await cancelNow.promise;
        await cancelPersistentPokerForAccount(sql, first);
        await sql`DELETE FROM users WHERE id=${first}`;
      });
      const starting = db.begin(async (sql) => {
        await sql`SET LOCAL lock_timeout='8s'`;
        await sql`SET LOCAL statement_timeout='10s'`;
        const [backend] = await sql`SELECT pg_backend_pid() AS pid`;
        startingPid = backend.pid;
        await userHeld.promise;
        return syncPersistentPoker(
          sql,
          {
            code,
            matchId: randomUUID(),
            visibility: "private",
            status: "playing",
            players: [first, second].map((id) => ({
              id,
              username: "fixture",
            })),
            state,
            pokerTable,
          },
          namespace,
        );
      });
      const settled = Promise.allSettled([deletion, starting]);
      try {
        await waitUntil(async () => {
          if (!deletingPid || !startingPid) return false;
          const [row] =
            await db`SELECT ${deletingPid}=ANY(pg_blocking_pids(${startingPid})) AS blocked`;
          return row.blocked;
        });
      } finally {
        userHeld.release();
        cancelNow.release();
        await settled;
      }
      const results = await settled;
      expect(results.map(errorCode)).not.toContain("40P01");
      expect(results[0].status).toBe("fulfilled");
      if (results[1].status === "rejected")
        expect(results[1].reason).toMatchObject({ status: 403 });
      const [table] =
        await db`SELECT status FROM casino_poker_tables WHERE id=${tableId}`;
      const [wallet] =
        await db`SELECT balance FROM currency_accounts WHERE user_id=${second} AND currency='casino-credits'`;
      expect(table.status).toBe("closed");
      expect(Number(wallet.balance)).toBe(1000);
      expect(
        await db`SELECT 1 FROM casino_poker_table_seats WHERE table_id=${tableId} AND status='active'`,
      ).toHaveLength(0);
      expect(
        await db`SELECT 1 FROM casino_poker_table_hands WHERE table_id=${tableId} AND status='active'`,
      ).toHaveLength(0);
      expect(
        await db`SELECT 1 FROM currency_ledger WHERE user_id=${second} AND reference_id=${tableId} AND reason='persistent poker abort refund'`,
      ).toHaveLength(1);
    }, 15000);

    it("starts a cumulative season after in-flight settlement commits and excludes its unchanged raw score", async () => {
      const ownerId = await fixture("owner", "owner"),
        progressId = await fixture("progress"),
        owner = (await getUser(ownerId))!,
        progressUser = (await getUser(progressId))!,
        slug = `review-${randomUUID().slice(0, 8)}`;
      const initial = { ...newIncremental(Date.now()), prestige: 12 };
      await db`INSERT INTO game_states(user_id,game_id,data) VALUES(${progressId},'incremental',${db.json(initial)})`;
      const gainHeld = barrier(),
        actionBlocked = barrier(),
        commitGain = barrier();
      let gainPid = 0,
        actionPid = 0,
        startFinished = false;
      const gain = db.begin(async (sql) => {
        await sql`SET LOCAL lock_timeout='8s'`;
        await sql`SET LOCAL statement_timeout='10s'`;
        const [backend] = await sql`SELECT pg_backend_pid() AS pid`;
        gainPid = backend.pid;
        await sql`SELECT user_id FROM game_states WHERE user_id=${progressId} AND game_id='incremental' FOR UPDATE`;
        gainHeld.release();
        await commitGain.promise;
        await sql`UPDATE game_states SET data=${sql.json({ ...initial, prestige: 17 })} WHERE user_id=${progressId} AND game_id='incremental'`;
        const [clock] = await sql`SELECT clock_timestamp() AS now`;
        return clock.now as Date;
      });
      const playState = () =>
        handleGames(
          ["games", "incremental", "action"],
          "POST",
          {
            user: progressUser,
            request: new Request(
              "http://localhost:3000/api/games/incremental/action",
            ),
          },
          { action: "state" },
        ) as Promise<{ state: { prestige: number } }>;
      const playing = (async () => {
        await gainHeld.promise;
        return playState();
      })();
      const starting = (async () => {
        await actionBlocked.promise;
        const result = (await handleAdminSeasons(
          ["admin", "seasons", "start"],
          "POST",
          {
            user: owner,
            request: new Request(
              "http://localhost:3000/api/admin/seasons/start",
            ),
          },
          {
            slug,
            title: "Scoped race fixture",
            endsAt: new Date(Date.now() + 3600000).toISOString(),
            modes: [{ gameId: "incremental", category: "default" }],
            rewards: [100, 50, 25],
            operationId: randomUUID(),
            reason: "Scoped baseline regression",
            confirmation: `START SEASON ${slug}`,
          },
        )) as { seasonId: string };
        seasons.push(result.seasonId);
        startFinished = true;
        return result;
      })();
      const settled = Promise.allSettled([gain, playing, starting]);
      try {
        // The real action wrapper has entered before state access, but cannot
        // read this fixture's row yet. No test-owned producer advisory lock
        // hides a missing barrier in the actual API implementation.
        await waitUntil(async () => {
          if (!gainPid) return false;
          const [row] =
            await db`SELECT pid FROM pg_stat_activity WHERE ${gainPid}=ANY(pg_blocking_pids(pid)) AND query LIKE '%game_states%'`;
          actionPid = Number(row?.pid ?? 0);
          return actionPid !== 0;
        });
        actionBlocked.release();
        await waitUntil(async () => {
          if (startFinished)
            throw new Error(
              "Season started before the already running game action committed",
            );
          const [row] =
            await db`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${actionPid}=ANY(pg_blocking_pids(pid))) AS blocked`;
          return row.blocked;
        });
        expect(startFinished).toBe(false);
      } finally {
        gainHeld.release();
        actionBlocked.release();
        commitGain.release();
        await settled;
      }
      const results = await settled;
      expect(results.map(errorCode)).not.toContain("40P01");
      expect(results.every((result) => result.status === "fulfilled")).toBe(
        true,
      );
      const beforeCommit = await gain,
        { seasonId } = await starting;
      expect((await playing).state.prestige).toBe(17);
      expect((await playState()).state.prestige).toBe(17);
      const [baseline] =
        await db`SELECT b.baseline,s.starts_at FROM game_season_baselines b JOIN game_seasons s ON s.id=b.season_id WHERE b.season_id=${seasonId} AND b.user_id=${progressId}`;
      expect(Number(baseline.baseline)).toBe(17);
      expect(baseline.starts_at.getTime()).toBeGreaterThanOrEqual(
        beforeCommit.getTime(),
      );
      expect(
        await db`SELECT 1 FROM game_season_entries WHERE season_id=${seasonId} AND user_id=${progressId}`,
      ).toHaveLength(0);
    }, 15000);
  },
);
