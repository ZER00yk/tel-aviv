import { randomUUID } from "node:crypto";
import type { TransactionSql, JSONValue } from "postgres";
import { z } from "zod";
import { db } from "@tell-aviv/database";
import { fail, levelForXp, type ApiHandler } from "@tell-aviv/shared";
import { games, gameById } from "../../../games/catalog";
import {
  newIncremental,
  actIncremental,
  type IncrementalState,
} from "../../../games/server/incremental";
import {
  newTycoon,
  actTycoon,
  type TycoonState,
} from "../../../games/server/tycoon";
import {
  newCasino,
  actCasino,
  publicCasino,
  type CasinoState,
} from "../../../games/server/casino";
import {
  newDeck,
  actDeck,
  publicDeck,
  type DeckState,
} from "../../../games/server/deck";
import {
  newTower,
  actTower,
  type TowerState,
} from "../../../games/server/tower";
import { GameRuleError } from "../../../games/server/rules";
import { casinoEconomyAction, casinoEconomyView } from "./casinoEconomy";
import { recordLeaderboardScore } from "./leaderboard";
import { lockSeasonProgress } from "./seasonProgress";
import { publishCasinoMarketUpdate } from "./casinoMarketplace";
import { setActivity } from "../../../apps/realtime/src/events";
import { COSMETIC_CATALOG } from "./inventory";
import { handleEgoRanked } from "./egoRanked";

type Sql = TransactionSql;
type GameState =
  IncrementalState | TycoonState | CasinoState | DeckState | TowerState;
const authoritative = new Set([
  "incremental",
  "tycoon",
  "casino",
  "deck-roguelike",
  "tower-defense",
]);
const cosmeticShop = COSMETIC_CATALOG;
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    fail(400, result.error.issues.map((issue) => issue.message).join("; "));
  return result.data;
}
function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}
function periodKey(period: string, now = Date.now()) {
  const date = new Date(now);
  if (period === "all") return "all";
  if (period === "weekly")
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
function initialState(gameId: string, now: number): GameState {
  if (gameId === "incremental") return newIncremental(now);
  if (gameId === "tycoon") return newTycoon(now);
  if (gameId === "casino") return newCasino();
  if (gameId === "deck-roguelike") return newDeck(now);
  return newTower();
}
export async function ensureAccount(
  sql: Sql,
  userId: string,
  currency: string,
) {
  const initial = currency === "casino-credits" ? 1000 : 0;
  const inserted =
    await sql`INSERT INTO currency_accounts(user_id,currency,balance) VALUES(${userId},${currency},${initial}) ON CONFLICT DO NOTHING RETURNING balance`;
  if (inserted.length && initial)
    await sql`INSERT INTO currency_ledger(user_id,currency,amount,balance_after,reason) VALUES(${userId},${currency},${initial},${initial},'opening fictional credits')`;
}
export async function changeBalance(
  sql: Sql,
  userId: string,
  currency: string,
  amount: number,
  reason: string,
  reference: string,
) {
  if (!Number.isSafeInteger(amount) || amount === 0) {
    if (amount === 0) return;
    fail(400, "Invalid currency amount");
  }
  const [account] =
    await sql`SELECT balance FROM currency_accounts WHERE user_id=${userId} AND currency=${currency} FOR UPDATE`;
  if (!account) fail(500, "Currency account unavailable");
  const next = Number(account.balance) + amount;
  if (next < 0) fail(400, "Not enough fictional Credits");
  if (next > 1e12) fail(400, "Currency balance limit reached");
  await sql`UPDATE currency_accounts SET balance=${next} WHERE user_id=${userId} AND currency=${currency}`;
  await sql`INSERT INTO currency_ledger(user_id,currency,amount,balance_after,reason,reference_id) VALUES(${userId},${currency},${amount},${next},${reason},${reference})`;
}
export async function unlock(
  sql: Sql,
  userId: string,
  achievementId: string,
  unlocked: string[],
) {
  const rows =
    await sql`INSERT INTO user_achievements(user_id,achievement_id) VALUES(${userId},${achievementId}) ON CONFLICT DO NOTHING RETURNING achievement_id`;
  if (!rows.length) return;
  const [definition] =
    await sql`SELECT points,name,game_id FROM achievement_definitions WHERE id=${achievementId}`;
  await sql`UPDATE users SET xp=xp+${definition.points} WHERE id=${userId}`;
  await ensureAccount(sql, userId, "tell-coins");
  await changeBalance(
    sql,
    userId,
    "tell-coins",
    20,
    "server verified achievement",
    achievementId,
  );
  await sql`INSERT INTO notifications(user_id,actor_id,kind,title,link) VALUES(${userId},${userId},'achievement',${`Achievement unlocked: ${definition.name}`},${`/games/${definition.game_id}`})`;
  await sql`INSERT INTO social_activity(user_id,kind,title,link) VALUES(${userId},'achievement',${`unlocked ${definition.name}`},${`/games/${definition.game_id}`})`;
  unlocked.push(achievementId);
}
export async function score(
  sql: Sql,
  userId: string,
  gameId: string,
  category: string,
  value: number,
  metadata: unknown = {},
) {
  return recordLeaderboardScore(sql, userId, gameId, category, value, metadata);
}
async function progression(
  sql: Sql,
  userId: string,
  gameId: string,
  state: GameState,
  action: string,
) {
  const unlocked: string[] = [];
  if (gameId === "incremental") {
    const s = state as IncrementalState;
    if (s.alloy >= 1) await unlock(sql, userId, "incremental-forge", unlocked);
    if (s.prestige >= 1)
      await unlock(sql, userId, "incremental-prestige", unlocked);
    if (s.ascensions >= 1)
      await unlock(sql, userId, "incremental-ascend", unlocked);
    await score(
      sql,
      userId,
      gameId,
      "default",
      s.prestige + s.ascensions * 1000,
      { prestige: s.prestige, ascensions: s.ascensions },
    );
    await score(sql, userId, gameId, "production", s.lifetimeProduced);
  } else if (gameId === "tycoon") {
    const s = state as TycoonState;
    if (s.businesses.length >= 3)
      await unlock(sql, userId, "tycoon-empire", unlocked);
    if (s.totalEarned >= 1e6)
      await unlock(sql, userId, "tycoon-million", unlocked);
    await score(sql, userId, gameId, "default", s.totalEarned);
  } else if (gameId === "casino") {
    const s = state as CasinoState;
    if (s.wins >= 1) await unlock(sql, userId, "casino-first-win", unlocked);
    await score(sql, userId, gameId, "default", s.wins, { rounds: s.rounds });
  } else if (gameId === "deck-roguelike") {
    const s = state as DeckState;
    if (s.phase === "won") await unlock(sql, userId, "deck-clear", unlocked);
    if (action !== "state")
      await score(sql, userId, gameId, "default", s.score, {
        runId: s.runId,
        runStartedAt: Number(s.runId.split("-")[0]),
        floor: s.floor,
        clear: s.phase === "won",
        mode: s.mode,
      });
    if (s.mode === "daily" && s.phase === "won")
      await score(sql, userId, gameId, "daily-run", s.score, {
        runId: s.runId,
        runStartedAt: Number(s.runId.split("-")[0]),
      });
  } else if (gameId === "tower-defense") {
    const s = state as TowerState;
    if (s.wave >= 10 && s.phase !== "lost")
      await unlock(sql, userId, "tower-ten", unlocked);
    if (s.phase === "won" && (s.mode ?? "campaign") === "campaign")
      await unlock(sql, userId, "tower-clear", unlocked);
    // Failed waves count only to the last wave actually survived.
    if (action !== "state")
      await score(
        sql,
        userId,
        gameId,
        s.mode === "endless"
          ? "endless"
          : s.map && s.map !== "boulevard"
            ? s.map
            : "default",
        Math.max(0, s.wave - (s.phase === "lost" ? 1 : 0)),
        { kills: s.kills, runId: s.runId, runStartedAt: s.runStartedAt },
      );
  }
  return unlocked;
}
async function casinoAction(
  sql: Sql,
  userId: string,
  state: CasinoState,
  action: string,
  payload: Record<string, unknown>,
) {
  await ensureAccount(sql, userId, "casino-credits");
  const reference = randomUUID();
  if (
    await casinoEconomyAction(
      sql,
      userId,
      state,
      action,
      payload,
      ensureAccount,
      changeBalance,
    )
  ) {
    // Durable loans, limited collectible issuance, and two-sided trades commit with the game state.
  } else if (action === "transfer") {
    const { username, amount } = parse(
      z.object({
        username: z.string().min(3).max(24),
        amount: z.number().int().min(1).max(100000),
      }),
      payload,
    );
    const [recipient] =
      await sql`SELECT id FROM users WHERE lower(username)=lower(${username}) AND disabled=false`;
    if (!recipient || recipient.id === userId)
      fail(400, "Choose another active player");
    const blocked =
      await sql`SELECT 1 FROM user_blocks WHERE (user_id=${userId} AND blocked_id=${recipient.id}) OR (user_id=${recipient.id} AND blocked_id=${userId})`;
    if (blocked.length) fail(403, "Transfer unavailable");
    await ensureAccount(sql, recipient.id, "casino-credits");
    // A consistent lock order makes simultaneous A→B and B→A transfers safe.
    await sql`SELECT user_id FROM currency_accounts WHERE currency='casino-credits' AND user_id IN (${userId},${recipient.id}) ORDER BY user_id FOR UPDATE`;
    await changeBalance(
      sql,
      userId,
      "casino-credits",
      -amount,
      "player transfer sent",
      reference,
    );
    await changeBalance(
      sql,
      recipient.id,
      "casino-credits",
      amount,
      "player transfer received",
      reference,
    );
    state.lastResult = { game: "transfer", username, amount };
  } else {
    const [account] =
      await sql`SELECT * FROM currency_accounts WHERE user_id=${userId} AND currency='casino-credits' FOR UPDATE`;
    if (action === "reward") {
      if (
        account.last_reward_at &&
        Date.now() - new Date(account.last_reward_at).getTime() < 12 * 3600000
      )
        fail(429, "The 250 Credit reward is available every twelve hours");
      await changeBalance(
        sql,
        userId,
        "casino-credits",
        250,
        "periodic fictional reward",
        reference,
      );
      await sql`UPDATE currency_accounts SET last_reward_at=now() WHERE user_id=${userId} AND currency='casino-credits'`;
      state.lastResult = { game: "reward", amount: 250 };
    } else {
      const result = actCasino(state, action, payload);
      // Check the gross stake, even when an immediate payout would leave a positive balance.
      if (result.debit > Number(account.balance))
        fail(400, "Not enough fictional Credits");
      if (result.debit)
        await changeBalance(
          sql,
          userId,
          "casino-credits",
          -result.debit,
          `${action} stake`,
          reference,
        );
      if (result.credit)
        await changeBalance(
          sql,
          userId,
          "casino-credits",
          result.credit,
          `${action} payout`,
          reference,
        );
    }
  }
  const [account] =
    await sql`SELECT balance,last_reward_at FROM currency_accounts WHERE user_id=${userId} AND currency='casino-credits'`;
  return {
    ...publicCasino(state, Number(account.balance), account.last_reward_at),
    ...(await casinoEconomyView(sql, userId)),
  };
}
async function actionGame(
  userId: string,
  gameId: string,
  input: Record<string, unknown>,
) {
  const { action, payload } = parse(
    z.object({
      action: z.string().min(1).max(40),
      payload: z.record(z.string(), z.unknown()).default({}),
    }),
    input,
  );
  if (!authoritative.has(gameId))
    fail(
      400,
      "This casual game uses cloud saves; browser scores cannot grant ranked scores, currency, XP, or achievements",
    );
  return db.begin(async (sql) => {
    await lockSeasonProgress(sql, gameId);
    const now = Date.now();
    await sql`INSERT INTO game_states(user_id,game_id,data) VALUES(${userId},${gameId},${sql.json(json(initialState(gameId, now)))}) ON CONFLICT DO NOTHING`;
    const [stored] =
      await sql`SELECT data,schema_version FROM game_states WHERE user_id=${userId} AND game_id=${gameId} FOR UPDATE`;
    if (stored.schema_version !== 1)
      fail(
        409,
        "Unsupported authoritative save version; this save has been preserved",
      );
    let state = stored.data as GameState;
    let safe: unknown;
    try {
      if (gameId === "incremental")
        state = actIncremental(state as IncrementalState, action, payload, now);
      if (gameId === "tycoon")
        state = actTycoon(state as TycoonState, action, payload, now);
      if (gameId === "deck-roguelike")
        state = actDeck(state as DeckState, action, payload, now);
      if (gameId === "tower-defense")
        state = actTower(state as TowerState, action, payload);
      if (gameId === "casino")
        safe = await casinoAction(
          sql,
          userId,
          state as CasinoState,
          action,
          payload,
        );
    } catch (error) {
      if (error instanceof GameRuleError) fail(400, error.message);
      throw error;
    }
    const achievements = await progression(sql, userId, gameId, state, action);
    await sql`UPDATE game_states SET data=${sql.json(json(state))},updated_at=now() WHERE user_id=${userId} AND game_id=${gameId}`;
    safe ??=
      gameId === "deck-roguelike" ? publicDeck(state as DeckState) : state;
    return { state: safe, achievements, authoritative: true, schemaVersion: 1 };
  });
}

export const handleGames: ApiHandler = async (
  path,
  method,
  { user, request },
  input,
) => {
  if (path[0] === "achievements" && method === "GET") {
    const target = new URL(request.url).searchParams.get("userId") ?? user.id;
    parse(z.string().uuid(), target);
    if (target !== user.id) {
      const [profile] =
        await db`SELECT settings FROM users WHERE id=${target} AND disabled=false`;
      if (!profile) fail(404, "User not found");
      const blocked =
        await db`SELECT 1 FROM user_blocks WHERE (user_id=${user.id} AND blocked_id=${target}) OR (user_id=${target} AND blocked_id=${user.id})`;
      if (blocked.length || profile.settings?.privacy?.showActivity === false)
        fail(403, "Achievement activity is private");
    }
    return db`SELECT d.id,d.game_id AS "gameId",d.name,d.description,d.icon,d.hidden,d.points,a.unlocked_at AS "unlockedAt",(SELECT count(*)::integer FROM user_achievements x WHERE x.achievement_id=d.id) AS "unlockCount" FROM achievement_definitions d LEFT JOIN user_achievements a ON a.achievement_id=d.id AND a.user_id=${target} WHERE (d.hidden=false OR a.unlocked_at IS NOT NULL) AND (${target === user.id} OR a.unlocked_at IS NOT NULL) ORDER BY a.unlocked_at DESC NULLS LAST,d.points DESC`;
  }
  if (path[0] !== "games" && path[0] !== "economy") return undefined;
  if (path[0] === "economy") {
    if (method === "GET" && path.length === 1) {
      const accounts =
        await db`SELECT currency,balance,last_reward_at AS "lastRewardAt" FROM currency_accounts WHERE user_id=${user.id}`;
      const inventory =
        await db`SELECT item_id AS "itemId",acquired_at AS "acquiredAt" FROM cosmetic_inventory WHERE user_id=${user.id}`;
      return {
        accounts: accounts.map((account) => ({
          ...account,
          balance: Number(account.balance),
        })),
        inventory,
        shop: cosmeticShop,
      };
    }
    if (method === "GET" && path[1] === "ledger")
      return db`SELECT id,currency,amount,balance_after AS "balanceAfter",reason,reference_id AS "referenceId",created_at AS "createdAt" FROM currency_ledger WHERE user_id=${user.id} ORDER BY created_at DESC LIMIT 100`;
    if (method === "POST" && path[1] === "purchase") {
      const { itemId } = parse(z.object({ itemId: z.string() }), input);
      const item = cosmeticShop.find(
        (candidate) => candidate.id === itemId && !candidate.earnedOnly,
      );
      if (!item) fail(404, "Cosmetic not found");
      return db.begin(async (sql) => {
        await ensureAccount(sql, user.id, "tell-coins");
        await sql`SELECT balance FROM currency_accounts WHERE user_id=${user.id} AND currency='tell-coins' FOR UPDATE`;
        if (
          (
            await sql`SELECT 1 FROM cosmetic_inventory WHERE user_id=${user.id} AND item_id=${itemId}`
          ).length
        )
          fail(409, "You already own this cosmetic");
        await changeBalance(
          sql,
          user.id,
          "tell-coins",
          -item.price,
          "cosmetic purchase",
          itemId,
        );
        await sql`INSERT INTO cosmetic_inventory(user_id,item_id) VALUES(${user.id},${itemId})`;
        return { purchased: itemId };
      });
    }
    return undefined;
  }
  if (method === "GET" && path.length === 1) {
    const favorites =
      await db`SELECT game_id FROM game_favorites WHERE user_id=${user.id}`;
    const history =
      await db`SELECT game_id AS "gameId",max(started_at) AS "lastPlayed",count(*)::integer AS sessions FROM game_play_sessions WHERE user_id=${user.id} GROUP BY game_id ORDER BY max(started_at) DESC LIMIT 10`;
    const counts =
      await db`SELECT s.game_id,count(DISTINCT s.user_id)::integer AS count FROM game_play_sessions s JOIN users u ON u.id=s.user_id WHERE s.ended_at IS NULL AND s.heartbeat_at>now()-interval '90 seconds' AND coalesce(u.settings->>'presence','online')<>'invisible' GROUP BY s.game_id`;
    const flags =
      await db`SELECT key,enabled FROM platform_flags WHERE key LIKE 'games.%'`;
    return {
      games: games.map((game) => ({
        ...game,
        enabled:
          flags.find((flag) => flag.key === `games.${game.id}`)?.enabled !==
          false,
        status: "beta",
        favorite: favorites.some((f) => f.game_id === game.id),
        livePlayers: counts.find((c) => c.game_id === game.id)?.count ?? 0,
      })),
      history,
    };
  }
  if (method === "GET" && path[1] === "history")
    return db`SELECT game_id AS "gameId",max(started_at) AS "lastPlayed",count(*)::integer AS sessions FROM game_play_sessions WHERE user_id=${user.id} GROUP BY game_id ORDER BY max(started_at) DESC LIMIT 30`;
  const gameId = path[1];
  const game = gameById(gameId);
  if (!game) fail(404, "Game not found");
  const operation = path[2];
  const [flag] =
    await db`SELECT enabled FROM platform_flags WHERE key=${`games.${gameId}`}`;
  const enabled = flag?.enabled !== false;
  if (!enabled && method === "POST" && operation === "ranked")
    fail(503, "This game is temporarily disabled");
  const ranked = await handleEgoRanked(path, method, { user, request }, input, {
    ensureAccount,
    changeBalance,
    unlock,
    score,
  });
  if (ranked !== undefined) return ranked;
  if (
    !enabled &&
    method === "POST" &&
    ["start", "session", "action", "save", "favorite"].includes(operation)
  )
    fail(503, "This game is temporarily disabled");
  if (method === "GET" && operation === "user")
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      xp: user.xp,
      level: levelForXp(user.xp),
    };
  if (method === "GET" && !operation) {
    const [favorite] =
      await db`SELECT 1 FROM game_favorites WHERE user_id=${user.id} AND game_id=${gameId}`;
    const [stats] =
      await db`SELECT count(*)::integer AS sessions,max(started_at) AS "lastPlayed",coalesce(sum(extract(epoch FROM (coalesce(ended_at,least(now(),heartbeat_at+interval '90 seconds'))-started_at))),0)::integer AS "playSeconds" FROM game_play_sessions WHERE user_id=${user.id} AND game_id=${gameId}`;
    const achievements =
      await db`SELECT d.id,d.name,d.description,d.icon,d.points,a.unlocked_at AS "unlockedAt" FROM achievement_definitions d LEFT JOIN user_achievements a ON a.achievement_id=d.id AND a.user_id=${user.id} WHERE d.game_id=${gameId} ORDER BY d.points`;
    return {
      game: { ...game, enabled, status: "beta" },
      enabled,
      favorite: !!favorite,
      stats,
      achievements,
      changelog: [
        {
          version: game.version,
          date: "2026-10-01",
          notes:
            gameId === "ego-trip"
              ? "Forty-room casual and co-op campaigns plus a server-validated ranked solo gauntlet."
              : authoritative.has(gameId)
                ? "Initial playable release with server-verified progression and namespaced cloud state."
                : "Initial casual release with isolated cloud saves. Browser scores remain unranked.",
        },
      ],
    };
  }
  if (operation === "save" && method === "GET") {
    const [save] =
      await db`SELECT data,schema_version AS "schemaVersion",revision,updated_at AS "updatedAt" FROM game_saves WHERE user_id=${user.id} AND game_id=${gameId}`;
    return save
      ? { ...save, authoritative: false }
      : {
          data: null,
          schemaVersion: game.saveSchemaVersion,
          revision: 0,
          updatedAt: null,
          authoritative: false,
        };
  }
  if (operation === "save" && method === "POST") {
    if (!game.permissions.includes("saves.write"))
      fail(403, "This game stores progression through authoritative actions");
    const data = parse(
      z
        .object({
          data: z.unknown(),
          schemaVersion: z.number().int().min(1).max(1000).default(1),
          expectedRevision: z.number().int().min(0).optional(),
        })
        .strict(),
      input,
    );
    if (data.data === undefined) fail(400, "A save payload is required");
    if (Buffer.byteLength(JSON.stringify(data.data), "utf8") > 256 * 1024)
      fail(413, "Game saves are limited to 256 KiB");
    if (data.schemaVersion !== game.saveSchemaVersion)
      fail(
        409,
        "Unsupported save schema version; existing data has been preserved",
      );
    return db.begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${user.id}:${gameId}:save`}))`;
      const [old] =
        await sql`SELECT revision,schema_version FROM game_saves WHERE user_id=${user.id} AND game_id=${gameId} FOR UPDATE`;
      if (old && old.schema_version > data.schemaVersion)
        fail(409, "A newer save version exists; downgrade refused");
      if (
        data.expectedRevision !== undefined &&
        Number(old?.revision ?? 0) !== data.expectedRevision
      )
        fail(409, "Save conflict: load the latest revision before saving");
      const [saved] =
        await sql`INSERT INTO game_saves(user_id,game_id,schema_version,data) VALUES(${user.id},${gameId},${data.schemaVersion},${sql.json(json(data.data))}) ON CONFLICT(user_id,game_id) DO UPDATE SET data=EXCLUDED.data,schema_version=EXCLUDED.schema_version,revision=game_saves.revision+1,updated_at=now() RETURNING data,schema_version AS "schemaVersion",revision,updated_at AS "updatedAt"`;
      return { ...saved, authoritative: false };
    });
  }
  if (operation === "action" && method === "POST") {
    const result = await actionGame(user.id, gameId, input);
    if (
      gameId === "casino" &&
      typeof input.action === "string" &&
      /^(marketplace\.|collect\.)/.test(input.action)
    )
      await publishCasinoMarketUpdate(user.id);
    return result;
  }
  if (operation === "favorite" && method === "POST") {
    const { favorite } = parse(z.object({ favorite: z.boolean() }), input);
    if (favorite)
      await db`INSERT INTO game_favorites(user_id,game_id) VALUES(${user.id},${gameId}) ON CONFLICT DO NOTHING`;
    else
      await db`DELETE FROM game_favorites WHERE user_id=${user.id} AND game_id=${gameId}`;
    return { favorite };
  }
  if (operation === "achievements" && method === "GET")
    return db`SELECT d.id,d.name,d.description,d.icon,d.hidden,d.points,a.unlocked_at AS "unlockedAt",(SELECT count(*)::integer FROM user_achievements x WHERE x.achievement_id=d.id) AS "unlockCount" FROM achievement_definitions d LEFT JOIN user_achievements a ON a.achievement_id=d.id AND a.user_id=${user.id} WHERE d.game_id=${gameId} ORDER BY d.points`;
  if (operation === "leaderboard" && method === "GET") {
    const url = new URL(request.url);
    const period = parse(
      z.enum(["all", "daily", "weekly"]),
      url.searchParams.get("period") ?? "all",
    );
    const scope = parse(
      z.enum(["all", "friends"]),
      url.searchParams.get("scope") ?? "all",
    );
    const category = parse(
      z.string().regex(/^[a-z0-9-]{1,40}$/),
      url.searchParams.get("category") ?? "default",
    );
    if (!authoritative.has(gameId) && gameId !== "ego-trip")
      return {
        entries: [],
        ranked: false,
        reason: "Browser-authoritative runs are casual and unranked",
      };
    const rows =
      await db`SELECT e.user_id AS "userId",u.username,u.display_name AS "displayName",u.avatar,e.score,e.metadata,e.recorded_at AS "recordedAt" FROM leaderboard_entries e JOIN users u ON u.id=e.user_id WHERE e.game_id=${gameId} AND e.category=${category} AND e.period=${period} AND e.period_key=${periodKey(period)} AND u.disabled=false AND (${scope === "all"} OR e.user_id=${user.id} OR EXISTS(SELECT 1 FROM friendships f WHERE (f.user_low=${user.id} AND f.user_high=e.user_id) OR (f.user_high=${user.id} AND f.user_low=e.user_id))) ORDER BY e.score DESC,e.recorded_at ASC LIMIT 100`;
    return {
      entries: rows.map((row, index) => ({ ...row, rank: index + 1 })),
      ranked: true,
      category,
      period,
      periodKey: periodKey(period),
      scope,
    };
  }
  if ((operation === "start" || operation === "session") && method === "POST") {
    const { mode } = parse(
      z.object({ mode: z.string().min(1).max(30).default("solo") }),
      input,
    );
    const session = await db.begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
      const [old] =
        await sql`SELECT * FROM game_play_sessions WHERE user_id=${user.id} AND ended_at IS NULL FOR UPDATE`;
      if (old && old.game_id === gameId) {
        const [same] =
          await sql`UPDATE game_play_sessions SET heartbeat_at=now(),mode=${mode} WHERE id=${old.id} RETURNING id,game_id AS "gameId",started_at AS "startedAt",mode`;
        return same;
      }
      if (old)
        await sql`UPDATE game_play_sessions SET ended_at=now() WHERE id=${old.id}`;
      const [started] =
        await sql`INSERT INTO game_play_sessions(user_id,game_id,mode) VALUES(${user.id},${gameId},${mode}) RETURNING id,game_id AS "gameId",started_at AS "startedAt",mode`;
      return started;
    });
    await setActivity(user.id, { gameId, mode }, true);
    return session;
  }
  if (operation === "presence" && method === "POST") {
    const { mode } = parse(
      z.object({ mode: z.string().min(1).max(30).default("solo") }),
      input,
    );
    await db`UPDATE game_play_sessions SET heartbeat_at=now(),mode=${mode} WHERE user_id=${user.id} AND game_id=${gameId} AND ended_at IS NULL`;
    await setActivity(user.id, { gameId, mode }, true);
    return { gameId, mode, expiresIn: 90 };
  }
  if (operation === "end" && method === "POST") {
    const { sessionId } = parse(
      z.object({ sessionId: z.string().uuid().optional() }),
      input,
    );
    const rows =
      await db`UPDATE game_play_sessions SET ended_at=now() WHERE user_id=${user.id} AND game_id=${gameId} AND ended_at IS NULL AND (${sessionId === undefined} OR id=${sessionId ?? "00000000-0000-0000-0000-000000000000"}) RETURNING id,started_at AS "startedAt",ended_at AS "endedAt"`;
    if (rows.length) await setActivity(user.id, {});
    return { ended: rows.length > 0, session: rows[0] ?? null };
  }
  return undefined;
};
