import { db } from "@tell-aviv/database";
import { GameError, type MultiplayerGameId } from "./engines";
import type { Sql } from "postgres";

export function catalogGameId(gameId: MultiplayerGameId) {
  if (gameId === "connect-four" || gameId === "checkers" || gameId === "chess")
    return "board-games";
  if (gameId === "poker") return "casino";
  if (["trivia", "reaction", "drawing"].includes(gameId)) return "party-games";
  return gameId;
}
export async function disabledMultiplayerGames(sql: Sql = db) {
  const rows =
    await sql`SELECT key FROM platform_flags WHERE key LIKE 'games.%' AND enabled=false`;
  return new Set(rows.map((row) => String(row.key).slice(6)));
}
export async function requireMultiplayerAvailable(
  gameId: MultiplayerGameId,
  sql: Sql = db,
) {
  const [flag] =
    await sql`SELECT enabled FROM platform_flags WHERE key=${`games.${catalogGameId(gameId)}`}`;
  if (flag?.enabled === false)
    throw new GameError("This game is temporarily disabled");
}
