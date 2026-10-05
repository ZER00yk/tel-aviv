import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { io, type Socket } from "socket.io-client";
import postgres from "postgres";
import type {
  DefenseState,
  DefenseView,
} from "../../../games/tower-defense/authority";
import type { startRealtime } from "./server";
interface Wire {
  code: string;
  status: string;
  state: DefenseView;
}
const enabled = process.env.RUN_INTEGRATION === "1";
describe.skipIf(!enabled)("live defense SQL/Redis/Socket.IO authority", () => {
  const namespace = `tell-aviv:test:defense:${randomUUID()}`;
  const users = [0, 1].map(() => ({
    id: randomUUID(),
    token: randomBytes(32).toString("base64url"),
    username: `def_${randomBytes(6).toString("hex")}`,
  }));
  const sockets: Socket[] = [];
  let service: Awaited<ReturnType<typeof startRealtime>>;
  let db: typeof import("@tell-aviv/database").db;
  let code = "";
  let initial: Record<string, unknown>;
  let beforeBuildCache: string;
  function connect(i: number) {
    const socket = io("http://127.0.0.1:3997", {
      reconnection: false,
      transports: ["polling"],
      extraHeaders: {
        Origin: "http://localhost:3000",
        Cookie: `ta_session=${users[i].token}`,
      },
    });
    sockets.push(socket);
    return new Promise<Socket>((resolve, reject) => {
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", reject);
    });
  }
  function emit(socket: Socket, event: string, input: unknown = {}) {
    return new Promise<{ data?: Wire; error?: string }>((resolve, reject) =>
      socket
        .timeout(5000)
        .emit(
          event,
          input,
          (error: Error | null, response: { data?: Wire; error?: string }) =>
            error ? reject(error) : resolve(response),
        ),
    );
  }
  beforeAll(async () => {
    try {
      process.loadEnvFile(".env");
    } catch {
      /* Explicit caller configuration is supported. */
    }
    process.env.REALTIME_PORT = "3997";
    process.env.REALTIME_NAMESPACE = namespace;
    process.env.APP_URL = "http://localhost:3000";
    db = (await import("@tell-aviv/database")).db;
    const { hashToken } = await import("@tell-aviv/auth");
    for (const user of users) {
      await db`INSERT INTO users(id,username,display_name) VALUES(${user.id},${user.username},${user.username})`;
      await db`INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(${randomUUID()},${user.id},${hashToken(user.token)},now()+interval '1 hour')`;
    }
    service = await (await import("./server")).startRealtime();
    const a = await connect(0),
      b = await connect(1);
    const created = await emit(a, "game:lobby:create", {
      gameId: "tower-defense",
      visibility: "private",
    });
    expect(created.error).toBeUndefined();
    code = created.data!.code;
    expect((await emit(b, "game:lobby:join", { code })).error).toBeUndefined();
    await emit(a, "game:lobby:ready", { ready: true });
    await emit(b, "game:lobby:ready", { ready: true });
    expect((await emit(a, "game:lobby:start")).data!.state.phase).toBe("build");
  }, 20_000);
  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    if (service) await service.close();
    if (process.env.DATABASE_URL) {
      // Closing the owned realtime process also closes its shared SQL pool.
      const cleanup = postgres(process.env.DATABASE_URL!, { max: 1 });
      try {
        await cleanup`DELETE FROM multiplayer_checkpoints WHERE namespace=${namespace}`;
        await cleanup`DELETE FROM operational_metric_snapshots WHERE namespace=${namespace}`;
        await cleanup`DELETE FROM realtime_worker_epochs WHERE namespace=${namespace}`;
        await cleanup`DELETE FROM multiplayer_matches WHERE lobby_code=${code}`;
        await cleanup`DELETE FROM users WHERE id=ANY(${users.map((u) => u.id)}::uuid[])`;
      } finally {
        await cleanup.end();
      }
    }
    if (service) {
      const Redis = (await import("ioredis")).default;
      const redis = new Redis(process.env.REDIS_URL!);
      const keys = await redis.keys(`${namespace}:*`);
      if (keys.length) await redis.del(...keys);
      await redis.quit();
    }
  });
  it("charges shared cash once, pins accepted commands in SQL and rejects outcome spoofing", async () => {
    beforeBuildCache = (await service.redis.get(`${namespace}:lobby:${code}`))!;
    initial = {
      type: "place",
      kind: "rapid",
      x: 0,
      y: 0,
      revision: 0,
      requestId: randomUUID(),
    };
    const first = await emit(sockets[0], "game:action", initial);
    expect(first.error).toBeUndefined();
    expect(first.data!.state.cash).toBe(105);
    const retry = await emit(sockets[0], "game:action", initial);
    expect(retry.data!.state.cash).toBe(105);
    expect(retry.data!.state.towers).toHaveLength(1);
    expect(
      (await emit(sockets[0], "game:action", { ...initial, x: 1 })).error,
    ).toMatch(/request ID/);
    expect(
      (
        await emit(sockets[1], "game:action", {
          ...initial,
          requestId: randomUUID(),
        })
      ).error,
    ).toMatch(/changed/);
    expect(
      (
        await emit(sockets[0], "game:action", {
          type: "wave",
          revision: 1,
          requestId: randomUUID(),
          kills: 999,
        })
      ).error,
    ).toMatch(/Invalid/);
    const [row] =
      await db`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${code}`;
    expect((row.snapshot.state as DefenseState).commandRevision).toBe(1);
    expect(row.snapshot.state.defense.cash).toBe(105);
  });
  it("preserves a committed build and receipt when its cache publication is lost", async () => {
    // Restore only this fixture's pre-command cache to emulate a failed cache
    // publication after the successful SQL commit in the preceding command.
    await service.redis.set(`${namespace}:lobby:${code}`, beforeBuildCache);
    const recovered = await service.store.get(code);
    expect((recovered!.state as DefenseState).commandRevision).toBe(1);
    expect((recovered!.state as DefenseState).defense.cash).toBe(105);
    expect((recovered!.state as DefenseState).defense.towers).toHaveLength(1);
    const retry = await emit(sockets[0], "game:action", initial);
    expect(retry.error).toBeUndefined();
    expect(retry.data!.state.cash).toBe(105);
    expect(retry.data!.state.towers).toHaveLength(1);
    expect(
      (
        await emit(sockets[1], "game:action", {
          ...initial,
          x: 1,
          requestId: randomUUID(),
        })
      ).error,
    ).toMatch(/changed/);
  });
  it("moves enemies live while a teammate builds and upgrades, without leaking authoritative internals", async () => {
    const start = await emit(sockets[0], "game:action", {
      type: "wave",
      revision: 1,
      requestId: randomUUID(),
    });
    expect(start.data!.state.phase).toBe("wave");
    expect(start.data!.state.lastWave).toBeUndefined();
    await new Promise((r) => setTimeout(r, 400));
    const first = (await emit(sockets[1], "game:lobby:recover")).data!.state;
    expect(first.enemies.length).toBeGreaterThan(0);
    const x = first.enemies[0].x;
    const placed = await emit(sockets[1], "game:action", {
      type: "place",
      kind: "rapid",
      x: 3,
      y: 1,
      revision: first.commandRevision,
      requestId: randomUUID(),
    });
    expect(placed.error).toBeUndefined();
    expect(placed.data!.state.towers).toHaveLength(2);
    expect(placed.data!.state.cash).toBe(60);
    const upgraded = await emit(sockets[1], "game:action", {
      type: "upgrade",
      towerId: "2",
      revision: placed.data!.state.commandRevision,
      requestId: randomUUID(),
    });
    expect(upgraded.error).toBeUndefined();
    expect(upgraded.data!.state.towers[1].level).toBe(2);
    expect(upgraded.data!.state.cash).toBe(24);
    await new Promise((r) => setTimeout(r, 400));
    const second = (await emit(sockets[0], "game:lobby:recover")).data!.state;
    expect(
      second.enemies.find((e) => e.id === first.enemies[0].id)!.x,
    ).toBeGreaterThan(x);
    for (const key of [
      "simulation",
      "receipts",
      "lastTick",
      "cooldowns",
      "participantIds",
    ])
      expect(second).not.toHaveProperty(key);
  });
  it("restores a SQL checkpoint after only this lobby's Redis cache is lost, preserving receipts and live wave", async () => {
    await service.store.checkpointAll();
    const before = await service.store.get(code);
    expect(before?.state?.kind).toBe("tower-defense");
    const tick = (before!.state as DefenseState).simulation!.tick;
    await service.redis.del(
      `${namespace}:lobby:${code}`,
      ...users.map((u) => `${namespace}:user-lobby:${u.id}`),
    );
    const hydrated = await service.store.get(code);
    expect(hydrated!.recoveryPausedAt).toBeTruthy();
    expect((hydrated!.state as DefenseState).simulation!.tick).toBe(tick);
    const recovered = await emit(sockets[1], "game:lobby:recover");
    expect(recovered.data!.code).toBe(code);
    expect(recovered.data!.state.phase).toBe("wave");
    const replay = await emit(sockets[0], "game:action", initial);
    expect(replay.error).toBeUndefined();
    expect(replay.data!.state.cash).toBe(24);
    expect(replay.data!.state.towers).toHaveLength(2);
    expect(
      (await emit(sockets[0], "game:lobby:recover")).data!.state.kind,
    ).toBe("tower-defense");
  });
  it("pauses when both sockets disconnect and resumes from the same fixed step", async () => {
    for (const socket of sockets) socket.disconnect();
    await new Promise((r) => setTimeout(r, 400));
    const paused = await service.store.get(code);
    expect(paused!.recoveryPausedAt).toBeTruthy();
    const tick = (paused!.state as DefenseState).simulation!.tick;
    const staleConnected = structuredClone(paused!);
    delete staleConnected.recoveryPausedAt;
    for (const player of staleConnected.players) player.connected = true;
    await service.redis.set(
      `${namespace}:lobby:${code}`,
      JSON.stringify(staleConnected),
    );
    expect((await service.store.get(code))!.recoveryPausedAt).toBeTruthy();
    await new Promise((r) => setTimeout(r, 400));
    expect(
      ((await service.store.get(code))!.state as DefenseState).simulation!.tick,
    ).toBe(tick);
    const a = await connect(0),
      b = await connect(1);
    await emit(a, "game:lobby:recover");
    await emit(b, "game:lobby:recover");
    expect((await service.store.get(code))!.recoveryPausedAt).toBeUndefined();
  });
  it("keeps a committed teammate disconnect when its cache publication is lost", async () => {
    const connectedCache = (await service.redis.get(
      `${namespace}:lobby:${code}`,
    ))!;
    await service.store.disconnected(users[1].id);
    const [checkpoint] =
      await db`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${code}`;
    expect(
      checkpoint.snapshot.players.find(
        (p: { id: string }) => p.id === users[1].id,
      ).connected,
    ).toBe(false);
    await service.redis.set(`${namespace}:lobby:${code}`, connectedCache);
    const recovered = await service.store.get(code);
    expect(
      recovered!.players.find((p) => p.id === users[1].id)!.connected,
    ).toBe(false);
    await service.store.join(code, users[1]);
  });
  it("does not let queued old disconnect cleanup undo a successful reconnect", async () => {
    let release!: () => void, entered!: () => void;
    let stillDisconnected = true;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const waiting = new Promise<void>((resolve) => (entered = resolve));
    const original = service.store.current.bind(service.store);
    const spy = vi
      .spyOn(service.store, "current")
      .mockImplementationOnce(async (id) => {
        const lobby = await original(id);
        entered();
        await gate;
        return lobby;
      });
    const oldCleanup = service.store.disconnected(
      users[0].id,
      () => stillDisconnected,
    );
    try {
      await waiting;
      await service.store.join(code, users[0]);
      stillDisconnected = false;
      release();
      await oldCleanup;
      const recovered = await service.store.get(code);
      expect(
        recovered!.players.find((p) => p.id === users[0].id)!.connected,
      ).toBe(true);
      expect(recovered!.recoveryPausedAt).toBeUndefined();
    } finally {
      release();
      await oldCleanup;
      spy.mockRestore();
    }
  });
  it("records a server loss once and never awards a client-provided score", async () => {
    const current = sockets.filter((s) => s.connected);
    await service.store.mutate(code, (lobby) => {
      const s = lobby.state as DefenseState;
      s.defense.lives = 1;
      s.defense.towers = [];
      s.lastTick = Date.now() - 1000;
    });
    for (let step = 0; step < 40; step++) {
      const l = await service.store.get(code);
      if (l!.status === "finished") break;
      await service.store.mutate(code, (lobby) => {
        const s = lobby.state as DefenseState;
        s.lastTick = Date.now() - 1000;
      });
      await service.store.tick();
    }
    const ended = await emit(current[0], "game:lobby:recover");
    expect(ended.data!.status).toBe("finished");
    expect(ended.data!.state.result!.winners).toEqual([]);
    await service.store.tick();
    const matches =
      await db`SELECT id,result FROM multiplayer_matches WHERE lobby_code=${code}`;
    expect(matches).toHaveLength(1);
    const results =
      await db`SELECT user_id,score,won FROM multiplayer_results WHERE match_id=${matches[0].id}`;
    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.won && r.score < 999)).toBe(true);
  });
});
