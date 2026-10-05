import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { getSession } from "@tell-aviv/auth";
import { db, getUser } from "@tell-aviv/database";
import { ApiError, type User } from "@tell-aviv/shared";
import {
  authorizeRoom,
  usersBlocked,
} from "../../../packages/platform/src/social";
import {
  eventChannel,
  presenceKey,
  type DomainEvent,
  type Presence,
} from "./events";
import {
  GameError,
  multiplayerGameIds,
  playerLimits,
  type DeductionState,
} from "./engines";
import { LobbyStore } from "./store";
import { QueueStore, queueOptionsSchema } from "./queue";
import { effectivePresenceStatus } from "./presence-policy";
import { catalogGameId } from "./availability";
import { desktopAllowed } from "../../../packages/shared/src/notification-policy";
import { createRealtimeMetrics } from "./metrics";
import { WorkerFence } from "./workerFence";
import {
  failureCode,
  safeSqlState,
} from "../../../packages/platform/src/safeFailure";
import {
  metricsAuthorized,
  persistRealtimeMetrics,
  renderMetrics,
  sanitizedMetricSnapshot,
} from "../../../packages/platform/src/metricsExporter";

interface SocketData {
  user: User;
  authRequest: Request;
  rooms: Set<string>;
  lastActivityAt?: number;
}
interface ClientEvents {
  [event: string]: (input: unknown, ack?: (response: unknown) => void) => void;
}
interface ServerEvents {
  [event: string]: (payload: unknown) => void;
}
type ClientSocket = Socket<
  ClientEvents,
  ServerEvents,
  Record<string, never>,
  SocketData
>;
const roomSchema = z.object({
  roomId: z.union([z.string().uuid(), z.literal("global")]),
});
const gameIdSchema = z.enum(multiplayerGameIds);
const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z2-9]{6}$/);
const empty = z.object({}).passthrough();
const userConnections = (id: string) => `tell-aviv:connections:${id}`;
function socketRequest(socket: Socket, appUrl: string) {
  return new Request(appUrl, {
    headers: { cookie: socket.handshake.headers.cookie ?? "" },
  });
}
function safeError(error: unknown) {
  if (error instanceof z.ZodError)
    return error.issues.map((e) => e.message).join("; ");
  if (error instanceof GameError || error instanceof ApiError)
    return error.message;
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      component: "realtime",
      correlationId: randomUUID(),
      fingerprint: failureCode(error),
      sqlState: safeSqlState(error),
    }),
  );
  return "Service temporarily unavailable";
}
export async function startRealtime() {
  const metrics = createRealtimeMetrics();
  if (!process.env.REDIS_URL)
    throw new Error("REDIS_URL is required; start the Redis service first");
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const origins = new Set([
    new URL(appUrl).origin,
    ...(process.env.REALTIME_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ]);
  const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 }),
    subscriber = redis.duplicate();
  redis.on("error", () => undefined);
  subscriber.on("error", () => undefined);
  await redis.ping();
  await db`SELECT 1`;
  const http = createServer(async (request, response) => {
    if (request.url === "/metrics" && request.method === "GET") {
      if (
        !metricsAuthorized(
          typeof request.headers.authorization === "string"
            ? request.headers.authorization
            : null,
        )
      ) {
        response.writeHead(401, { "Cache-Control": "no-store" });
        response.end("Metrics authorization required\n");
        return;
      }
      const snapshot = metrics.snapshot(
        io.sockets.sockets.size,
        new Set(
          [...io.sockets.sockets.values()].map((socket) => socket.data.user.id),
        ).size,
      );
      response.writeHead(200, {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        renderMetrics(
          [
            {
              service: "realtime",
              snapshot: sanitizedMetricSnapshot("realtime", snapshot),
              ageSeconds: 0,
            },
          ],
          {
            worker_healthy: Number(!leaseLost),
            realtime_process_memory_bytes: process.memoryUsage().rss,
          },
        ),
      );
      return;
    }
    if (request.url !== "/health") {
      response.writeHead(404);
      response.end();
      return;
    }
    let ok = !leaseLost;
    await Promise.allSettled([
      redis.ping().catch(() => {
        ok = false;
        metrics.increment("redisProbeFailures");
      }),
      db`SELECT 1`.catch(() => {
        ok = false;
        metrics.increment("databaseProbeFailures");
      }),
    ]);
    response.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        ok,
        service: "realtime",
        metrics: metrics.snapshot(
          io.sockets.sockets.size,
          new Set(
            [...io.sockets.sockets.values()].map(
              (socket) => socket.data.user.id,
            ),
          ).size,
        ),
      }),
    );
  });
  const io = new Server<
    ClientEvents,
    ServerEvents,
    Record<string, never>,
    SocketData
  >(http, {
    cors: { origin: [...origins], credentials: true },
    maxHttpBufferSize: 32_768,
    transports: ["polling", "websocket"],
    pingInterval: 25_000,
    pingTimeout: 20_000,
    allowRequest: (request, callback) =>
      callback(
        null,
        !!request.headers.origin && origins.has(request.headers.origin),
      ),
  });
  const store = new LobbyStore(redis);
  const queue = new QueueStore(store, (userId) =>
    [...io.sockets.sockets.values()].some(
      (socket) => socket.data.user.id === userId,
    ),
  );
  const workerToken = randomUUID(),
    workerKey = `${store.namespace}:realtime-worker`;
  let acquired = false;
  for (let attempt = 0; attempt < 24 && !acquired; attempt++) {
    acquired = !!(await redis.set(workerKey, workerToken, "PX", 5000, "NX"));
    if (!acquired) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!acquired) {
    await subscriber.quit();
    await redis.quit();
    await db.end();
    throw new Error("A realtime worker already owns this namespace");
  }
  let leaseLost = false;
  const workerLease = setInterval(() => {
    void redis
      .eval(
        "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],5000) else return 0 end",
        1,
        workerKey,
        workerToken,
      )
      .then((kept) => {
        if (!kept) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      });
  }, 1000);
  const workerSocketsKey = `${store.namespace}:worker-sockets`;
  try {
    store.workerFence = await WorkerFence.acquire(
      redis,
      store.namespace,
      workerToken,
    );
    // The expired owner cannot keep a reconnected user's old socket alive.
    // Walk only this namespace's registry; other workers' socket IDs are preserved.
    let cursor = "0";
    do {
      const [next, entries] = await redis.hscan(
        workerSocketsKey,
        cursor,
        "COUNT",
        100,
      );
      cursor = next;
      const cleanup = redis.pipeline();
      for (let i = 0; i < entries.length; i += 2) {
        cleanup.zrem(userConnections(entries[i + 1]), entries[i]);
        cleanup.zrem(`tell-aviv:activity:${entries[i + 1]}`, entries[i]);
      }
      if (entries.length) await cleanup.exec();
    } while (cursor !== "0");
    await redis.del(workerSocketsKey);
    await store.initializeRecovery();
    await queue.recover();
  } catch (error) {
    clearInterval(workerLease);
    await redis
      .eval(
        "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        workerKey,
        workerToken,
      )
      .catch(() => undefined);
    await subscriber.quit();
    await redis.quit();
    io.close();
    throw error;
  }
  const disconnectJobs = new Set<Promise<void>>();
  io.use(async (socket, next) => {
    try {
      const request = socketRequest(socket, appUrl),
        user = await getSession(request);
      if (!user) {
        next(new Error("Sign in required"));
        return;
      }
      socket.data = { user, authRequest: request, rooms: new Set() };
      next();
    } catch {
      next(new Error("Authentication unavailable"));
    }
  });
  async function session(socket: ClientSocket) {
    const user = await getSession(socket.data.authRequest);
    if (!user || user.id !== socket.data.user.id) {
      socket.disconnect(true);
      throw new GameError("Session expired; sign in again");
    }
    socket.data.user = user;
    return user;
  }
  async function visiblePresence(viewerId: string, subjectId: string) {
    if (viewerId !== subjectId) {
      if (await usersBlocked(viewerId, subjectId))
        return { userId: subjectId, status: "offline" };
      const friends =
        await db`SELECT 1 FROM friendships WHERE (user_low=${viewerId} AND user_high=${subjectId}) OR (user_high=${viewerId} AND user_low=${subjectId})`;
      if (!friends.length) return null;
    }
    const user = await getUser(subjectId);
    if (!user) return null;
    const raw = await redis.get(presenceKey(subjectId)),
      presence = raw ? (JSON.parse(raw) as Presence) : null;
    const desired = user.settings.presence;
    if (!presence || (desired === "invisible" && viewerId !== subjectId))
      return { userId: subjectId, status: "offline" };
    const privacy = user.settings.privacy as
      Record<string, unknown> | undefined;
    return {
      userId: subjectId,
      status: effectivePresenceStatus(desired, presence.lastActivityAt),
      ...(privacy?.showActivity === false && viewerId !== subjectId
        ? {}
        : {
            gameId: presence.gameId,
            mode: presence.mode,
            lobbyCode: presence.lobbyCode,
            joinable: presence.joinable,
            since: presence.since,
          }),
    };
  }
  async function broadcastPresence(subjectId: string) {
    for (const socket of io.sockets.sockets.values()) {
      const view = await visiblePresence(socket.data.user.id, subjectId);
      if (view) socket.emit("presence:update", view);
    }
  }
  async function heartbeat(socket: ClientSocket) {
    const user = await session(socket),
      now = Date.now();
    await redis.zadd(userConnections(user.id), now + 90_000, socket.id);
    await redis.expire(userConnections(user.id), 100);
    await redis.hset(workerSocketsKey, socket.id, user.id);
    await redis.expire(workerSocketsKey, 150);
    socket.data.lastActivityAt ??= now;
    const activityKey = `tell-aviv:activity:${user.id}`;
    await redis.zadd(activityKey, socket.data.lastActivityAt, socket.id);
    await redis.expire(activityKey, 100);
    await redis.zremrangebyscore(userConnections(user.id), "-inf", now);
    const connected = new Set(
      await redis.zrange(userConnections(user.id), 0, -1),
    );
    const activity = await redis.zrevrange(activityKey, 0, -1, "WITHSCORES");
    let lastActivityAt = socket.data.lastActivityAt;
    for (let index = 0; index < activity.length; index += 2)
      if (connected.has(activity[index]))
        lastActivityAt = Math.max(lastActivityAt, Number(activity[index + 1]));
    const oldRaw = await redis.get(presenceKey(user.id)),
      old = oldRaw ? (JSON.parse(oldRaw) as Presence) : null;
    const status = effectivePresenceStatus(
      user.settings.presence,
      lastActivityAt,
      now,
    );
    const lobby = await store.current(user.id);
    const presence: Presence = {
      ...old,
      status,
      since: old?.since ?? now,
      updatedAt: now,
      lastActivityAt,
      lobbyActive: !!lobby,
      ...(lobby
        ? {
            gameId: catalogGameId(lobby.gameId),
            lobbyCode: lobby.visibility === "public" ? lobby.code : undefined,
            joinable:
              lobby.visibility === "public" && lobby.status !== "playing",
          }
        : {}),
    };
    if (!lobby && old?.lobbyActive) {
      delete presence.lobbyCode;
      delete presence.gameId;
      delete presence.joinable;
    }
    await redis.set(presenceKey(user.id), JSON.stringify(presence), "EX", 90);
    if (
      !old ||
      old.status !== presence.status ||
      old.lobbyCode !== presence.lobbyCode
    )
      await redis.publish(
        eventChannel,
        JSON.stringify({
          type: "presence:changed",
          userIds: [user.id],
          payload: { userId: user.id },
        }),
      );
    return visiblePresence(user.id, user.id);
  }
  async function broadcastLobby(code: string) {
    const lobby = await store.get(code);
    if (!lobby) return;
    for (const socket of io.sockets.sockets.values())
      if (lobby.players.some((p) => p.id === socket.data.user.id)) {
        try {
          await session(socket);
          socket.emit(
            "game:lobby:state",
            store.view(lobby, socket.data.user.id),
          );
        } catch {
          /* Invalid sessions have been disconnected. */
        }
      }
  }
  async function partyRecovery(userId: string) {
    const [party] =
      await db`SELECT p.* FROM parties p JOIN party_members m ON m.party_id=p.id WHERE m.user_id=${userId}`;
    if (!party) return null;
    const members =
      await db`SELECT u.id,u.username,u.display_name AS "displayName",u.avatar,m.ready FROM party_members m JOIN users u ON u.id=m.user_id WHERE m.party_id=${party.id} ORDER BY m.joined_at`;
    return {
      id: party.id,
      leaderId: party.leader_id,
      gameId: party.game_id,
      launchedAt: party.launched_at,
      members,
    };
  }
  await subscriber.subscribe(eventChannel);
  subscriber.on("message", (_channel, raw) => {
    void (async () => {
      const event = JSON.parse(raw) as DomainEvent;
      if (event.type === "lobby:changed") {
        const payload = event.payload as { code: string; namespace?: string };
        if ((payload.namespace ?? "tell-aviv") !== store.namespace) return;
        await broadcastLobby(payload.code);
        return;
      }
      if (event.type === "queue:changed") {
        const payload = event.payload as { namespace?: string };
        if (payload.namespace !== store.namespace) return;
        for (const socket of io.sockets.sockets.values())
          if (event.userIds?.includes(socket.data.user.id)) {
            try {
              await session(socket);
              socket.emit(
                "game:queue:state",
                await queue.status(socket.data.user.id),
              );
              const current = await store.current(socket.data.user.id);
              socket.emit(
                "game:lobby:state",
                current ? store.view(current, socket.data.user.id) : null,
              );
            } catch {
              /* Stale sessions are disconnected by session(). */
            }
          }
        return;
      }
      if (event.type === "presence:changed") {
        for (const userId of event.userIds ?? [])
          await broadcastPresence(userId);
        return;
      }
      if (event.type === "casino:market:changed") {
        for (const socket of io.sockets.sockets.values()) {
          try {
            await session(socket);
            socket.emit("casino:market:changed", { refresh: true });
          } catch {}
        }
        return;
      }
      if (event.type === "chat:typing") {
        const subjectId = (event.payload as { userId?: string })?.userId;
        if (
          subjectId &&
          (await getUser(subjectId))?.settings.presence === "invisible"
        )
          return;
      }
      if (!event.roomId && !event.userIds) return;
      for (const socket of io.sockets.sockets.values()) {
        if (event.userIds && !event.userIds.includes(socket.data.user.id))
          continue;
        try {
          await session(socket);
        } catch {
          continue;
        }
        if (event.roomId) {
          if (!socket.data.rooms.has(event.roomId)) continue;
          try {
            await authorizeRoom(socket.data.user.id, event.roomId);
          } catch {
            socket.data.rooms.delete(event.roomId);
            continue;
          }
          const payload = event.payload as {
            authorId?: string;
            author_id?: string;
            userId?: string;
            id?: string;
            messageId?: string;
          };
          let authorId = payload?.authorId ?? payload?.author_id;
          const messageId = payload?.messageId ?? payload?.id;
          if (!authorId && messageId && event.type.startsWith("chat:")) {
            const [message] =
              await db`SELECT author_id FROM chat_messages WHERE id=${messageId} AND room_id=${event.roomId}`;
            authorId = message?.author_id;
          }
          let hidden = false;
          for (const subject of [authorId, payload?.userId].filter(
            (id): id is string => !!id,
          ))
            if (
              subject !== socket.data.user.id &&
              (await usersBlocked(socket.data.user.id, subject))
            )
              hidden = true;
          if (hidden) continue;
        }
        if (
          event.type === "notification:create" &&
          event.payload &&
          typeof event.payload === "object"
        ) {
          const receiver = socket.data.user;
          const preferences = receiver.settings.notifications as
            Record<string, boolean> | undefined;
          const kind = (event.payload as { kind?: unknown }).kind;
          socket.emit(event.type, {
            ...event.payload,
            desktopSuppressed: !desktopAllowed(
              {
                enabled: preferences?.desktop_enabled === true,
                focusMode: receiver.settings.focusMode === true,
                status: String(receiver.settings.presence ?? "online"),
                preferences: preferences ?? {},
              },
              typeof kind === "string" ? kind : "",
              false,
            ),
          });
        } else socket.emit(event.type, event.payload);
      }
    })().catch((e) => console.error("Realtime delivery failed:", safeError(e)));
  });
  io.on("connection", (socket) => {
    metrics.increment("connections");
    const register = <T>(
      name: string,
      schema: z.ZodType<T>,
      handler: (input: T) => Promise<unknown>,
      max = 30,
    ) => {
      socket.on(
        name,
        async (input: unknown = {}, ack?: (response: unknown) => void) => {
          try {
            const bucket = `tell-aviv:rate:${socket.data.user.id}:${name}:${Math.floor(Date.now() / 10_000)}`;
            const count = await redis.incr(bucket);
            if (count === 1) await redis.expire(bucket, 12);
            if (count > max)
              throw new GameError("Too many requests; wait a moment");
            if (leaseLost)
              throw new GameError(
                "Realtime ownership was lost; reconnect after recovery",
              );
            await store.workerFence!.assertLease();
            await session(socket);
            const result = await handler(schema.parse(input));
            metrics.request(name, false);
            if (typeof ack === "function") ack({ data: result });
          } catch (error) {
            if (
              !(error instanceof GameError) &&
              !(error instanceof ApiError) &&
              !(error instanceof z.ZodError)
            )
              metrics.failure(error);
            metrics.request(name, true);
            const response = { error: safeError(error) };
            if (typeof ack === "function") ack(response);
            else socket.emit("service:error", response);
          }
        },
      );
    };
    const userId = socket.data.user.id;
    register(
      "presence:heartbeat",
      z
        .object({
          idleForMs: z.number().int().min(0).max(86_400_000).optional(),
        })
        .strict(),
      ({ idleForMs }) => {
        if (idleForMs !== undefined)
          socket.data.lastActivityAt = Date.now() - idleForMs;
        return heartbeat(socket);
      },
      10,
    );
    register(
      "presence:status",
      z.object({ status: z.enum(["online", "idle", "dnd", "invisible"]) }),
      async ({ status }) => {
        if (status === "online") socket.data.lastActivityAt = Date.now();
        await db`UPDATE users SET settings=jsonb_set(settings,'{presence}',to_jsonb(${status}::text)),updated_at=now() WHERE id=${userId}`;
        await heartbeat(socket);
        await broadcastPresence(userId);
        return { status };
      },
    );
    register("presence:snapshot", empty, async () => {
      const friends =
        await db`SELECT CASE WHEN user_low=${userId} THEN user_high ELSE user_low END AS id FROM friendships WHERE user_low=${userId} OR user_high=${userId}`;
      return (
        await Promise.all(
          [userId, ...friends.map((f) => f.id as string)].map((id) =>
            visiblePresence(userId, id),
          ),
        )
      ).filter(Boolean);
    });
    register("room:subscribe", roomSchema, async ({ roomId }) => {
      const room = await authorizeRoom(userId, roomId);
      if (socket.data.rooms.size >= 50)
        throw new GameError("Too many room subscriptions");
      socket.data.rooms.add(room.id);
      return { roomId: room.id };
    });
    register("room:unsubscribe", roomSchema, async ({ roomId }) => {
      socket.data.rooms.delete(roomId);
      return { ok: true };
    });
    register(
      "chat:typing:start",
      roomSchema,
      async ({ roomId }) => {
        const room = await authorizeRoom(userId, roomId, "send_messages");
        if (socket.data.user.settings.presence === "invisible")
          return { ok: true };
        await redis.publish(
          eventChannel,
          JSON.stringify({
            type: "chat:typing",
            roomId: room.id,
            payload: {
              roomId: room.id,
              userId,
              username: socket.data.user.username,
              expiresAt: Date.now() + 5000,
            },
          }),
        );
        return { ok: true };
      },
      10,
    );
    register("party:recover", empty, () => partyRecovery(userId));
    register(
      "game:queue:join",
      queueOptionsSchema,
      (options) => queue.join(socket.data.user, options),
      6,
    );
    register(
      "game:queue:leave",
      z.object({}).strict(),
      () => queue.leave(userId),
      10,
    );
    register(
      "game:queue:status",
      z.object({}).strict(),
      async () => {
        const status = await queue.status(userId);
        const current = await store.current(userId);
        socket.emit(
          "game:lobby:state",
          current ? store.view(current, userId) : null,
        );
        return status;
      },
      10,
    );
    register(
      "party:launch",
      z.object({ gameId: gameIdSchema }),
      async ({ gameId }) => {
        const party = await partyRecovery(userId);
        if (!party || party.leaderId !== userId)
          throw new GameError("Only the party leader can launch");
        if (party.members.some((m) => !m.ready))
          throw new GameError("Every party member must be ready");
        const limits = playerLimits(gameId);
        if (
          party.members.length < limits.min ||
          party.members.length > limits.max
        )
          throw new GameError(
            `This game needs ${limits.min}–${limits.max} players`,
          );
        for (const member of party.members)
          await queue.requireNotWaiting(member.id);
        for (const member of party.members)
          if (await store.current(member.id))
            throw new GameError("A party member is already in a lobby");
        for (const member of party.members) {
          await redis.zremrangebyscore(
            userConnections(member.id),
            "-inf",
            Date.now(),
          );
          if (!(await redis.zcard(userConnections(member.id))))
            throw new GameError("Every party member must be online");
        }
        const lobby = await store.create(socket.data.user, gameId, "private");
        try {
          for (const member of party.members)
            if (member.id !== userId)
              await store.join(lobby.code, {
                id: member.id,
                username: member.username,
              });
        } catch (e) {
          for (const member of party.members)
            await store.leave(member.id).catch(() => undefined);
          throw e;
        }
        await db`UPDATE parties SET game_id=${gameId},launched_at=now() WHERE id=${party.id}`;
        await broadcastLobby(lobby.code);
        return store.view((await store.get(lobby.code))!, userId);
      },
    );
    register(
      "game:lobby:create",
      z.object({
        gameId: gameIdSchema,
        visibility: z.enum(["private", "public"]).default("private"),
        coopMode: z.enum(["gauntlet", "campaign"]).default("gauntlet"),
      }),
      async ({ gameId, visibility, coopMode }) => {
        await queue.requireNotWaiting(userId);
        return store.view(
          await store.create(socket.data.user, gameId, visibility, coopMode),
          userId,
        );
      },
    );
    register(
      "game:lobby:join",
      z.object({ code: codeSchema }),
      async ({ code }) => {
        await queue.requireNotWaiting(userId);
        await queue.authorizeLobbyJoin(userId, code);
        return store.view(await store.join(code, socket.data.user), userId);
      },
    );
    register("game:lobby:recover", empty, async () => {
      const lobby = await store.current(userId);
      return lobby
        ? store.view(await store.join(lobby.code, socket.data.user), userId)
        : null;
    });
    register(
      "game:lobby:ready",
      z.object({ ready: z.boolean() }),
      async ({ ready }) => {
        await queue.authorizeReady(userId);
        return store.view(await store.ready(userId, ready), userId);
      },
    );
    register(
      "game:lobby:poker-options",
      z
        .object({
          buyIn: z.number().int().min(100).max(10000),
          persistent: z.boolean().optional(),
          minBuyIn: z.number().int().min(100).max(10000).optional(),
          maxBuyIn: z.number().int().min(100).max(10000).optional(),
        })
        .strict(),
      async ({ buyIn, ...options }) =>
        store.view(await store.pokerOptions(userId, buyIn, options), userId),
    );
    register(
      "game:lobby:poker-seat",
      z
        .object({
          amount: z.number().int().min(0).max(10000),
          sittingOut: z.boolean().optional(),
          requestId: z.string().uuid(),
        })
        .strict(),
      async (options) =>
        store.view(await store.pokerSeat(userId, options), userId),
    );
    register("game:lobby:poker-close", empty, async () =>
      store.view(await store.pokerClose(userId), userId),
    );
    register("game:lobby:start", empty, async () => {
      await queue.authorizeReady(userId);
      return store.view(await store.start(userId), userId);
    });
    register("game:lobby:leave", empty, async () => {
      const queued = await queue.status(userId);
      const current = await store.current(userId);
      if (
        queued?.status === "matched" &&
        queued.lobbyCode === current?.code &&
        current?.status !== "playing"
      )
        await queue.leave(userId);
      else await store.leave(userId);
      await heartbeat(socket);
      await queue.connected(userId);
      socket.emit("game:queue:state", await queue.status(userId));
      return { ok: true };
    });
    register(
      "game:lobby:list",
      z.object({ gameId: gameIdSchema.optional() }),
      ({ gameId }) => store.list(gameId),
    );
    register(
      "game:action",
      z.object({ type: z.string().max(40) }).passthrough(),
      async (input) => store.view(await store.action(userId, input), userId),
      120,
    );
    register(
      "game:lobby:chat",
      z.object({ text: z.string().trim().min(1).max(800) }),
      async ({ text }) => {
        const lobby = await store.required(userId);
        let audience = lobby.players.map((p) => p.id);
        if (
          lobby.status === "playing" &&
          lobby.state?.kind === "social-deduction"
        ) {
          const state = lobby.state as DeductionState,
            alive = state.players[userId].alive;
          if (alive && state.phase !== "meeting")
            throw new GameError("Living players chat during meetings");
          audience = Object.keys(state.players).filter(
            (id) => state.players[id].alive === alive,
          );
        }
        const message = {
          id: randomUUID(),
          code: lobby.code,
          userId,
          username: socket.data.user.username,
          text,
          at: Date.now(),
          createdAt: new Date().toISOString(),
        };
        await redis.publish(
          eventChannel,
          JSON.stringify({
            type: "game:lobby:chat",
            userIds: audience,
            payload: message,
          }),
        );
        return message;
      },
      15,
    );
    void (async () => {
      await heartbeat(socket);
      const lobby = await store.current(userId);
      if (lobby) {
        metrics.increment("recoveredLobbies");
        await store.join(lobby.code, socket.data.user);
        socket.emit(
          "game:lobby:state",
          store.view((await store.get(lobby.code))!, userId),
        );
      }
      socket.emit("service:ready", { userId, reconnectWindow: 60_000 });
    })().catch((e) => socket.emit("service:error", { error: safeError(e) }));
    socket.on("disconnect", () => {
      metrics.increment("disconnects");
      const job = (async () => {
        await redis.hdel(workerSocketsKey, socket.id);
        await redis.zrem(userConnections(userId), socket.id);
        await redis.zrem(`tell-aviv:activity:${userId}`, socket.id);
        await redis.zremrangebyscore(
          userConnections(userId),
          "-inf",
          Date.now(),
        );
        if (
          ![...io.sockets.sockets.values()].some(
            (remaining) => remaining.data.user.id === userId,
          )
        )
          await store.disconnected(
            userId,
            () =>
              ![...io.sockets.sockets.values()].some(
                (remaining) => remaining.data.user.id === userId,
              ),
          );
        if ((await redis.zcard(userConnections(userId))) === 0) {
          await redis.del(presenceKey(userId));
          await broadcastPresence(userId);
        }
      })().catch((e) =>
        console.error("Disconnect cleanup failed:", safeError(e)),
      );
      disconnectJobs.add(job);
      void job.then(() => disconnectJobs.delete(job));
    });
  });
  let tickInFlight: Promise<void> | null = null;
  const tick = setInterval(() => {
    if (tickInFlight || leaseLost) return;
    tickInFlight = store
      .tick()
      .then(() => queue.tick())
      .catch((e) => {
        metrics.increment("tickErrors");
        metrics.failure(e);
        console.error("Game tick failed:", safeError(e));
      })
      .finally(() => {
        tickInFlight = null;
      });
  }, 250);
  const presenceRefresh = setInterval(() => {
    for (const socket of io.sockets.sockets.values())
      void heartbeat(socket).catch((e) =>
        socket.emit("service:error", { error: safeError(e) }),
      );
  }, 30_000);
  const port = Number(process.env.REALTIME_PORT ?? 3001);
  const host = process.env.REALTIME_HOST ?? "0.0.0.0";
  await new Promise<void>((resolve) => http.listen(port, host, resolve));
  console.log(`Tell Aviv realtime listening on ${host}:${port}`);
  let metricFlush: Promise<void> | null = null;
  const metricTimer = setInterval(() => {
    if (metricFlush) return;
    metricFlush = persistRealtimeMetrics(
      metrics.snapshot(
        io.sockets.sockets.size,
        new Set(
          [...io.sockets.sockets.values()].map((socket) => socket.data.user.id),
        ).size,
      ),
    )
      .catch(() => undefined)
      .finally(() => {
        metricFlush = null;
      });
  }, 10_000);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    clearInterval(tick);
    clearInterval(workerLease);
    clearInterval(presenceRefresh);
    clearInterval(metricTimer);
    await tickInFlight;
    if (!leaseLost) await store.checkpointAll().catch(() => undefined);
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await Promise.allSettled([...disconnectJobs]);
    await metricFlush;
    await persistRealtimeMetrics(metrics.snapshot(0, 0)).catch(() => undefined);
    await redis.eval(
      "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
      1,
      workerKey,
      workerToken,
    );
    await subscriber.quit();
    await redis.quit();
    await db.end();
  };
  process.once("SIGTERM", () => {
    void close();
  });
  process.once("SIGINT", () => {
    void close();
  });
  return { io, http, redis, store, queue, close };
}
