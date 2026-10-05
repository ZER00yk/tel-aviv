import { randomBytes, randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { io, type Socket } from "socket.io-client";
import type { startRealtime } from "./server";
import type { QueueStatus } from "./queue";
import type { Lobby } from "./engines";

describe.runIf(process.env.RUN_INTEGRATION === "1")(
  "durable public matchmaking and eligibility",
  () => {
    const namespace = `tell-aviv:queue-test:${randomBytes(6).toString("hex")}`;
    const origin = "http://localhost:3000",
      url = "http://127.0.0.1:3996";
    const users = Array.from({ length: 7 }, () => ({
      id: randomUUID(),
      username: `queue_${randomBytes(5).toString("hex")}`,
      token: randomBytes(32).toString("base64url"),
    }));
    let service: Awaited<ReturnType<typeof startRealtime>>;
    let db: typeof import("@tell-aviv/database").db;
    const sockets: Socket[] = [],
      codes = new Set<string>();
    const wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    function emit<T = QueueStatus>(
      socket: Socket,
      event: string,
      payload: unknown = {},
    ) {
      return new Promise<{ data: T; error?: string }>((resolve, reject) =>
        socket
          .timeout(5000)
          .emit(
            event,
            payload,
            (error: Error | null, response: { data: T; error?: string }) =>
              error ? reject(error) : resolve(response),
          ),
      );
    }
    async function connect(index: number) {
      const socket = io(url, {
        reconnection: false,
        transports: ["polling"],
        extraHeaders: {
          Origin: origin,
          Cookie: `ta_session=${users[index].token}`,
        },
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("connect_error", reject);
      });
      sockets.push(socket);
      return socket;
    }
    const join = (index: number, payload: Record<string, unknown> = {}) =>
      emit(sockets[index], "game:queue:join", {
        gameId: "connect-four",
        ...payload,
      });
    const status = (index: number) =>
      emit<QueueStatus | null>(sockets[index], "game:queue:status");
    const remember = async (index = 0) => {
      const room = await service.store.current(users[index].id);
      if (room) codes.add(room.code);
      return room;
    };
    beforeAll(async () => {
      try {
        process.loadEnvFile(".env");
      } catch {
        /* Existing caller environment is supported. */
      }
      process.env.REALTIME_PORT = "3996";
      process.env.REALTIME_NAMESPACE = namespace;
      process.env.APP_URL = origin;
      db = (await import("@tell-aviv/database")).db;
      const { hashToken } = await import("@tell-aviv/auth");
      for (const user of users) {
        await db`INSERT INTO users(id,username,display_name) VALUES(${user.id},${user.username},'Queue fixture')`;
        await db`INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(${randomUUID()},${user.id},${hashToken(user.token)},now()+interval '1 hour')`;
      }
      service = await (await import("./server")).startRealtime();
    }, 20000);
    beforeEach(async () => {
      for (const user of users) {
        const rates = await service.redis.keys(`tell-aviv:rate:${user.id}:*`);
        if (rates.length) await service.redis.del(...rates);
      }
      for (let index = 0; index < users.length; index++) await connect(index);
    });
    afterEach(async () => {
      for (const user of users) {
        await remember(users.indexOf(user));
        await service.queue.leave(user.id).catch(() => undefined);
        await service.store.leave(user.id).catch(() => undefined);
      }
      for (const socket of sockets) socket.disconnect();
      sockets.length = 0;
      await wait(100);
      await db`DELETE FROM matchmaking_tickets WHERE namespace=${namespace}`;
      await db`DELETE FROM user_blocks WHERE user_id=ANY(${users.map((user) => user.id)}::uuid[])`;
      await db`DELETE FROM parties WHERE leader_id=ANY(${users.map((user) => user.id)}::uuid[])`;
      await db`UPDATE users SET disabled=false WHERE id=ANY(${users.map((user) => user.id)}::uuid[])`;
    });
    afterAll(async () => {
      if (service) {
        const keys = await service.redis.keys(`${namespace}:*`);
        if (keys.length) await service.redis.del(...keys);
        for (const user of users)
          await service.redis.del(
            `tell-aviv:connections:${user.id}`,
            `tell-aviv:presence:${user.id}`,
          );
      }
      if (db) {
        await db`DELETE FROM multiplayer_matches WHERE lobby_code=ANY(${[...codes]}::varchar[])`;
        await db`DELETE FROM multiplayer_checkpoints WHERE namespace=${namespace}`;
        await db`DELETE FROM matchmaking_tickets WHERE namespace=${namespace}`;
        await db`DELETE FROM users WHERE id=ANY(${users.map((user) => user.id)}::uuid[])`;
      }
      if (service) await service.close();
    });
    it("validates modes/impersonation, keeps pools separate, and handles duplicate joins", async () => {
      expect((await join(0, { mode: "ranked" })).error).toMatch(
        "Ranked multiplayer",
      );
      expect((await join(0, { userId: users[1].id })).error).toMatch(
        "Unrecognized",
      );
      const first = await join(0, { region: "europe" });
      expect(first.data.status).toBe("waiting");
      expect((await join(0, { region: "europe" })).data.ticketId).toBe(
        first.data.ticketId,
      );
      expect(
        (
          await emit(sockets[0], "game:lobby:create", {
            gameId: "connect-four",
          })
        ).error,
      ).toMatch("Leave matchmaking");
      await join(1, { region: "americas" });
      await service.queue.tick(true);
      expect((await status(0)).data?.status).toBe("waiting");
      expect((await status(1)).data?.status).toBe("waiting");
      await emit(sockets[1], "game:queue:leave");
      await join(1, { region: "europe" });
      await service.queue.tick(true);
      const matched = (await status(0)).data!;
      expect(matched.status).toBe("matched");
      expect((await status(1)).data?.lobbyCode).toBe(matched.lobbyCode);
      codes.add(matched.lobbyCode!);
      expect(
        await db`SELECT 1 FROM matchmaking_members WHERE namespace=${namespace} AND user_id=${users[0].id} AND active`,
      ).toHaveLength(1);
    });
    it("never pairs blocked accounts and reserves found rooms to queued participants", async () => {
      await db`INSERT INTO user_blocks(user_id,blocked_id) VALUES(${users[0].id},${users[1].id})`;
      const a = await join(0),
        b = await join(1);
      await service.queue.tick(true);
      expect((await status(0)).data?.status).toBe("waiting");
      expect((await status(1)).data?.status).toBe("waiting");
      expect(JSON.stringify(a.data)).not.toContain(users[1].username);
      expect(JSON.stringify(b.data)).not.toContain(users[0].username);
      await join(2);
      await service.queue.tick(true);
      const room = await remember();
      expect(room?.players.map((player) => player.id)).toEqual(
        expect.arrayContaining([users[0].id, users[2].id]),
      );
      expect((await status(1)).data?.status).toBe("waiting");
      expect(
        (await emit(sockets[3], "game:lobby:join", { code: room!.code })).error,
      ).toMatch("reserved");
    });
    it("cancels an entire ready check on decline or timeout without leaving membership behind", async () => {
      await join(0);
      await join(1);
      await service.queue.tick(true);
      const room = await remember();
      expect(room).not.toBeNull();
      await emit(sockets[0], "game:queue:leave");
      expect((await status(0)).data?.status).toBe("cancelled");
      expect((await status(1)).data?.reason).toMatch("declined");
      expect(await service.store.current(users[0].id)).toBeNull();
      expect(await service.store.current(users[1].id)).toBeNull();
      expect(
        await db`SELECT 1 FROM matchmaking_members WHERE namespace=${namespace} AND active`,
      ).toHaveLength(0);
      await join(0);
      await join(1);
      await service.queue.tick(true);
      await remember();
      await db`UPDATE matchmaking_tickets SET ready_deadline=now()-interval '1 second' WHERE namespace=${namespace} AND status='matched'`;
      await service.queue.tick(true);
      expect((await status(0)).data?.reason).toMatch("expired");
      expect(await service.store.current(users[1].id)).toBeNull();
    });
    it("requires party leadership/readiness, starts a real co-op campaign, and revalidates membership", async () => {
      const [party] =
        await db`INSERT INTO parties(leader_id) VALUES(${users[0].id}) RETURNING id`;
      for (const user of users.slice(0, 2))
        await db`INSERT INTO party_members(party_id,user_id,ready) VALUES(${party.id},${user.id},false)`;
      expect(
        (
          await join(1, {
            gameId: "ego-trip",
            party: true,
            coopMode: "campaign",
          })
        ).error,
      ).toMatch("leader");
      expect(
        (
          await join(0, {
            gameId: "ego-trip",
            party: true,
            coopMode: "campaign",
          })
        ).error,
      ).toMatch("ready");
      await db`UPDATE party_members SET ready=true WHERE party_id=${party.id}`;
      const queued = await join(0, {
        gameId: "ego-trip",
        party: true,
        coopMode: "campaign",
      });
      expect(queued.error).toBeUndefined();
      await service.queue.tick(true);
      const room = await remember();
      expect(room?.coopMode).toBe("campaign");
      await emit(sockets[0], "game:lobby:ready", { ready: true });
      await emit(sockets[1], "game:lobby:ready", { ready: true });
      const started = await emit<Lobby>(sockets[0], "game:lobby:start");
      expect(started.error).toBeUndefined();
      expect(started.data.status).toBe("playing");
      expect(started.data.state?.kind).toBe("ego-trip");
      await service.queue.tick(true);
      expect((await status(0)).data?.status).toBe("playing");
      await service.store.leave(users[0].id);
      await service.store.leave(users[1].id);
      await service.queue.tick(true);
      await db`DELETE FROM party_members WHERE party_id=${party.id}`;
      for (const user of users.slice(0, 3))
        await db`INSERT INTO party_members(party_id,user_id,ready) VALUES(${party.id},${user.id},true)`;
      await join(0, { gameId: "social-deduction", party: true });
      await db`UPDATE parties SET leader_id=${users[1].id} WHERE id=${party.id}`;
      await service.queue.tick(true);
      expect((await status(0)).data?.status).toBe("cancelled");
    }, 15000);
    it("restores a waiting ticket across reconnect and rejects unavailable accounts", async () => {
      const first = await join(0);
      sockets[0].disconnect();
      await wait(100);
      await service.queue.tick(true);
      expect((await service.queue.status(users[0].id))?.status).toBe("waiting");
      const replacement = await connect(0);
      sockets[0] = replacement;
      expect((await status(0)).data?.ticketId).toBe(first.data.ticketId);
      expect((await join(0)).data.ticketId).toBe(first.data.ticketId);
      await db`UPDATE users SET disabled=true WHERE id=${users[0].id}`;
      await service.queue.tick(true);
      const [ticket] =
        await db`SELECT status FROM matchmaking_tickets WHERE id=${first.data.ticketId}`;
      expect(ticket.status).toBe("cancelled");
    });
    it("compensates a process interruption after a partial durable lobby reservation", async () => {
      const a = await join(0, { region: "global" }),
        b = await join(1, { region: "europe" });
      const partial = await service.store.create(
        users[0],
        "connect-four",
        "private",
        "gauntlet",
        [a.data.ticketId, b.data.ticketId],
      );
      codes.add(partial.code);
      await service.queue.tick(true);
      expect((await status(0)).data?.status).toBe("failed");
      expect((await status(1)).data?.status).toBe("failed");
      expect(await service.store.current(users[0].id)).toBeNull();
      expect(
        await db`SELECT 1 FROM matchmaking_members WHERE namespace=${namespace} AND active`,
      ).toHaveLength(0);
    });
    it("never stores authenticated private settings in player identities and sanitizes legacy SQL recovery", async () => {
      await db`UPDATE users SET settings=${db.json({ presence: "invisible", focusMode: true, privateNotes: "PRIVATE_SETTINGS_SENTINEL" })} WHERE id=ANY(${users.slice(0, 2).map((user) => user.id)}::uuid[])`;
      const created = await emit<Lobby>(sockets[0], "game:lobby:create", {
        gameId: "connect-four",
        visibility: "private",
      });
      expect(created.error).toBeUndefined();
      codes.add(created.data.code);
      const joined = await emit<Lobby>(sockets[1], "game:lobby:join", {
        code: created.data.code,
      });
      expect(joined.data.players).toHaveLength(2);
      expect(JSON.stringify(joined.data)).not.toContain(
        "PRIVATE_SETTINGS_SENTINEL",
      );
      expect(joined.data.players[0]).not.toHaveProperty("settings");
      expect(joined.data.players[1]).not.toHaveProperty("settings");
      const canonical = (await service.store.get(created.data.code))!;
      Object.assign(canonical.players[0], {
        settings: {
          presence: "invisible",
          privateNotes: "LEGACY_PRIVATE_SENTINEL",
        },
        role: "owner",
        email: "legacy-private@example.invalid",
      });
      await db`UPDATE multiplayer_checkpoints SET snapshot=${db.json(JSON.parse(JSON.stringify(canonical)))} WHERE namespace=${namespace} AND lobby_code=${canonical.code}`;
      await service.redis.del(`${namespace}:lobby:${canonical.code}`);
      const restored = await service.store.get(canonical.code);
      expect(restored?.players[0]).not.toHaveProperty("settings");
      expect(restored?.players[0]).not.toHaveProperty("role");
      expect(restored?.players[0]).not.toHaveProperty("email");
      await service.store.mutate(canonical.code, () => undefined);
      const [saved] =
        await db`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${canonical.code}`;
      expect(JSON.stringify(saved.snapshot)).not.toContain(
        "LEGACY_PRIVATE_SENTINEL",
      );
    });
    it("cancels deleted-member and dissolved-party tickets without shrinking their reserved team", async () => {
      const [party] =
        await db`INSERT INTO parties(leader_id) VALUES(${users[0].id}) RETURNING id`;
      for (const user of [users[0], users[6]])
        await db`INSERT INTO party_members(party_id,user_id,ready) VALUES(${party.id},${user.id},true)`;
      const initial = await join(0, {
        gameId: "social-deduction",
        party: true,
      });
      expect(initial.data.memberCount).toBe(2);
      await db`DELETE FROM users WHERE id=${users[6].id}`;
      await service.queue.tick(true);
      expect((await status(0)).data?.status).toBe("cancelled");
      await db`INSERT INTO party_members(party_id,user_id,ready) VALUES(${party.id},${users[1].id},true)`;
      const second = await join(0, { gameId: "social-deduction", party: true });
      expect(second.data.party).toBe(true);
      await db`DELETE FROM parties WHERE id=${party.id}`;
      await service.queue.tick(true);
      expect((await status(0)).data?.status).toBe("cancelled");
      expect(
        await db`SELECT 1 FROM matchmaking_members WHERE namespace=${namespace} AND active`,
      ).toHaveLength(0);
    });
  },
);
