import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { startRealtime } from "./server";
const enabled = process.env.RUN_INTEGRATION === "1";
type PresenceView = {
  userId: string;
  status: string;
  gameId?: string;
  since?: number;
  lastActivityAt?: number;
};
describe.skipIf(!enabled)("multi-tab idle and Invisible privacy", () => {
  let service: Awaited<ReturnType<typeof startRealtime>>;
  let db: typeof import("@tell-aviv/database").db;
  let roomId: string;
  const users = Array.from({ length: 2 }, () => ({
    id: randomUUID(),
    username: `presence_${randomBytes(4).toString("hex")}`,
    token: randomBytes(32).toString("base64url"),
  }));
  const sockets: Socket[] = [];
  let first: Socket, second: Socket, friend: Socket;
  const origin = "http://localhost:3000";
  function connect(index: number) {
    const socket = io("http://127.0.0.1:3995", {
      reconnection: false,
      transports: ["polling"],
      extraHeaders: {
        Origin: origin,
        Cookie: `ta_session=${users[index].token}`,
      },
    });
    sockets.push(socket);
    return new Promise<Socket>((resolve, reject) => {
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", reject);
    });
  }
  function emit<T = PresenceView>(
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
    } catch {}
    process.env.REALTIME_PORT = "3995";
    process.env.REALTIME_NAMESPACE = "tell-aviv:test:presence:3995";
    process.env.APP_URL = origin;
    db = (await import("@tell-aviv/database")).db;
    const { hashToken } = await import("@tell-aviv/auth");
    for (const user of users) {
      await db`INSERT INTO users(id,username,display_name) VALUES(${user.id},${user.username},${user.username})`;
      await db`INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(${randomUUID()},${user.id},${hashToken(user.token)},now()+interval '1 hour')`;
    }
    const sorted = users.map((user) => user.id).sort();
    await db`INSERT INTO friendships(user_low,user_high) VALUES(${sorted[0]},${sorted[1]})`;
    const [room] =
      await db`INSERT INTO chat_rooms(kind,name,owner_id) VALUES('group','presence fixture',${users[0].id}) RETURNING id`;
    roomId = room.id;
    for (const user of users)
      await db`INSERT INTO chat_members(room_id,user_id) VALUES(${roomId},${user.id})`;
    service = await (await import("./server")).startRealtime();
    first = await connect(0);
    second = await connect(0);
    friend = await connect(1);
    await emit(first, "room:subscribe", { roomId });
    await emit(friend, "room:subscribe", { roomId });
  }, 20_000);
  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (service) {
      for (const user of users)
        await service.redis.del(
          `tell-aviv:presence:${user.id}`,
          `tell-aviv:connections:${user.id}`,
          `tell-aviv:activity:${user.id}`,
        );
    }
    if (db) {
      if (roomId) await db`DELETE FROM chat_rooms WHERE id=${roomId}`;
      await db`DELETE FROM users WHERE id=ANY(${users.map((user) => user.id)}::uuid[])`;
    }
    if (service) await service.close();
  });
  it("keeps a user online while another tab has recent input, then idles all inactive tabs", async () => {
    expect(
      (await emit(first, "presence:heartbeat", { idleForMs: 6 * 60_000 })).data
        .status,
    ).toBe("online");
    expect(
      (await emit(second, "presence:heartbeat", { idleForMs: 6 * 60_000 })).data
        .status,
    ).toBe("idle");
    const view = (
      await emit<PresenceView[]>(friend, "presence:snapshot")
    ).data.find((value) => value.userId === users[0].id);
    expect(view?.status).toBe("idle");
    expect(view?.lastActivityAt).toBeUndefined();
    expect(
      (await emit(second, "presence:heartbeat", { idleForMs: 0 })).data.status,
    ).toBe("online");
  });
  it("preserves manual Away and DND even when a tab receives input", async () => {
    await emit(first, "presence:status", { status: "idle" });
    expect(
      (await emit(second, "presence:heartbeat", { idleForMs: 0 })).data.status,
    ).toBe("idle");
    await emit(first, "presence:status", { status: "dnd" });
    expect(
      (await emit(second, "presence:heartbeat", { idleForMs: 0 })).data.status,
    ).toBe("dnd");
  });
  it("hides Invisible presence and rejects typing leaks including queued deliveries", async () => {
    await emit(first, "presence:status", { status: "online" });
    const typing = new Promise<unknown>((resolve) =>
      friend.once("chat:typing", resolve),
    );
    expect(
      (await emit(first, "chat:typing:start", { roomId })).error,
    ).toBeUndefined();
    expect(await typing).toMatchObject({ userId: users[0].id });
    await emit(first, "presence:status", { status: "invisible" });
    let leaked = false;
    const listener = () => {
      leaked = true;
    };
    friend.on("chat:typing", listener);
    await emit(first, "chat:typing:start", { roomId });
    await service.redis.publish(
      "tell-aviv:events",
      JSON.stringify({
        type: "chat:typing",
        roomId,
        payload: { roomId, userId: users[0].id, expiresAt: Date.now() + 5000 },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    friend.off("chat:typing", listener);
    expect(leaked).toBe(false);
    expect(
      (await emit<PresenceView[]>(friend, "presence:snapshot")).data.find(
        (value) => value.userId === users[0].id,
      ),
    ).toEqual({ userId: users[0].id, status: "offline" });
  });
  it("hides Invisible activity/timestamps in public profiles and Home while preserving the owner's history", async () => {
    await db`INSERT INTO social_activity(user_id,kind,title,link) VALUES(${users[0].id},'game','Private activity fixture','/games')`;
    const { getUser } = await import("@tell-aviv/database");
    const { handleSocial } =
      await import("../../../packages/platform/src/social");
    const owner = (await getUser(users[0].id))!,
      viewer = (await getUser(users[1].id))!;
    const request = new Request(origin + "/api/home");
    const profile = (await handleSocial(
      ["users", owner.id],
      "GET",
      { user: viewer, request },
      {},
    )) as { activity: unknown[] };
    expect(profile.activity).toEqual([]);
    const home = (await handleSocial(
      ["home"],
      "GET",
      { user: viewer, request },
      {},
    )) as { activity: { title: string }[] };
    expect(
      home.activity.some((item) => item.title === "Private activity fixture"),
    ).toBe(false);
    const own = (await handleSocial(
      ["home"],
      "GET",
      { user: owner, request },
      {},
    )) as { activity: { title: string }[] };
    expect(
      own.activity.some((item) => item.title === "Private activity fixture"),
    ).toBe(true);
  });
  it("applies changes from Invisible back to Online immediately without waiting for a stale Redis heartbeat", async () => {
    await db`UPDATE users SET settings=jsonb_set(settings,'{presence}','"online"'::jsonb) WHERE id=${users[0].id}`;
    const view = (
      await emit<PresenceView[]>(friend, "presence:snapshot")
    ).data.find((item) => item.userId === users[0].id);
    expect(view?.status).toBe("online");
  });
  it("rechecks desktop eligibility from current account preferences for every notification", async () => {
    async function notification() {
      const received = new Promise<{ desktopSuppressed: boolean }>((resolve) =>
        friend.once("notification:create", resolve),
      );
      await service.redis.publish(
        "tell-aviv:events",
        JSON.stringify({
          type: "notification:create",
          userIds: [users[1].id],
          payload: {
            id: randomUUID(),
            kind: "dm",
            title: "Own fixture notice",
            link: "/chat",
          },
        }),
      );
      return received;
    }
    expect((await notification()).desktopSuppressed).toBe(true);
    await db`UPDATE users SET settings=${db.json({ notifications: { desktop_enabled: true, desktop_dm: true } })} WHERE id=${users[1].id}`;
    expect((await notification()).desktopSuppressed).toBe(false);
    await db`UPDATE users SET settings=jsonb_set(settings,'{focusMode}','true'::jsonb) WHERE id=${users[1].id}`;
    expect((await notification()).desktopSuppressed).toBe(true);
    await db`UPDATE users SET settings=${db.json({ notifications: { desktop_enabled: true, desktop_dm: false } })} WHERE id=${users[1].id}`;
    expect((await notification()).desktopSuppressed).toBe(true);
    await db`UPDATE users SET settings=${db.json({ notifications: { desktop_enabled: true }, presence: "dnd" })} WHERE id=${users[1].id}`;
    expect((await notification()).desktopSuppressed).toBe(true);
  });
  it("pushes only marketplace refresh metadata and disconnects revoked recipients", async () => {
    const firstDelivery = new Promise<unknown>((resolve) =>
      first.once("casino:market:changed", resolve),
    );
    await service.redis.publish(
      "tell-aviv:events",
      JSON.stringify({
        type: "casino:market:changed",
        payload: { refresh: true, privateTrade: "must never be forwarded" },
      }),
    );
    expect(await firstDelivery).toEqual({ refresh: true });
    await db`DELETE FROM sessions WHERE user_id=${users[0].id}`;
    let leaked = false;
    first.on("casino:market:changed", () => {
      leaked = true;
    });
    const received = new Promise<unknown>((resolve) =>
      friend.once("casino:market:changed", resolve),
    );
    await service.redis.publish(
      "tell-aviv:events",
      JSON.stringify({
        type: "casino:market:changed",
        payload: { privateTrade: "must never be forwarded" },
      }),
    );
    expect(await received).toEqual({ refresh: true });
    await expect.poll(() => first.connected || second.connected).toBe(false);
    expect(leaked).toBe(false);
  });
});
