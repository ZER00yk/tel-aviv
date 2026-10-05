import type { TransactionSql, JSONValue } from "postgres";
import { recordSeasonScore } from "./seasons";
import { lockSeasonProgress } from "./seasonProgress";

type Sql = TransactionSql;
export type LeaderboardScope = {
  gameId: string;
  category: string;
  period: string;
  periodKey: string;
};
export function leaderboardPeriodKey(period: string, now = Date.now()) {
  const date = new Date(now);
  if (period === "all") return "all";
  if (period === "weekly")
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
export async function lockLeaderboardScope(sql: Sql, scope: LeaderboardScope) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["leaderboard", scope.gameId, scope.category, scope.period, scope.periodKey])},0))`;
}
function cumulative(gameId: string) {
  return ["incremental", "tycoon", "casino"].includes(gameId);
}

/** A reset captures raw progress, so the next unchanged state cannot recreate a score. */
export async function captureLeaderboardReset(
  sql: Sql,
  scope: LeaderboardScope,
) {
  await lockLeaderboardScope(sql, scope);
  await sql`INSERT INTO leaderboard_reset_epochs(game_id,category,period,period_key) VALUES(${scope.gameId},${scope.category},${scope.period},${scope.periodKey}) ON CONFLICT(game_id,category,period,period_key) DO UPDATE SET reset_at=clock_timestamp()`;
  await sql`DELETE FROM leaderboard_reset_baselines WHERE game_id=${scope.gameId} AND category=${scope.category} AND period=${scope.period} AND period_key=${scope.periodKey}`;
  // Include inactive accounts' state even if they have no visible score in this period.
  await sql`INSERT INTO leaderboard_reset_baselines(game_id,category,period,period_key,user_id,baseline,blocked_run_id)
    SELECT ${scope.gameId},${scope.category},${scope.period},${scope.periodKey},s.user_id,
      GREATEST(0,CASE WHEN ${scope.gameId}='incremental' AND ${scope.category}='production' THEN COALESCE((s.data->>'lifetimeProduced')::numeric,0)
        WHEN ${scope.gameId}='incremental' THEN COALESCE((s.data->>'prestige')::numeric,0)+1000*COALESCE((s.data->>'ascensions')::numeric,0)
        WHEN ${scope.gameId}='tycoon' THEN COALESCE((s.data->>'totalEarned')::numeric,0)
        WHEN ${scope.gameId}='casino' THEN COALESCE((s.data->>'wins')::numeric,0) ELSE 0 END),s.data->>'runId'
    FROM game_states s WHERE s.game_id=${scope.gameId}`;
  // Existing score metadata handles run-based games and accounts with no game state.
  await sql`INSERT INTO leaderboard_reset_baselines(game_id,category,period,period_key,user_id,baseline,blocked_run_id)
    SELECT game_id,category,period,period_key,user_id,
      CASE WHEN ${cumulative(scope.gameId)} THEN COALESCE((metadata->>'rawScore')::numeric,score) ELSE 0 END,metadata->>'runId'
    FROM leaderboard_entries WHERE game_id=${scope.gameId} AND category=${scope.category} AND period=${scope.period} AND period_key=${scope.periodKey}
    ON CONFLICT(game_id,category,period,period_key,user_id) DO NOTHING`;
}

/** Cumulative games earn only progress since reset; run games must start a fresh run. */
export async function recordLeaderboardScore(
  sql: Sql,
  userId: string,
  gameId: string,
  category: string,
  value: number,
  metadata: unknown = {},
  now = Date.now(),
) {
  if (!Number.isFinite(value) || value < 0) return;
  await lockSeasonProgress(sql, gameId);
  const raw = Math.min(1e15, value);
  const detail =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  for (const period of ["all", "daily", "weekly"]) {
    const scope = {
      gameId,
      category,
      period,
      periodKey: leaderboardPeriodKey(period, now),
    };
    await lockLeaderboardScope(sql, scope);
    const [reset] =
      await sql`SELECT e.reset_at,b.baseline,b.blocked_run_id FROM leaderboard_reset_epochs e LEFT JOIN leaderboard_reset_baselines b ON b.game_id=e.game_id AND b.category=e.category AND b.period=e.period AND b.period_key=e.period_key AND b.user_id=${userId} WHERE e.game_id=${gameId} AND e.category=${category} AND e.period=${period} AND e.period_key=${scope.periodKey}`;
    let eligible = raw;
    if (reset && cumulative(gameId))
      eligible = Math.max(0, raw - Number(reset.baseline ?? 0));
    else if (reset) {
      if (detail.runId && detail.runId === reset.blocked_run_id) continue;
      const start =
        typeof detail.runStartedAt === "string" ||
        typeof detail.runStartedAt === "number"
          ? new Date(detail.runStartedAt).getTime()
          : NaN;
      if (
        !detail.runId ||
        !Number.isFinite(start) ||
        start <= new Date(reset.reset_at).getTime()
      )
        continue;
    }
    if (eligible === 0) continue;
    const saved = JSON.parse(
      JSON.stringify({ ...detail, rawScore: raw }),
    ) as JSONValue;
    await sql`INSERT INTO leaderboard_entries(user_id,game_id,category,period,period_key,score,metadata) VALUES(${userId},${gameId},${category},${period},${scope.periodKey},${eligible},${sql.json(saved)})
      ON CONFLICT(user_id,game_id,category,period,period_key) DO UPDATE SET score=EXCLUDED.score,metadata=EXCLUDED.metadata,recorded_at=clock_timestamp() WHERE EXCLUDED.score>leaderboard_entries.score`;
  }
  await recordSeasonScore(sql, userId, gameId, category, raw, detail);
}
