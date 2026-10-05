import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { db } from "@tell-aviv/database";
import {
  captureLeaderboardReset,
  recordLeaderboardScore,
  leaderboardPeriodKey,
  type LeaderboardScope,
} from "../packages/platform/src/leaderboard";

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "ranked reset boundaries",
  () => {
    const userId = randomUUID(),
      category = `test-${randomUUID().slice(0, 8)}`;
    const scope = (gameId: string): LeaderboardScope => ({
      gameId,
      category,
      period: "daily",
      periodKey: leaderboardPeriodKey("daily"),
    });
    const entries = (gameId: string, period = "daily") =>
      db`SELECT score,metadata FROM leaderboard_entries WHERE user_id=${userId} AND game_id=${gameId} AND category=${category} AND period=${period}`;
    const reset = (gameId: string) =>
      db.begin(async (sql) => {
        await captureLeaderboardReset(sql, scope(gameId));
        await sql`DELETE FROM leaderboard_entries WHERE game_id=${gameId} AND category=${category} AND period='daily' AND period_key=${scope(gameId).periodKey}`;
      });
    const score = (gameId: string, value: number, metadata: unknown = {}) =>
      db.begin((sql) =>
        recordLeaderboardScore(sql, userId, gameId, category, value, metadata),
      );
    beforeAll(async () => {
      await db`INSERT INTO users(id,username,display_name) VALUES(${userId},${`epoch_${userId.slice(0, 8)}`},'Reset fixture')`;
    });
    afterAll(async () => {
      await db`DELETE FROM leaderboard_reset_epochs WHERE category=${category}`;
      await db`DELETE FROM users WHERE id=${userId}`;
    });
    it("suppresses unchanged cumulative scores and counts only new progress after each scoped reset", async () => {
      await db`INSERT INTO game_states(user_id,game_id,data) VALUES(${userId},'casino',${db.json({ wins: 100 })})`;
      await score("casino", 100);
      await reset("casino");
      await score("casino", 100);
      expect(await entries("casino")).toHaveLength(0);
      expect(Number((await entries("casino", "all"))[0].score)).toBe(100);
      await score("casino", 125);
      expect(Number((await entries("casino"))[0].score)).toBe(25);
      await db`UPDATE game_states SET data=${db.json({ wins: 125 })} WHERE user_id=${userId} AND game_id='casino'`;
      await reset("casino");
      await score("casino", 125);
      expect(await entries("casino")).toHaveLength(0);
      await score("casino", 130);
      expect(Number((await entries("casino"))[0].score)).toBe(5);
    });
    it("rejects old run submissions while allowing a verified run started after reset", async () => {
      const old = {
        runId: randomUUID(),
        runStartedAt: new Date(Date.now() - 1000).toISOString(),
      };
      await score("ego-trip", 800, old);
      await reset("ego-trip");
      await score("ego-trip", 900, old);
      await score("ego-trip", 900, {
        runId: randomUUID(),
        runStartedAt: old.runStartedAt,
      });
      await score("ego-trip", 900, { score: "browser" });
      expect(await entries("ego-trip")).toHaveLength(0);
      const fresh = {
        runId: randomUUID(),
        runStartedAt: new Date(Date.now() + 1).toISOString(),
      };
      await score("ego-trip", 700, fresh);
      expect(Number((await entries("ego-trip"))[0].score)).toBe(700);
    });
    it("serializes reset and score writes without restoring stale progress", async () => {
      await db`INSERT INTO game_states(user_id,game_id,data) VALUES(${userId},'tycoon',${db.json({ totalEarned: 200 })})`;
      await score("tycoon", 200);
      await Promise.all([reset("tycoon"), score("tycoon", 200)]);
      expect(await entries("tycoon")).toHaveLength(0);
      await Promise.all([score("tycoon", 210), score("tycoon", 215)]);
      expect(Number((await entries("tycoon"))[0].score)).toBe(15);
    });
  },
);
