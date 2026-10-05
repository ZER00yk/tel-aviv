import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import {
  handleAdminSeasons,
  handleSeasons,
} from "../packages/platform/src/seasons";
import { recordLeaderboardScore } from "../packages/platform/src/leaderboard";

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "authoritative competition seasons",
  () => {
    const users: string[] = [],
      seasonIds: string[] = [];
    let owner: User, first: User, second: User, third: User;
    const context = (user: User) => ({
      user,
      request: new Request("http://localhost:3000/api/seasons"),
    });
    async function fixture(label: string, role: User["role"] = "user") {
      const id = randomUUID();
      users.push(id);
      await db`INSERT INTO users(id,username,display_name,role) VALUES(${id},${`sea_${label.slice(0, 10)}_${id.slice(0, 8)}`},${label},${role})`;
      return (await getUser(id))!;
    }
    const proposal = (
      modes = [{ gameId: "tower-defense", category: "crossroads" }],
    ) => ({
      slug: `fixture-${randomUUID().slice(0, 8)}`,
      title: "Isolated competition",
      endsAt: new Date(Date.now() + 3600000).toISOString(),
      modes,
      rewards: [100, 50, 25] as [number, number, number],
    });
    const admin = (
      suffix: string[],
      body: Record<string, unknown>,
      user = owner,
    ) =>
      handleAdminSeasons(
        ["admin", "seasons", ...suffix],
        "POST",
        context(user),
        body,
      );
    async function start(data = proposal()) {
      const body = {
        ...data,
        operationId: randomUUID(),
        reason: "Isolated season test",
        confirmation: `START SEASON ${data.slug}`,
      };
      const result = (await admin(["start"], body)) as { seasonId: string };
      seasonIds.push(result.seasonId);
      return { id: result.seasonId, body };
    }
    const score = (
      user: User,
      value: number,
      gameId = "tower-defense",
      category = "crossroads",
      detail: Record<string, unknown> = {
        runId: randomUUID(),
        runStartedAt: Date.now(),
      },
    ) =>
      db.begin((sql) =>
        recordLeaderboardScore(sql, user.id, gameId, category, value, detail),
      );
    const entries = (id: string, user = first) =>
      db`SELECT * FROM game_season_entries WHERE season_id=${id} AND user_id=${user.id}`;
    const detail = (id: string, user = first) =>
      handleSeasons(["seasons", id], "GET", context(user), {}) as Promise<{
        season: { state: string };
        standings: {
          username: string | null;
          score: number;
          rank: number;
          reward: number;
        }[];
        unclaimedCoins: number;
      }>;
    const closeBody = (season: Awaited<ReturnType<typeof start>>) => ({
      operationId: randomUUID(),
      reason: "Isolated close fixture",
      confirmation: `CLOSE SEASON ${season.body.slug}`,
    });
    const claim = (id: string, user = first) =>
      handleSeasons(
        ["seasons", id, "claim"],
        "POST",
        context(user),
        {},
      ) as Promise<{ claimedCoins: number; replayed?: boolean }>;
    beforeAll(async () => {
      owner = await fixture("owner", "owner");
      first = await fixture("first");
      second = await fixture("second");
      third = await fixture("third");
    });
    afterEach(async () => {
      for (const id of seasonIds.splice(0))
        await db`DELETE FROM game_seasons WHERE id=${id}`;
    });
    afterAll(async () => {
      for (const id of users) await db`DELETE FROM users WHERE id=${id}`;
    });

    it("previews scoped bounded rewards without mutation and rejects forged/stale administrator roles", async () => {
      const data = proposal();
      const preview = (await admin(["preview-start"], data)) as {
        confirmation: string;
        maxRewardCoins: number;
        dryRun: boolean;
      };
      expect(preview).toMatchObject({
        confirmation: `START SEASON ${data.slug}`,
        maxRewardCoins: 175,
        dryRun: true,
      });
      expect(
        await db`SELECT id FROM game_seasons WHERE slug=${data.slug}`,
      ).toHaveLength(0);
      await expect(
        admin(["preview-start"], data, { ...first, role: "owner" }),
      ).rejects.toMatchObject({ status: 403 });
      await db`UPDATE users SET role='user' WHERE id=${owner.id}`;
      try {
        await expect(admin(["preview-start"], data)).rejects.toMatchObject({
          status: 403,
        });
      } finally {
        await db`UPDATE users SET role='owner' WHERE id=${owner.id}`;
      }
    });
    it("rejects unsupported/casual modes, duplicate scopes, unbounded rewards and invalid windows", async () => {
      const data = proposal();
      for (const change of [
        { modes: [{ gameId: "physics", category: "default" }] },
        { modes: [{ gameId: "ego-trip", category: "browser-casual" }] },
        { modes: [...data.modes, ...data.modes] },
        { rewards: [1001, 50, 25] },
        { rewards: [10, 50, 25] },
        { endsAt: new Date(Date.now() - 1000).toISOString() },
        { endsAt: new Date(Date.now() + 91 * 86400000).toISOString() },
      ])
        await expect(
          admin(["preview-start"], { ...data, ...change }),
        ).rejects.toMatchObject({ status: 400 });
      const operationId = randomUUID();
      await expect(
        admin(["start"], {
          ...data,
          operationId,
          reason: "Validate confirmation",
          confirmation: "yes",
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(
        await db`SELECT id FROM admin_audit_log WHERE id=${operationId}`,
      ).toHaveLength(0);
    });
    it("serializes concurrent starts and treats an operation ID as an exact retry scope", async () => {
      const data = proposal(),
        body = {
          ...data,
          operationId: randomUUID(),
          reason: "Concurrent start fixture",
          confirmation: `START SEASON ${data.slug}`,
        };
      const results = (await Promise.all([
        admin(["start"], body),
        admin(["start"], body),
      ])) as { seasonId: string; replayed?: boolean }[];
      expect(results[0].seasonId).toBe(results[1].seasonId);
      seasonIds.push(results[0].seasonId);
      expect(results.filter((row) => row.replayed)).toHaveLength(1);
      expect(
        await db`SELECT id FROM admin_audit_log WHERE id=${body.operationId}`,
      ).toHaveLength(1);
      await expect(
        admin(["start"], { ...body, title: "Different competition" }),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("ignores old/future/unidentified runs and unrelated modes while preserving ordinary boards", async () => {
      const season = await start();
      for (const metadata of [
        { runId: randomUUID(), runStartedAt: Date.now() - 86400000 },
        { runId: randomUUID(), runStartedAt: Date.now() + 86400000 },
        {},
      ])
        await score(first, 800, "tower-defense", "crossroads", metadata);
      await score(first, 900, "tower-defense", "switchback");
      expect(await entries(season.id)).toHaveLength(0);
      await score(first, 500);
      expect(Number((await entries(season.id))[0].score)).toBe(500);
      expect(
        await db`SELECT score FROM leaderboard_entries WHERE user_id=${first.id} AND game_id='tower-defense' AND category='crossroads' AND period='all'`,
      ).toHaveLength(1);
      // No endpoint accepts a browser-provided season score or user identity.
      await expect(
        handleSeasons(["seasons", season.id, "score"], "POST", context(first), {
          score: 1e15,
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        handleSeasons(["seasons", season.id, "claim"], "POST", context(first), {
          userId: second.id,
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
    it("captures cumulative baseline for users without visible scores and stays independent of ordinary score deletion", async () => {
      await db`INSERT INTO game_states(user_id,game_id,data) VALUES(${first.id},'incremental',${db.json({ prestige: 12, ascensions: 0 })}) ON CONFLICT(user_id,game_id) DO UPDATE SET data=EXCLUDED.data`;
      await db`DELETE FROM leaderboard_entries WHERE user_id=${first.id} AND game_id='incremental'`;
      const season = await start(
        proposal([{ gameId: "incremental", category: "default" }]),
      );
      await score(first, 12, "incremental", "default", {});
      expect(await entries(season.id)).toHaveLength(0);
      await score(first, 17, "incremental", "default", {});
      expect(Number((await entries(season.id))[0].score)).toBe(5);
      await db`DELETE FROM leaderboard_entries WHERE user_id=${first.id} AND game_id='incremental' AND category='default' AND period='all'`;
      await score(first, 19, "incremental", "default", {});
      expect(Number((await entries(season.id))[0].score)).toBe(7);
    });
    it("freezes deterministic standings, closes once and retains history across later competitions", async () => {
      const season = await start();
      await score(first, 10000);
      await score(second, 9000);
      await score(third, 9000);
      const preview = (await admin([season.id, "preview-close"], {})) as {
        endingEarly: boolean;
        eligibleEntries: number;
      };
      expect(preview.endingEarly).toBe(true);
      expect(preview.eligibleEntries).toBeGreaterThanOrEqual(3);
      const body = closeBody(season);
      const results = (await Promise.all([
        admin([season.id, "close"], body),
        admin([season.id, "close"], body),
      ])) as { replayed?: boolean }[];
      expect(results.filter((row) => row.replayed)).toHaveLength(1);
      const history = await detail(season.id);
      expect(history.season.state).toBe("ended");
      expect(
        history.standings
          .filter((row) =>
            [first.username, second.username, third.username].includes(
              row.username!,
            ),
          )
          .map((row) => [row.username, row.rank, row.reward]),
      ).toEqual([
        [first.username, 1, 100],
        [second.username, 2, 50],
        [third.username, 3, 25],
      ]);
      await score(first, 99999);
      expect(
        (await detail(season.id)).standings.find(
          (row) => row.username === first.username,
        )!.score,
      ).toBe(10000);
      await start();
      expect((await detail(season.id)).standings).toEqual(history.standings);
      await expect(
        db`UPDATE game_season_standings SET score=123 WHERE season_id=${season.id}`,
      ).rejects.toThrow("immutable");
    });
    it("settles concurrent claims exactly once with matching fictional-currency ledger receipts", async () => {
      const season = await start();
      await score(first, 50000);
      await admin([season.id, "close"], closeBody(season));
      expect((await detail(season.id)).unclaimedCoins).toBe(100);
      const [before] =
        await db`SELECT balance FROM currency_accounts WHERE user_id=${first.id} AND currency='tell-coins'`;
      const results = await Promise.all([
        claim(season.id),
        claim(season.id),
        claim(season.id),
      ]);
      expect(results.reduce((sum, row) => sum + row.claimedCoins, 0)).toBe(100);
      const [wallet] =
        await db`SELECT balance FROM currency_accounts WHERE user_id=${first.id} AND currency='tell-coins'`;
      expect(Number(wallet.balance)).toBe(Number(before?.balance ?? 0) + 100);
      expect(
        await db`SELECT r.standing_id FROM game_season_reward_receipts r JOIN game_season_standings s ON s.id=r.standing_id JOIN currency_ledger l ON l.id=r.ledger_id AND l.amount=r.amount AND l.reference_id=r.standing_id::text WHERE s.season_id=${season.id} AND r.user_id=${first.id}`,
      ).toHaveLength(1);
      expect((await detail(season.id)).unclaimedCoins).toBe(0);
      expect((await claim(season.id)).claimedCoins).toBe(0);
    });
    it("rolls back an over-cap claim and allows a later bounded retry", async () => {
      const claimant = await fixture("cap"),
        season = await start();
      await score(claimant, 100000);
      await admin([season.id, "close"], closeBody(season));
      await db`INSERT INTO currency_accounts(user_id,currency,balance) VALUES(${claimant.id},'tell-coins',1000000000000)`;
      await expect(claim(season.id, claimant)).rejects.toMatchObject({
        status: 409,
      });
      expect(
        await db`SELECT standing_id FROM game_season_reward_receipts WHERE user_id=${claimant.id}`,
      ).toHaveLength(0);
      await db`UPDATE currency_accounts SET balance=0 WHERE user_id=${claimant.id}`;
      expect((await claim(season.id, claimant)).claimedCoins).toBe(100);
    });
    it("keeps expired seasons out of scoring and rejects active/disabled-account claims", async () => {
      const season = await start();
      await score(first, 50000);
      await expect(claim(season.id)).rejects.toMatchObject({ status: 409 });
      await db`UPDATE game_seasons SET starts_at=clock_timestamp()-interval '1 hour',ends_at=clock_timestamp()-interval '1 minute' WHERE id=${season.id}`;
      await score(first, 99999);
      expect(Number((await entries(season.id))[0].score)).toBe(50000);
      await admin([season.id, "close"], closeBody(season));
      await db`UPDATE users SET disabled=true WHERE id=${first.id}`;
      try {
        await expect(claim(season.id)).rejects.toMatchObject({ status: 403 });
      } finally {
        await db`UPDATE users SET disabled=false WHERE id=${first.id}`;
      }
    });
    it("anonymizes deleted results and reward receipts without changing rank or resurrecting a reward", async () => {
      const deleted = await fixture("deleted"),
        season = await start();
      await score(deleted, 100000);
      await score(second, 90000);
      await admin([season.id, "close"], closeBody(season));
      await claim(season.id, deleted);
      await db`DELETE FROM users WHERE id=${deleted.id}`;
      const history = await detail(season.id, second);
      expect(history.standings.find((row) => row.rank === 1)).toMatchObject({
        username: null,
        reward: 100,
      });
      expect(
        history.standings.find((row) => row.username === second.username)!.rank,
      ).toBe(2);
      const [receipt] =
        await db`SELECT r.user_id,r.ledger_id,r.amount FROM game_season_reward_receipts r JOIN game_season_standings s ON s.id=r.standing_id WHERE s.season_id=${season.id} AND s.rank=1`;
      expect(receipt).toMatchObject({
        user_id: null,
        ledger_id: null,
        amount: 100,
      });
      await expect(claim(season.id, deleted)).rejects.toMatchObject({
        status: 403,
      });
      const replacement = await fixture("replacement");
      expect((await claim(season.id, replacement)).claimedCoins).toBe(0);
      expect(JSON.stringify(history)).not.toContain(deleted.username);
    });
    it("serializes score versus close and safely finalizes while an account is deleted", async () => {
      const racing = await fixture("race"),
        season = await start();
      await score(racing, 100000);
      await Promise.all([
        score(racing, 110000),
        admin([season.id, "close"], closeBody(season)),
      ]);
      const frozen = (await detail(season.id)).standings.find(
        (row) => row.username === racing.username,
      )!;
      expect([100000, 110000]).toContain(frozen.score);
      await score(racing, 120000);
      expect(
        (await detail(season.id)).standings.find(
          (row) => row.username === racing.username,
        )!.score,
      ).toBe(frozen.score);
      const deleted = await fixture("close_delete"),
        other = await start();
      await score(deleted, 100000);
      await Promise.all([
        admin([other.id, "close"], closeBody(other)),
        db`DELETE FROM users WHERE id=${deleted.id}`,
      ]);
      const history = await detail(other.id);
      expect(history.season.state).toBe("ended");
      expect(JSON.stringify(history)).not.toContain(deleted.username);
    });
  },
);
