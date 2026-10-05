import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { startRealtime } from "./server";
interface LobbyWire {
  code: string;
  status: string;
  players: unknown[];
  state: { players: Record<string, unknown>[]; result: { winners: string[] } };
}
interface PresenceWire {
  userId: string;
  status: string;
}

// Opt in against a migrated disposable development database: RUN_INTEGRATION=1.
const enabled = process.env.RUN_INTEGRATION === "1";
describe.skipIf(!enabled)("SQL/Redis/Socket.IO integration", () => {
  let service: Awaited<ReturnType<typeof startRealtime>>;
  let db: typeof import("@tell-aviv/database").db;
  const users = Array.from({ length: 4 }, () => ({
    id: randomUUID(),
    token: randomBytes(32).toString("base64url"),
    username: `test_${randomBytes(5).toString("hex")}`,
  }));
  const sockets: Socket[] = [],
    codes: string[] = [];
  const url = "http://127.0.0.1:3991",
    origin = "http://localhost:3000";
  let roomId: string;
  function connect(index?: number, requestOrigin = origin) {
    const socket = io(url, {
      withCredentials: true,
      reconnection: false,
      transports: ["polling"],
      extraHeaders: {
        Origin: requestOrigin,
        ...(index === undefined
          ? {}
          : { Cookie: `ta_session=${users[index].token}` }),
      },
    });
    sockets.push(socket);
    return new Promise<Socket>((resolve, reject) => {
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", reject);
    });
  }
  function emit<T = LobbyWire>(
    socket: Socket,
    event: string,
    input: unknown = {},
  ) {
    return new Promise<{ data: T; error?: string }>((resolve, reject) =>
      socket
        .timeout(4000)
        .emit(
          event,
          input,
          (error: Error | null, response: { data: T; error?: string }) =>
            error ? reject(error) : resolve(response),
        ),
    );
  }
  beforeAll(async () => {
    try {
      process.loadEnvFile(".env");
    } catch {
      /* Caller can provide environment directly. */
    }
    process.env.REALTIME_PORT = "3991";
    process.env.REALTIME_NAMESPACE = "tell-aviv:test:3991";
    process.env.APP_URL = origin;
    const database = await import("@tell-aviv/database");
    db = database.db;
    const { hashToken } = await import("@tell-aviv/auth");
    for (const user of users) {
      await db`INSERT INTO users(id,username,display_name) VALUES(${user.id},${user.username},${user.username})`;
      await db`INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(${randomUUID()},${user.id},${hashToken(user.token)},now()+interval '1 hour')`;
    }
    const [room] =
      await db`INSERT INTO chat_rooms(kind,name,owner_id) VALUES('group','integration test',${users[0].id}) RETURNING id`;
    roomId = room.id;
    for (const user of users.slice(0, 2))
      await db`INSERT INTO chat_members(room_id,user_id) VALUES(${roomId},${user.id})`;
    const sorted = [users[0].id, users[1].id].sort();
    await db`INSERT INTO friendships(user_low,user_high) VALUES(${sorted[0]},${sorted[1]})`;
    service = await (await import("./server")).startRealtime();
  }, 20_000);
  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (service) {
      for (const code of codes) {
        await service.redis.del(`tell-aviv:test:3991:lobby:${code}`);
        await service.redis.zrem("tell-aviv:test:3991:lobbies", code);
      }
      for (const user of users)
        await service.redis.del(
          `tell-aviv:test:3991:user-lobby:${user.id}`,
          `tell-aviv:presence:${user.id}`,
          `tell-aviv:connections:${user.id}`,
        );
    }
    if (db) {
      await db`DELETE FROM multiplayer_matches WHERE lobby_code=ANY(${codes}::varchar[])`;
      if (roomId) await db`DELETE FROM chat_rooms WHERE id=${roomId}`;
      await db`DELETE FROM users WHERE id=ANY(${users.map((u) => u.id)}::uuid[])`;
    }
    if (service) await service.close();
  });
  it("authenticates the cookie, rejects anonymous and unapproved-origin connections, and works on polling transport", async () => {
    await expect(connect()).rejects.toThrow("Sign in");
    await expect(connect(0, "https://untrusted.invalid")).rejects.toThrow();
    const socket = await connect(0);
    expect(socket.io.engine.transport.name).toBe("polling");
    const snapshot = await emit<PresenceWire[]>(socket, "presence:snapshot");
    expect(snapshot.data.some((p) => p.userId === users[0].id)).toBe(true);
  });
  it("checks room membership when subscribing and rechecks before each private delivery", async () => {
    const a = sockets.find((s) => s.connected)!,
      b = await connect(1),
      outsider = await connect(2);
    expect(
      (await emit<{ roomId: string }>(a, "room:subscribe", { roomId })).data
        .roomId,
    ).toBe(roomId);
    expect(
      (await emit<{ roomId: string }>(b, "room:subscribe", { roomId })).data
        .roomId,
    ).toBe(roomId);
    expect((await emit(outsider, "room:subscribe", { roomId })).error).toMatch(
      "membership",
    );
    await db`DELETE FROM chat_members WHERE room_id=${roomId} AND user_id=${users[1].id}`;
    let receivedByRemoved = false;
    b.once("chat:message:create", () => {
      receivedByRemoved = true;
    });
    const received = new Promise<{ content: string }>((resolve) =>
      a.once("chat:message:create", resolve),
    );
    await service.redis.publish(
      "tell-aviv:events",
      JSON.stringify({
        type: "chat:message:create",
        roomId,
        payload: { authorId: users[0].id, content: "private test" },
      }),
    );
    expect((await received).content).toBe("private test");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(receivedByRemoved).toBe(false);
  });
  it("hides invisible presence and activity from friends", async () => {
    const a = sockets.find(
      (s) =>
        s.connected &&
        s.io.opts.extraHeaders?.Cookie === `ta_session=${users[0].token}`,
    )!;
    const b = sockets.find(
      (s) =>
        s.connected &&
        s.io.opts.extraHeaders?.Cookie === `ta_session=${users[1].token}`,
    )!;
    expect(
      (await emit(a, "presence:status", { status: "invisible" })).data.status,
    ).toBe("invisible");
    const snapshot = await emit<PresenceWire[]>(b, "presence:snapshot");
    expect(snapshot.data.find((p) => p.userId === users[0].id)).toEqual({
      userId: users[0].id,
      status: "offline",
    });
  });
  it("plays a match with authoritative turns, persists outcomes, and recovers lobby membership", async () => {
    const a = sockets.find(
      (s) =>
        s.connected &&
        s.io.opts.extraHeaders?.Cookie === `ta_session=${users[0].token}`,
    )!;
    let b = sockets.find(
      (s) =>
        s.connected &&
        s.io.opts.extraHeaders?.Cookie === `ta_session=${users[1].token}`,
    )!;
    const created = await emit(a, "game:lobby:create", {
      gameId: "connect-four",
      visibility: "private",
    });
    expect(created.error).toBeUndefined();
    codes.push(created.data.code);
    expect(
      (await emit(b, "game:lobby:join", { code: created.data.code })).data
        .players,
    ).toHaveLength(2);
    await emit(a, "game:lobby:ready", { ready: true });
    await emit(b, "game:lobby:ready", { ready: true });
    await emit(a, "game:lobby:start");
    expect(
      (await emit(b, "game:action", { type: "drop", column: 0 })).error,
    ).toMatch("turn");
    b.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
    b = await connect(1);
    const rejoined = await emit(b, "game:lobby:recover");
    expect(rejoined.data.code).toBe(created.data.code);
    expect(rejoined.data.status).toBe("playing");
    for (let turn = 0; turn < 7; turn++) {
      const response = await emit(turn % 2 ? b : a, "game:action", {
        type: "drop",
        column: turn % 2 ? 1 : 0,
      });
      expect(response.error).toBeUndefined();
    }
    const recovered = await emit(a, "game:lobby:recover");
    expect(recovered.data.status).toBe("finished");
    expect(recovered.data.state.result.winners).toEqual([users[0].id]);
    const results =
      await db`SELECT r.* FROM multiplayer_results r JOIN multiplayer_matches m ON m.id=r.match_id WHERE m.lobby_code=${created.data.code}`;
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.user_id === users[0].id)?.won).toBe(true);
    const [match] =
      await db`SELECT result FROM multiplayer_matches WHERE lobby_code=${created.data.code}`;
    expect(match.result.winners).toEqual([users[0].id]);
    await emit(a, "game:lobby:leave");
    await emit(b, "game:lobby:leave");
  });
  it("keeps hidden roles and dead chat private on the wire and expires abandoned matches", async () => {
    const live = users.map((user) =>
      sockets.find(
        (s) =>
          s.connected &&
          s.io.opts.extraHeaders?.Cookie === `ta_session=${user.token}`,
      ),
    );
    for (let i = 0; i < live.length; i++)
      if (!live[i]) live[i] = await connect(i);
    const created = await emit(live[0]!, "game:lobby:create", {
      gameId: "social-deduction",
    });
    codes.push(created.data.code);
    for (let i = 1; i < live.length; i++)
      await emit(live[i]!, "game:lobby:join", { code: created.data.code });
    for (const socket of live)
      await emit(socket!, "game:lobby:ready", { ready: true });
    const started = await emit(live[0]!, "game:lobby:start");
    expect(
      started.data.state.players.every(
        (p: Record<string, unknown>) => !("role" in p) && !("tasks" in p),
      ),
    ).toBe(true);
    const lobby = await service.store.get(created.data.code);
    expect(lobby?.state?.kind).toBe("social-deduction");
    await service.store.mutate(created.data.code, (value) => {
      if (value.state?.kind === "social-deduction")
        value.state.players[users[0].id].alive = false;
    });
    expect(
      (
        await emit(live[1]!, "game:lobby:chat", {
          text: "Not during active expedition",
        })
      ).error,
    ).toMatch("meetings");
    let livingSawChat = false;
    live[1]!.once("game:lobby:chat", () => {
      livingSawChat = true;
    });
    const deadReceived = new Promise<{ text: string }>((resolve) =>
      live[0]!.once("game:lobby:chat", resolve),
    );
    await emit(live[0]!, "game:lobby:chat", { text: "Ghost channel test" });
    expect((await deadReceived).text).toBe("Ghost channel test");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(livingSawChat).toBe(false);
    await service.store.mutate(created.data.code, (value) => {
      const p = value.players[1];
      p.connected = false;
      p.disconnectedAt = Date.now() - 61_000;
    });
    await service.store.tick();
    const expired = await service.store.get(created.data.code);
    expect(expired?.status).toBe("finished");
    expect(expired?.state?.result?.reason).toBe("Reconnect window expired");
    for (const user of users) await service.store.leave(user.id);
  });
});
