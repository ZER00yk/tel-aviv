import type { TransactionSql } from "postgres";
import type { CoopState } from "../../../games/ego-trip/coop-engine";
import { bosses } from "../../../games/ego-trip/content";
import { COOP_CAMPAIGN_ROOMS } from "../../../games/ego-trip/coop-campaign";

const secretIds = new Set(["restored-relay", "pilgrims-refuge"]);
/** Called only with the realtime worker's canonical state, in its result/checkpoint transaction. */
export async function settleEgoCoopProgress(
  sql: TransactionSql,
  matchId: string,
  state: CoopState,
) {
  const campaign = state.campaign;
  if (
    state.mode !== "campaign" ||
    state.stage !== "won" ||
    !campaign ||
    campaign.clearedRooms !== COOP_CAMPAIGN_ROOMS ||
    campaign.checkpointRoom !== COOP_CAMPAIGN_ROOMS ||
    campaign.room.index !== 39 ||
    campaign.room.kind !== "boss" ||
    state.bossIndex !== 7 ||
    state.boss.hp > 0 ||
    state.result?.reason !== "All eight districts restored together"
  )
    return;
  const allIds = Object.keys(state.players);
  if (allIds.length < 2 || allIds.length > 4) return;
  const winners = state.result.winners;
  if (
    !winners.length ||
    new Set(winners).size !== winners.length ||
    winners.some((id) => !state.players[id] || state.players[id].departed)
  )
    return;
  if (allIds.some((id) => !state.players[id].departed && !winners.includes(id)))
    return;
  const [match] =
    await sql`SELECT game_id,result FROM multiplayer_matches WHERE id=${matchId} FOR UPDATE`;
  if (
    !match ||
    match.game_id !== "ego-trip" ||
    JSON.stringify(match.result.winners.slice().sort()) !==
      JSON.stringify(winners.slice().sort())
  )
    return;
  const discoveries = [...new Set(campaign.secrets ?? [])].filter((id) =>
    secretIds.has(id),
  );
  // Ranked requests use the same owner locks. Stable ordering prevents co-op parties
  // or overlapping ranked settlement from taking the progress locks in reverse order.
  const users =
    await sql`SELECT id FROM users WHERE id IN ${sql(winners)} AND disabled=false ORDER BY id FOR UPDATE`;
  for (const user of users) {
    const inserted =
      await sql`INSERT INTO ego_coop_completion_receipts(match_id,user_id,discoveries) VALUES(${matchId},${user.id},${sql.json(discoveries)}) ON CONFLICT DO NOTHING RETURNING user_id`;
    if (!inserted.length) continue;
    await sql`INSERT INTO ego_permanent_progress(user_id) VALUES(${user.id}) ON CONFLICT DO NOTHING`;
    const [old] =
      await sql`SELECT bosses,discoveries FROM ego_permanent_progress WHERE user_id=${user.id} FOR UPDATE`;
    const ownedBosses = new Set<string>(old.bosses);
    const oldCount = ownedBosses.size;
    for (const boss of bosses.slice(0, 8)) ownedBosses.add(boss.name);
    const ownedSecrets = [
      ...new Set<string>([...old.discoveries, ...discoveries]),
    ];
    const insight = (ownedBosses.size - oldCount) * 5 + 10;
    await sql`UPDATE ego_permanent_progress SET bosses=${sql.json([...ownedBosses])},discoveries=${sql.json(ownedSecrets)},insight=insight+${insight},updated_at=now() WHERE user_id=${user.id}`;
  }
}
