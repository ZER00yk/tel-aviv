import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { z } from "zod";
import { db } from "@tell-aviv/database";
import { fail, type ApiHandler } from "@tell-aviv/shared";
import { gameById } from "../../../games/catalog";
import { leaderboardCategories } from "../../../games/leaderboards";
import {
  isCumulativeSeasonGame as cumulative,
  lockSeasonProgress,
} from "./seasonProgress";

type Season = {
  id: string;
  slug: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  state: "active" | "ended";
  rewards: number[];
  leaderboard_epoch: string;
  finalized_at: Date | null;
};
const modeSchema = z
  .object({
    gameId: z.string().max(80),
    category: z.string().regex(/^[a-z0-9-]{1,40}$/),
  })
  .strict();
const startSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,39}$/),
  title: z.string().trim().min(3).max(80),
  endsAt: z.iso.datetime({ offset: true }),
  modes: z.array(modeSchema).min(1).max(12),
  rewards: z.tuple([
    z.number().int().min(0).max(1000),
    z.number().int().min(0).max(1000),
    z.number().int().min(0).max(1000),
  ]),
});
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    fail(400, parsed.error.issues[0]?.message ?? "Invalid season input");
  return parsed.data;
}
function validateStart(input: unknown) {
  const data = parse(startSchema.strict(), input);
  if (
    new Set(data.modes.map((mode) => `${mode.gameId}/${mode.category}`))
      .size !== data.modes.length
  )
    fail(400, "Choose each game mode once");
  for (const mode of data.modes)
    if (
      !gameById(mode.gameId)?.ranked ||
      !leaderboardCategories[mode.gameId]?.includes(mode.category)
    )
      fail(400, "Choose a supported authoritative ranked game mode");
  if (data.rewards[0] < data.rewards[1] || data.rewards[1] < data.rewards[2])
    fail(400, "Rewards must decrease with rank");
  return data;
}
async function seasonLock(sql: TransactionSql, id: string) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"game-season:" + id},0))`;
}
function seasonView(row: Season) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    leaderboardEpoch: row.leaderboard_epoch,
    state: row.state,
    awaitingFinalization:
      row.state === "active" && row.ends_at.getTime() <= Date.now(),
    rewards: row.rewards,
    finalizedAt: row.finalized_at,
  };
}

/** Called only inside authoritative score settlement, never by the API's inputs. */
export async function recordSeasonScore(
  sql: TransactionSql,
  userId: string,
  gameId: string,
  category: string,
  raw: number,
  detail: Record<string, unknown>,
) {
  const seasons = await sql<
    Season[]
  >`SELECT s.* FROM game_seasons s JOIN game_season_modes m ON m.season_id=s.id
    WHERE s.state='active' AND m.game_id=${gameId} AND m.category=${category} AND s.starts_at<=clock_timestamp() AND s.ends_at>clock_timestamp() ORDER BY s.id`;
  if (!seasons.length) return;
  if (
    !(
      await sql`SELECT id FROM users WHERE id=${userId} AND disabled=false FOR KEY SHARE`
    ).length
  )
    return;
  for (const found of seasons) {
    await seasonLock(sql, found.id);
    // Recheck the deadline and ended state after waiting for concurrent close/score work.
    const [season] = await sql<
      Season[]
    >`SELECT * FROM game_seasons WHERE id=${found.id} AND state='active' AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp()`;
    if (
      !season ||
      !(await sql`SELECT id FROM users WHERE id=${userId} AND disabled=false`)
        .length
    )
      continue;
    let eligible = raw;
    if (cumulative(gameId)) {
      const [baseline] =
        await sql`SELECT baseline FROM game_season_baselines WHERE season_id=${season.id} AND game_id=${gameId} AND category=${category} AND user_id=${userId}`;
      eligible = Math.max(0, raw - Number(baseline?.baseline ?? 0));
    } else {
      const started =
        typeof detail.runStartedAt === "number" ||
        typeof detail.runStartedAt === "string"
          ? new Date(detail.runStartedAt).getTime()
          : NaN;
      if (
        typeof detail.runId !== "string" ||
        !detail.runId ||
        !Number.isFinite(started) ||
        started < season.starts_at.getTime() ||
        started > Date.now()
      )
        continue;
    }
    if (!Number.isFinite(eligible) || eligible <= 0) continue;
    const [existing] =
      await sql`SELECT score FROM game_season_entries WHERE season_id=${season.id} AND game_id=${gameId} AND category=${category} AND user_id=${userId}`;
    if (!existing) {
      const [count] =
        await sql`SELECT count(*)::integer AS entries FROM game_season_entries WHERE season_id=${season.id} AND game_id=${gameId} AND category=${category}`;
      if (count.entries >= 10000) continue;
    }
    await sql`INSERT INTO game_season_entries(season_id,game_id,category,user_id,score) VALUES(${season.id},${gameId},${category},${userId},${Math.min(1e15, eligible)})
      ON CONFLICT(season_id,game_id,category,user_id) DO UPDATE SET score=EXCLUDED.score,recorded_at=clock_timestamp() WHERE EXCLUDED.score>game_season_entries.score`;
  }
}

async function actor(sql: TransactionSql, userId: string) {
  const [user] =
    await sql`SELECT id,username,role FROM users WHERE id=${userId} AND disabled=false FOR SHARE`;
  if (!user || !["admin", "owner"].includes(user.role))
    fail(403, "Administrator access required");
  return user;
}
const operationSchema = z.object({
  operationId: z.string().uuid(),
  confirmation: z.string().max(100),
  reason: z.string().trim().min(5).max(240),
});
async function previousOperation(
  sql: TransactionSql,
  userId: string,
  operationId: string,
  action: string,
  request: unknown,
) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${operationId},0))`;
  const [previous] =
    await sql`SELECT actor_id,action,details FROM admin_audit_log WHERE id=${operationId}`;
  if (!previous) return;
  // Compare jsonb values, whose canonical key order differs from JavaScript objects.
  if (
    previous.actor_id !== userId ||
    previous.action !== action ||
    !(
      await sql`SELECT 1 FROM admin_audit_log WHERE id=${operationId} AND details->'request'=${sql.json(JSON.parse(JSON.stringify(request)))}`
    ).length
  )
    fail(409, "This operation ID was already used for a different change");
  return previous.details;
}
async function audit(
  sql: TransactionSql,
  user: { id: string; username: string },
  operationId: string,
  action: string,
  request: unknown,
  result: Record<string, string | number>,
) {
  await sql`INSERT INTO admin_audit_log(id,actor_id,actor_username,action,details) VALUES(${operationId},${user.id},${user.username},${action},${sql.json(JSON.parse(JSON.stringify({ request, ...result })))})`;
}
async function eligibleEnd(sql: TransactionSql, endsAt: string) {
  const [clock] = await sql`SELECT clock_timestamp() AS now`;
  const duration = new Date(endsAt).getTime() - clock.now.getTime();
  if (duration < 60000 || duration > 90 * 86400000)
    fail(400, "End the season between one minute and 90 days from now");
  return clock.now as Date;
}
async function startSeason(
  userId: string,
  input: Record<string, unknown>,
  preview: boolean,
) {
  const extra = preview
    ? {}
    : parse(operationSchema.strict(), {
        operationId: input.operationId,
        confirmation: input.confirmation,
        reason: input.reason,
      });
  const {
    operationId: _operationId,
    confirmation: _confirmation,
    reason: _reason,
    ...proposal
  } = input;
  const data = validateStart(proposal);
  return db.begin(async (sql) => {
    const user = await actor(sql, userId);
    if (preview) {
      const startsAt = await eligibleEnd(sql, data.endsAt);
      return {
        ...data,
        startsAt,
        confirmation: `START SEASON ${data.slug}`,
        maxRewardCoins:
          data.modes.length * data.rewards.reduce((sum, n) => sum + n, 0),
        dryRun: true,
      };
    }
    const operation = extra as z.infer<typeof operationSchema>;
    if (operation.confirmation !== `START SEASON ${data.slug}`)
      fail(400, "Type the exact season confirmation shown");
    const request = { ...data, reason: operation.reason };
    const previous = await previousOperation(
      sql,
      userId,
      operation.operationId,
      "season.start",
      request,
    );
    if (previous)
      return { ok: true, replayed: true, seasonId: previous.seasonId };
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('game-season-catalog',0))`;
    // Gameplay takes a shared barrier before reading/mutating cumulative state.
    // Wait for existing actions and exclude new ones until every baseline commits.
    for (const gameId of [
      ...new Set(data.modes.map((mode) => mode.gameId)),
    ].sort())
      await lockSeasonProgress(sql, gameId, true);
    const startsAt = await eligibleEnd(sql, data.endsAt);
    const [count] =
      await sql`SELECT count(*)::integer AS active FROM game_seasons WHERE state='active'`;
    if (count.active >= 10)
      fail(409, "Finalize an existing season before starting another");
    const [season] = await sql<
      Season[]
    >`INSERT INTO game_seasons(slug,title,starts_at,ends_at,rewards,created_by) VALUES(${data.slug},${data.title},${startsAt},${data.endsAt},${sql.json(data.rewards)},${userId}) RETURNING *`;
    for (const mode of data.modes) {
      await sql`INSERT INTO game_season_modes(season_id,game_id,category) VALUES(${season.id},${mode.gameId},${mode.category})`;
      if (!cumulative(mode.gameId)) continue;
      await sql`INSERT INTO game_season_baselines(season_id,game_id,category,user_id,baseline)
        SELECT ${season.id},${mode.gameId},${mode.category},v.user_id,GREATEST(0,max(v.baseline)) FROM (
          SELECT user_id,CASE WHEN ${mode.gameId}='incremental' AND ${mode.category}='production' THEN COALESCE((data->>'lifetimeProduced')::double precision,0)
            WHEN ${mode.gameId}='incremental' THEN COALESCE((data->>'prestige')::double precision,0)+1000*COALESCE((data->>'ascensions')::double precision,0)
            WHEN ${mode.gameId}='tycoon' THEN COALESCE((data->>'totalEarned')::double precision,0)
            ELSE COALESCE((data->>'wins')::double precision,0) END AS baseline FROM game_states WHERE game_id=${mode.gameId}
          UNION ALL SELECT user_id,COALESCE((metadata->>'rawScore')::double precision,score) FROM leaderboard_entries WHERE game_id=${mode.gameId} AND category=${mode.category} AND period='all'
        ) v GROUP BY v.user_id`;
    }
    await audit(
      sql,
      user as { id: string; username: string },
      operation.operationId,
      "season.start",
      request,
      { seasonId: season.id },
    );
    return { ok: true, seasonId: season.id };
  });
}

async function closeSeason(
  userId: string,
  seasonId: string,
  input: Record<string, unknown>,
  preview: boolean,
) {
  if (preview) parse(z.object({}).strict(), input);
  const operation = preview ? null : parse(operationSchema.strict(), input);
  return db.begin(async (sql) => {
    const user = await actor(sql, userId);
    const request = {
      seasonId,
      reason: operation?.reason ?? "",
      confirmation: operation?.confirmation ?? "",
    };
    if (operation) {
      const previous = await previousOperation(
        sql,
        userId,
        operation.operationId,
        "season.close",
        request,
      );
      if (previous)
        return { ok: true, replayed: true, standings: previous.standings };
    }
    // Account deletion takes the user lock first. Hold participant references before
    // the season lock, so freezing standings cannot wait on a user behind a scorer.
    await sql`SELECT u.id FROM users u WHERE EXISTS(SELECT 1 FROM game_season_entries e WHERE e.season_id=${seasonId} AND e.user_id=u.id) ORDER BY u.id FOR KEY SHARE`;
    await seasonLock(sql, seasonId);
    const [season] = await sql<
      Season[]
    >`SELECT * FROM game_seasons WHERE id=${seasonId}`;
    if (!season) fail(404, "Season not found");
    const confirmation = `CLOSE SEASON ${season.slug}`;
    const [totals] =
      await sql`SELECT count(*)::integer AS entries FROM game_season_entries e JOIN users u ON u.id=e.user_id WHERE e.season_id=${seasonId} AND u.disabled=false`;
    if (preview)
      return {
        season: seasonView(season),
        confirmation,
        eligibleEntries: totals.entries,
        endingEarly: season.ends_at.getTime() > Date.now(),
        dryRun: true,
      };
    if (operation!.confirmation !== confirmation)
      fail(400, "Type the exact season confirmation shown");
    if (season.state !== "active")
      fail(409, "This season has already been finalized");
    // Freeze rank positions, never copied names or private activity. A deleted account becomes anonymous.
    const rows =
      await sql`INSERT INTO game_season_standings(season_id,game_id,category,user_id,rank,score,reward)
      SELECT season_id,game_id,category,user_id,rank,score,CASE WHEN rank<=3 THEN (${sql.json(season.rewards)}::jsonb->>((rank-1)::integer))::integer ELSE 0 END
      FROM (SELECT e.*,row_number() OVER(PARTITION BY game_id,category ORDER BY score DESC,recorded_at ASC,user_id ASC)::integer AS rank
        FROM game_season_entries e JOIN users u ON u.id=e.user_id WHERE e.season_id=${seasonId} AND u.disabled=false) ranked RETURNING id`;
    await sql`UPDATE game_seasons SET state='ended',finalized_at=clock_timestamp(),ends_at=LEAST(ends_at,clock_timestamp()) WHERE id=${seasonId}`;
    await audit(
      sql,
      user as { id: string; username: string },
      operation!.operationId,
      "season.close",
      request,
      { seasonId, standings: rows.length },
    );
    return { ok: true, standings: rows.length };
  });
}

async function claimRewards(userId: string, seasonId: string) {
  return db.begin(async (sql) => {
    // User -> reward rows -> wallet matches account deletion and serializes concurrent claims.
    if (
      !(
        await sql`SELECT id FROM users WHERE id=${userId} AND disabled=false FOR UPDATE`
      ).length
    )
      fail(403, "Account unavailable");
    const [season] =
      await sql`SELECT state FROM game_seasons WHERE id=${seasonId}`;
    if (!season) fail(404, "Season not found");
    if (season.state !== "ended")
      fail(409, "Rewards are available after standings are finalized");
    const rewards =
      await sql`SELECT s.id,s.reward FROM game_season_standings s LEFT JOIN game_season_reward_receipts r ON r.standing_id=s.id
      WHERE s.season_id=${seasonId} AND s.user_id=${userId} AND s.reward>0 AND r.standing_id IS NULL ORDER BY s.id FOR UPDATE OF s`;
    if (!rewards.length) return { ok: true, claimedCoins: 0, replayed: true };
    await sql`INSERT INTO currency_accounts(user_id,currency,balance) VALUES(${userId},'tell-coins',0) ON CONFLICT DO NOTHING`;
    const [wallet] =
      await sql`SELECT balance FROM currency_accounts WHERE user_id=${userId} AND currency='tell-coins' FOR UPDATE`;
    const claimedCoins = rewards.reduce(
      (sum, row) => sum + Number(row.reward),
      0,
    );
    let balance = Number(wallet.balance);
    if (balance + claimedCoins > 1e12)
      fail(409, "Currency balance limit reached");
    for (const reward of rewards) {
      balance += Number(reward.reward);
      const ledgerId = randomUUID();
      await sql`INSERT INTO currency_ledger(id,user_id,currency,amount,balance_after,reason,reference_id) VALUES(${ledgerId},${userId},'tell-coins',${reward.reward},${balance},'finalized competition season reward',${reward.id})`;
      await sql`INSERT INTO game_season_reward_receipts(standing_id,user_id,amount,ledger_id) VALUES(${reward.id},${userId},${reward.reward},${ledgerId})`;
    }
    await sql`UPDATE currency_accounts SET balance=${balance} WHERE user_id=${userId} AND currency='tell-coins'`;
    return { ok: true, claimedCoins, balance };
  });
}

export const handleSeasons: ApiHandler = async (
  path,
  method,
  { user, request },
  input,
) => {
  if (path[0] !== "seasons") return;
  if (method === "GET" && !path[1]) {
    const gameId = new URL(request.url).searchParams.get("gameId");
    const rows = await db<
      Season[]
    >`SELECT s.* FROM game_seasons s WHERE (${gameId === null} OR EXISTS(SELECT 1 FROM game_season_modes m WHERE m.season_id=s.id AND m.game_id=${gameId ?? ""})) ORDER BY starts_at DESC,id LIMIT 50`;
    return {
      seasons: await Promise.all(
        rows.map(async (row) => ({
          ...seasonView(row),
          modes:
            await db`SELECT game_id AS "gameId",category FROM game_season_modes WHERE season_id=${row.id} ORDER BY game_id,category`,
        })),
      ),
    };
  }
  const seasonId = parse(z.string().uuid(), path[1]);
  if (method === "POST" && path[2] === "claim") {
    parse(z.object({}).strict(), input);
    return claimRewards(user.id, seasonId);
  }
  if (method === "GET" && !path[2]) {
    const [season] = await db<
      Season[]
    >`SELECT * FROM game_seasons WHERE id=${seasonId}`;
    if (!season) fail(404, "Season not found");
    const standings =
      season.state === "ended"
        ? await db`SELECT s.game_id AS "gameId",s.category,s.rank,s.score,s.reward,u.username,s.user_id=${user.id} AS mine,r.standing_id IS NOT NULL AS claimed FROM game_season_standings s LEFT JOIN users u ON u.id=s.user_id AND u.disabled=false LEFT JOIN game_season_reward_receipts r ON r.standing_id=s.id WHERE s.season_id=${seasonId} AND (s.rank<=100 OR s.user_id=${user.id}) ORDER BY s.game_id,s.category,s.rank LIMIT 1212`
        : await db`SELECT game_id AS "gameId",category,rank,score,0 AS reward,username,user_id=${user.id} AS mine,false AS claimed FROM (SELECT e.*,u.username,row_number() OVER(PARTITION BY game_id,category ORDER BY score DESC,recorded_at,user_id)::integer AS rank FROM game_season_entries e JOIN users u ON u.id=e.user_id WHERE e.season_id=${seasonId} AND u.disabled=false) ranked WHERE rank<=100 OR user_id=${user.id} ORDER BY game_id,category,rank`;
    const [unclaimed] =
      await db`SELECT COALESCE(sum(s.reward),0)::integer AS coins FROM game_season_standings s LEFT JOIN game_season_reward_receipts r ON r.standing_id=s.id WHERE s.season_id=${seasonId} AND s.user_id=${user.id} AND r.standing_id IS NULL`;
    return {
      season: seasonView(season),
      standings,
      unclaimedCoins: unclaimed.coins,
    };
  }
  fail(404, "Season endpoint not found");
};

export const handleAdminSeasons: ApiHandler = async (
  path,
  method,
  { user },
  input,
) => {
  if (path[0] !== "admin" || path[1] !== "seasons") return;
  if (method === "POST" && path[2] === "preview-start")
    return startSeason(user.id, input, true);
  if (method === "POST" && path[2] === "start")
    return startSeason(user.id, input, false);
  if (
    path[2] &&
    method === "POST" &&
    ["preview-close", "close"].includes(path[3])
  )
    return closeSeason(
      user.id,
      parse(z.string().uuid(), path[2]),
      input,
      path[3] === "preview-close",
    );
  fail(404, "Administrator season endpoint not found");
};
