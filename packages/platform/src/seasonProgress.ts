import type { TransactionSql } from "postgres";

export const isCumulativeSeasonGame = (gameId: string) =>
  ["incremental", "tycoon", "casino"].includes(gameId);

/** Parallel gameplay shares a barrier; a season baseline briefly excludes it. */
export async function lockSeasonProgress(
  sql: TransactionSql,
  gameId: string,
  exclusive = false,
) {
  if (!isCumulativeSeasonGame(gameId)) return;
  const key = `game-season-progress:${gameId}`;
  if (exclusive)
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
  else
    await sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key},0))`;
}
