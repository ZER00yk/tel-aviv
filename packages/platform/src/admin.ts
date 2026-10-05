import { randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import { db } from "@tell-aviv/database";
import { handleCreatorReports } from "./creations/community";
import { handleAdminSeasons } from "./seasons";
import { fail, type ApiHandler } from "@tell-aviv/shared";
import { z } from "zod";
import { captureLeaderboardReset } from "./leaderboard";
import { operationalStatus } from "./operationalStatus";
import Redis from "ioredis";
import { newCasino } from "../../../games/server/casino";
import { games, gameById } from "../../../games/catalog";
import { leaderboardCategories } from "../../../games/leaderboards";
import { publishEvent } from "../../../apps/realtime/src/events";
import { requestStorageCleanup } from "./account";
import {
  MAX_STORAGE_QUOTA,
  MIN_STORAGE_QUOTA,
  storageUsage,
} from "./storageQuota";

type Actor = { id: string; username: string; role: "admin" | "owner" };
type Target = { id: string; username: string; role: string; disabled: boolean };
type Details = Record<
  string,
  string | number | boolean | null | Record<string, string | number>
>;
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    fail(400, result.error.issues[0]?.message ?? "Invalid administrator input");
  return result.data;
}
async function administrator(userId: string): Promise<Actor> {
  // ApiContext is not a source of authority: re-check the stored, active role.
  const [actor] =
    await db`SELECT id,username,role FROM users WHERE id=${userId} AND disabled=false`;
  if (!actor || !["admin", "owner"].includes(actor.role))
    fail(403, "Administrator access required");
  return actor as Actor;
}
async function targetAccount(
  sql: TransactionSql,
  actor: Actor,
  userId: string,
): Promise<Target> {
  const [target] =
    await sql`SELECT id,username,role,disabled FROM users WHERE id=${userId}`;
  if (!target) fail(404, "User not found");
  if (
    ["admin", "owner"].includes(target.role) &&
    actor.role !== "owner" &&
    target.id !== actor.id
  )
    fail(403, "Only the owner can change another administrator account");
  return target as Target;
}
async function audit(
  sql: TransactionSql,
  actor: Actor,
  action: string,
  details: Details,
  target?: Target,
  operationId: string = randomUUID(),
) {
  await sql`INSERT INTO admin_audit_log(id,actor_id,actor_username,target_id,target_username,action,details)
    VALUES(${operationId},${actor.id},${actor.username},${target?.id ?? null},${target?.username ?? null},${action},${sql.json(details)})`;
}
const currencyInput = z
  .object({
    operationId: z.string().uuid(),
    currency: z.enum(["tell-coins", "casino-credits"]),
    mode: z.enum(["grant", "reset"]),
    amount: z.number().int().min(0).max(1000000),
    confirmation: z.string().max(120),
    reason: z.string().trim().min(5).max(240),
  })
  .strict()
  .refine(
    (data) => (data.mode === "grant" ? data.amount > 0 : data.amount === 0),
    "Grants require a positive amount; resets require zero",
  );
async function changeCurrency(
  actor: Actor,
  targetId: string,
  input: Record<string, unknown>,
) {
  const data = parse(currencyInput, input);
  return db.begin(async (sql) => {
    // Request retries cannot grant twice. This lock also serializes first use of an ID.
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${data.operationId},0))`;
    const [previous] =
      await sql`SELECT actor_id,target_id,action,details FROM admin_audit_log WHERE id=${data.operationId}`;
    const request = {
      currency: data.currency,
      mode: data.mode,
      amount: data.amount,
      reason: data.reason,
    };
    if (previous) {
      const saved = previous.details.request as typeof request;
      if (
        previous.actor_id !== actor.id ||
        previous.target_id !== targetId ||
        previous.action !== "currency." + data.mode ||
        saved.currency !== request.currency ||
        saved.mode !== request.mode ||
        saved.amount !== request.amount ||
        saved.reason !== request.reason
      )
        fail(409, "This operation ID was already used for a different change");
      return {
        ok: true,
        replayed: true,
        balance: Number(previous.details.balanceAfter),
      };
    }
    const target = await targetAccount(sql, actor, targetId);
    if (target.disabled)
      fail(400, "Enable this account before changing its currency");
    if (
      data.confirmation !==
      `${data.mode.toUpperCase()} ${data.currency} ${target.username}`
    )
      fail(400, "Type the exact currency confirmation shown");
    if (data.currency === "casino-credits" && data.mode === "reset") {
      // Match the casino's state -> account lock order, including first-ever play.
      await sql`INSERT INTO game_states(user_id,game_id,data) VALUES(${targetId},'casino',${sql.json(JSON.parse(JSON.stringify(newCasino())) as JSONValue)}) ON CONFLICT DO NOTHING`;
      const [state] =
        await sql`SELECT data FROM game_states WHERE user_id=${targetId} AND game_id='casino' FOR UPDATE`;
      const rounds = state.data as {
        blackjack?: { phase: string };
        mines?: { phase: string };
        poker?: { phase: string };
      };
      if (
        [rounds.blackjack, rounds.mines, rounds.poker].some(
          (round) => round?.phase === "playing",
        )
      )
        fail(
          409,
          "Finish all active casino hands before resetting the balance",
        );
    }
    const opening =
      data.mode === "grant" && data.currency === "casino-credits" ? 1000 : 0;
    const inserted =
      await sql`INSERT INTO currency_accounts(user_id,currency,balance) VALUES(${targetId},${data.currency},${opening}) ON CONFLICT DO NOTHING RETURNING balance`;
    if (inserted.length && opening)
      await sql`INSERT INTO currency_ledger(user_id,currency,amount,balance_after,reason,reference_id) VALUES(${targetId},${data.currency},${opening},${opening},'opening fictional credits',${data.operationId})`;
    const [account] =
      await sql`SELECT balance FROM currency_accounts WHERE user_id=${targetId} AND currency=${data.currency} FOR UPDATE`;
    // New poker stakes acquire the same wallet lock before opening an escrow.
    // Check after taking it, so reset cannot race a table's committed buy-in.
    if (
      data.currency === "casino-credits" &&
      data.mode === "reset" &&
      (
        await sql`SELECT 1 FROM casino_poker_escrows WHERE user_id=${targetId} AND status='active'
          UNION ALL SELECT 1 FROM casino_poker_table_seats WHERE user_id=${targetId} AND status='active' LIMIT 1`
      ).length
    )
      fail(
        409,
        "Finish the active multiplayer poker hand before resetting the balance",
      );
    const balanceBefore = Number(account.balance);
    const balanceAfter =
      data.mode === "grant" ? balanceBefore + data.amount : 0;
    if (balanceAfter > 1000000000000)
      fail(400, "Currency balance limit reached");
    const delta = balanceAfter - balanceBefore;
    if (delta !== 0) {
      await sql`UPDATE currency_accounts SET balance=${balanceAfter} WHERE user_id=${targetId} AND currency=${data.currency}`;
      await sql`INSERT INTO currency_ledger(user_id,currency,amount,balance_after,reason,reference_id)
        VALUES(${targetId},${data.currency},${delta},${balanceAfter},${"administrator " + data.mode},${data.operationId})`;
    }
    await audit(
      sql,
      actor,
      "currency." + data.mode,
      { request, balanceBefore, balanceAfter, delta },
      target,
      data.operationId,
    );
    return { ok: true, balance: balanceAfter };
  });
}

const confirmedOperation = z.object({
  operationId: z.string().uuid(),
  confirmation: z.string().max(200),
  reason: z.string().trim().min(5).max(240),
});
type OperationRequest = Record<string, string | number>;
async function previousOperation(
  sql: TransactionSql,
  actor: Actor,
  operationId: string,
  action: string,
  request: OperationRequest,
  targetId: string | null = null,
  matchTarget = true,
) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${operationId},0))`;
  const [previous] =
    await sql`SELECT actor_id,target_id,action,details FROM admin_audit_log WHERE id=${operationId}`;
  if (!previous) return null;
  const saved = previous.details.request as OperationRequest | undefined;
  if (
    previous.actor_id !== actor.id ||
    (matchTarget && previous.target_id !== targetId) ||
    previous.action !== action ||
    !saved ||
    Object.keys(saved).length !== Object.keys(request).length ||
    Object.keys(request).some((key) => request[key] !== saved[key])
  )
    fail(409, "This operation ID was already used for a different change");
  return previous.details as Details;
}
function leaderboardScope(input: unknown) {
  const data = parse(
    z
      .object({
        gameId: z.string().max(80),
        category: z.string().regex(/^[a-z0-9-]{1,40}$/),
        period: z.enum(["all", "daily", "weekly"]),
        periodKey: z.string().max(10),
      })
      .strict(),
    input,
  );
  if (
    !gameById(data.gameId)?.ranked ||
    !leaderboardCategories[data.gameId]?.includes(data.category)
  )
    fail(400, "Choose a supported ranked game and leaderboard category");
  if (data.period === "all") {
    if (data.periodKey !== "all")
      fail(400, "All-time leaderboards use the key all");
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.periodKey))
      fail(400, "Choose a valid UTC leaderboard date");
    const date = new Date(data.periodKey + "T00:00:00.000Z");
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== data.periodKey
    )
      fail(400, "Choose a valid UTC leaderboard date");
    if (data.period === "weekly" && date.getUTCDay() !== 1)
      fail(400, "Weekly leaderboard keys must be Mondays in UTC");
  }
  return data;
}
async function resetLeaderboard(actor: Actor, input: Record<string, unknown>) {
  const data = parse(
    confirmedOperation
      .extend({
        gameId: z.string().max(80),
        category: z.string().max(40),
        period: z.enum(["all", "daily", "weekly"]),
        periodKey: z.string().max(10),
      })
      .strict(),
    input,
  );
  const scope = leaderboardScope({
    gameId: data.gameId,
    category: data.category,
    period: data.period,
    periodKey: data.periodKey,
  });
  const expected = `RESET LEADERBOARD ${scope.gameId} ${scope.category} ${scope.period} ${scope.periodKey}`;
  if (data.confirmation !== expected)
    fail(400, "Type the exact leaderboard confirmation shown");
  return db.begin(async (sql) => {
    const request = { ...scope, reason: data.reason };
    const previous = await previousOperation(
      sql,
      actor,
      data.operationId,
      "leaderboard.reset",
      request,
    );
    if (previous)
      return {
        ok: true,
        replayed: true,
        deletedCount: Number(previous.deletedCount),
      };
    await captureLeaderboardReset(sql, scope);
    const removed =
      await sql`DELETE FROM leaderboard_entries WHERE game_id=${scope.gameId} AND category=${scope.category} AND period=${scope.period} AND period_key=${scope.periodKey} RETURNING user_id`;
    await audit(
      sql,
      actor,
      "leaderboard.reset",
      { request, deletedCount: removed.length },
      undefined,
      data.operationId,
    );
    return { ok: true, deletedCount: removed.length };
  });
}
async function resetCasualSave(
  actor: Actor,
  targetId: string,
  input: Record<string, unknown>,
) {
  const data = parse(
    confirmedOperation.extend({ gameId: z.string().max(80) }).strict(),
    input,
  );
  const game = gameById(data.gameId);
  // Ego's ranked records are separate from its existing casual SDK campaign save.
  if (
    !game ||
    (game.ranked && game.id !== "ego-trip") ||
    !game.permissions.includes("saves.write")
  )
    fail(
      400,
      "Only casual cloud saves can be reset here; authoritative progression and Casino are preserved",
    );
  return db.begin(async (sql) => {
    const request = { gameId: game.id, reason: data.reason };
    const previous = await previousOperation(
      sql,
      actor,
      data.operationId,
      "save.reset",
      request,
      targetId,
    );
    if (previous)
      return {
        ok: true,
        replayed: true,
        revision: Number(previous.revisionAfter),
      };
    const target = await targetAccount(sql, actor, targetId);
    if (data.confirmation !== `RESET SAVE ${game.id} ${target.username}`)
      fail(400, "Type the exact save confirmation shown");
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`${targetId}:${game.id}:save`}))`;
    const [before] =
      await sql`SELECT revision,schema_version,octet_length(data::text) AS bytes FROM game_saves WHERE user_id=${targetId} AND game_id=${game.id} FOR UPDATE`;
    // Keep a revision-bearing tombstone so a tab with an old save cannot undo reset.
    const [after] =
      await sql`INSERT INTO game_saves(user_id,game_id,schema_version,data) VALUES(${targetId},${game.id},${game.saveSchemaVersion},'null'::jsonb)
      ON CONFLICT(user_id,game_id) DO UPDATE SET data='null'::jsonb,schema_version=EXCLUDED.schema_version,revision=game_saves.revision+1,updated_at=now() RETURNING revision`;
    await audit(
      sql,
      actor,
      "save.reset",
      {
        request,
        revisionBefore: Number(before?.revision ?? 0),
        revisionAfter: Number(after.revision),
        bytesBefore: Number(before?.bytes ?? 0),
      },
      target,
      data.operationId,
    );
    return { ok: true, revision: Number(after.revision) };
  });
}
async function removeContent(actor: Actor, input: Record<string, unknown>) {
  const data = parse(
    confirmedOperation
      .extend({
        kind: z.enum(["chat-message", "public-creation"]),
        id: z.string().uuid(),
      })
      .strict(),
    input,
  );
  const action = "content.remove." + data.kind;
  const expected = `REMOVE ${data.kind === "chat-message" ? "MESSAGE" : "CREATION"} ${data.id}`;
  if (data.confirmation !== expected)
    fail(400, "Type the exact removal confirmation shown");
  const result = await db.begin(async (sql) => {
    const request = { kind: data.kind, id: data.id, reason: data.reason };
    // Content IDs are the retry scope; account IDs are recorded separately below.
    const previous = await previousOperation(
      sql,
      actor,
      data.operationId,
      action,
      request,
      null,
      false,
    );
    if (previous)
      return {
        ok: true,
        replayed: true,
        roomId: typeof previous.roomId === "string" ? previous.roomId : null,
        authorId:
          typeof previous.authorId === "string" ? previous.authorId : null,
      };
    if (data.kind === "chat-message") {
      const [message] =
        await sql`SELECT id,room_id,author_id,deleted_at FROM chat_messages WHERE id=${data.id} FOR UPDATE`;
      if (!message) fail(404, "Message not found");
      const [target] =
        await sql`SELECT id,username,role,disabled FROM users WHERE id=${message.author_id}`;
      if (!target) fail(404, "Message author not found");
      const [attachments] =
        await sql`SELECT count(*)::integer AS count FROM chat_attachments WHERE message_id=${data.id}`;
      await sql`UPDATE chat_messages SET content='',deleted_at=coalesce(deleted_at,now()) WHERE id=${data.id}`;
      await sql`DELETE FROM chat_reactions WHERE message_id=${data.id}`;
      await sql`DELETE FROM chat_pins WHERE message_id=${data.id}`;
      await sql`DELETE FROM chat_polls WHERE message_id=${data.id}`;
      await sql`INSERT INTO storage_cleanup_jobs(storage_key) SELECT storage_key FROM chat_attachments WHERE message_id=${data.id} ON CONFLICT DO NOTHING`;
      await sql`DELETE FROM chat_attachments WHERE message_id=${data.id}`;
      await audit(
        sql,
        actor,
        action,
        {
          request,
          roomId: message.room_id,
          authorId: message.author_id,
          attachmentCount: attachments.count,
          alreadyDeleted: message.deleted_at !== null,
        },
        target as Target,
        data.operationId,
      );
      return {
        ok: true,
        roomId: String(message.room_id),
        authorId: String(message.author_id),
      };
    }
    const [creation] =
      await sql`SELECT id,owner_id,version FROM creations WHERE id=${data.id} AND published=true FOR UPDATE`;
    if (!creation) fail(404, "Public creation not found");
    const [target] =
      await sql`SELECT id,username,role,disabled FROM users WHERE id=${creation.owner_id}`;
    if (!target) fail(404, "Creator not found");
    await sql`DELETE FROM creations WHERE id=${data.id}`;
    await audit(
      sql,
      actor,
      action,
      { request, version: creation.version },
      target as Target,
      data.operationId,
    );
    return { ok: true, roomId: null, authorId: null };
  });
  if (data.kind === "chat-message") {
    if (result.roomId && result.authorId)
      await publishEvent({
        type: "chat:message:delete",
        roomId: result.roomId,
        payload: { id: data.id, authorId: result.authorId },
      });
    requestStorageCleanup();
  }
  return { ok: true, replayed: "replayed" in result && result.replayed };
}

export const handleAdmin: ApiHandler = async (
  path,
  method,
  { user, request },
  input,
) => {
  if (path[0] === "announcements" && method === "GET")
    return await db`SELECT id,title,body,created_at FROM announcements ORDER BY created_at DESC LIMIT 30`;
  if (path[0] === "flags" && method === "GET")
    return Object.fromEntries(
      (await db`SELECT key,enabled FROM platform_flags`).map((row) => [
        row.key,
        row.enabled,
      ]),
    );
  if (path[0] === "errors" && method === "POST") {
    const data = parse(
      z
        .object({ component: z.string().max(80), message: z.string().max(300) })
        .strict(),
      input,
    );
    await db`INSERT INTO error_reports VALUES (${randomUUID()},${user.id},${data.component},${data.message},now())`;
    return { ok: true };
  }
  if (path[0] !== "admin") return;
  const actor = await administrator(user.id);
  if (path[1] === "seasons")
    return handleAdminSeasons(path, method, { user, request }, input);
  if (path[1] === "creator-reports")
    return handleCreatorReports(user.id, method, path[2], input);
  if (path[1] === "leaderboards") {
    if (method === "POST" && path[2] === "reset")
      return resetLeaderboard(actor, input);
    if (method === "GET" && !path[2]) {
      const today = new Date();
      const monday = new Date(today);
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      return {
        games: games
          .filter((game) => game.ranked && leaderboardCategories[game.id])
          .map((game) => ({
            id: game.id,
            name: game.name,
            categories: leaderboardCategories[game.id],
          })),
        currentKeys: {
          all: "all",
          daily: today.toISOString().slice(0, 10),
          weekly: monday.toISOString().slice(0, 10),
        },
        scopes:
          await db`SELECT game_id AS "gameId",category,period,period_key AS "periodKey",count(*)::integer AS entries FROM leaderboard_entries GROUP BY game_id,category,period,period_key ORDER BY game_id,category,period,period_key DESC LIMIT 200`,
      };
    }
    fail(404, "Administrator endpoint not found");
  }
  if (path[1] === "content" && path[2] === "remove" && method === "POST")
    return removeContent(actor, input);
  if (path[1] === "status" && method === "GET") {
    await db`SELECT 1`;
    const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
    });
    redis.on("error", () => {});
    let redisOk = false;
    try {
      redisOk = (await redis.ping()) === "PONG";
    } catch {
      /* reported in response */
    } finally {
      redis.disconnect();
    }
    const [totals] =
      await db`SELECT (SELECT count(*) FROM users) AS users,(SELECT count(*) FROM sessions WHERE expires_at>now()) AS sessions`;
    return {
      operations: await operationalStatus(),
      database: "healthy",
      redis: redisOk ? "healthy" : "unavailable",
      totals,
      flags: await db`SELECT * FROM platform_flags`,
      errors:
        await db`SELECT id,component,message,created_at FROM error_reports ORDER BY created_at DESC LIMIT 30`,
    };
  }
  if (path[1] === "audit" && method === "GET")
    return db`SELECT id,actor_username,target_username,action,details,created_at FROM admin_audit_log ORDER BY created_at DESC LIMIT 100`;
  if (path[1] === "users" && method === "GET") {
    if (path[2]) {
      const targetId = parse(z.string().uuid(), path[2]);
      const [target] =
        await db`SELECT id,username,display_name,role,disabled FROM users WHERE id=${targetId}`;
      if (!target) fail(404, "User not found");
      return {
        ...target,
        ...(await storageUsage(db, targetId)),
        balances: (
          await db`SELECT currency,balance FROM currency_accounts WHERE user_id=${targetId} ORDER BY currency`
        ).map((row) => ({
          currency: row.currency,
          balance: Number(row.balance),
        })),
        ledger: (
          await db`SELECT id,currency,amount,balance_after,reason,created_at FROM currency_ledger WHERE user_id=${targetId} ORDER BY created_at DESC LIMIT 20`
        ).map((row) => ({
          ...row,
          amount: Number(row.amount),
          balance_after: Number(row.balance_after),
        })),
        saves:
          await db`SELECT game_id,schema_version,revision,octet_length(data::text) AS bytes,updated_at FROM game_saves WHERE user_id=${targetId} ORDER BY game_id`,
      };
    }
    const query =
      new URL(request.url).searchParams.get("q")?.trim().slice(0, 80) ?? "";
    return db`SELECT id,username,display_name,role,disabled,created_at FROM users WHERE username ILIKE ${"%" + query + "%"} OR display_name ILIKE ${"%" + query + "%"} ORDER BY created_at DESC LIMIT 100`;
  }
  if (path[1] === "users" && path[2] && method === "POST") {
    const targetId = parse(z.string().uuid(), path[2]);
    if (path[3] === "currency") return changeCurrency(actor, targetId, input);
    if (path[3] === "save-reset")
      return resetCasualSave(actor, targetId, input);
    if (path[3] === "quota") {
      const data = parse(
        z
          .object({
            quotaBytes: z
              .number()
              .int()
              .min(MIN_STORAGE_QUOTA)
              .max(MAX_STORAGE_QUOTA)
              .nullable(),
            confirmation: z.string().max(80),
            reason: z.string().trim().min(5).max(240),
          })
          .strict(),
        input,
      );
      return db.begin(async (sql) => {
        await sql`SELECT id FROM users WHERE id=${targetId} FOR UPDATE`;
        const target = await targetAccount(sql, actor, targetId);
        if (data.confirmation !== `QUOTA ${target.username}`)
          fail(400, "Type QUOTA followed by the username");
        const before = await storageUsage(sql, targetId);
        if (data.quotaBytes !== null && data.quotaBytes < before.usageBytes)
          fail(409, "The new quota cannot be smaller than the stored files");
        if (data.quotaBytes === null)
          await sql`DELETE FROM user_storage_quotas WHERE user_id=${targetId}`;
        else
          await sql`INSERT INTO user_storage_quotas(user_id,quota_bytes) VALUES(${targetId},${data.quotaBytes}) ON CONFLICT(user_id) DO UPDATE SET quota_bytes=EXCLUDED.quota_bytes,updated_at=now()`;
        const after = await storageUsage(sql, targetId);
        if (after.quotaBytes < after.usageBytes)
          fail(409, "The default quota is smaller than the stored files");
        await audit(
          sql,
          actor,
          "storage.quota",
          {
            before: before.quotaBytes,
            after: after.quotaBytes,
            usageBytes: before.usageBytes,
            reason: data.reason,
            customQuota: after.customQuota,
          },
          target,
        );
        return { ok: true, ...after };
      });
    }
    if (path[3]) fail(404, "Administrator endpoint not found");
    const data = parse(
      z
        .object({ disabled: z.boolean(), confirmation: z.string().max(80) })
        .strict(),
      input,
    );
    if (targetId === actor.id) fail(400, "You cannot disable your own account");
    return db.begin(async (sql) => {
      await sql`SELECT id FROM users WHERE id=${targetId} FOR UPDATE`;
      const target = await targetAccount(sql, actor, targetId);
      if (target.role === "owner")
        fail(403, "Cannot disable the owner account");
      const expected = `${data.disabled ? "DISABLE" : "ENABLE"} ${target.username}`;
      if (data.confirmation !== expected) fail(400, "Type " + expected);
      await sql`UPDATE users SET disabled=${data.disabled} WHERE id=${targetId}`;
      if (data.disabled)
        await sql`DELETE FROM sessions WHERE user_id=${targetId}`;
      await audit(
        sql,
        actor,
        data.disabled ? "account.disable" : "account.enable",
        { disabled: data.disabled },
        target,
      );
      return { ok: true };
    });
  }
  if (path[1] === "flags" && method === "POST") {
    const data = parse(
      z
        .object({
          key: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
          enabled: z.boolean(),
        })
        .strict(),
      input,
    );
    return db.begin(async (sql) => {
      await sql`INSERT INTO platform_flags VALUES (${data.key},${data.enabled}) ON CONFLICT (key) DO UPDATE SET enabled=EXCLUDED.enabled`;
      await audit(sql, actor, "feature.flag", data);
      return data;
    });
  }
  if (path[1] === "announcements" && method === "POST") {
    const data = parse(
      z
        .object({
          title: z.string().min(1).max(120),
          body: z.string().min(1).max(5000),
        })
        .strict(),
      input,
    );
    return db.begin(async (sql) => {
      const [row] =
        await sql`INSERT INTO announcements VALUES (${randomUUID()},${actor.id},${data.title},${data.body},now()) RETURNING *`;
      await audit(sql, actor, "announcement.publish", {
        announcementId: row.id,
        title: data.title,
      });
      return row;
    });
  }
  fail(404, "Administrator endpoint not found");
};
