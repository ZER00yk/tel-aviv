import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import Redis from "ioredis";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface Room {
  code: string;
  matchId: string;
  status: string;
  state: { board: (string | null)[][]; turn: string };
}
describe.runIf(process.env.RUN_INTEGRATION === "1")(
  "two OS workers preserve fencing across suspension and crash",
  () => {
    const namespace = `tell-aviv:two-workers:${randomBytes(6).toString("hex")}`;
    const origin = "http://localhost:3000";
    const metricsToken = randomBytes(32).toString("base64url");
    const users = Array.from({ length: 2 }, () => ({
      id: randomUUID(),
      username: `fence_${randomBytes(5).toString("hex")}`,
      token: randomBytes(32).toString("base64url"),
    }));
    const children: { process: ChildProcess; output: string; port: number }[] =
        [],
      sockets: Socket[] = [];
    let db: typeof import("@tell-aviv/database").db,
      redis: Redis,
      code = "",
      matchId = "";
    const wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    function launch(port: number) {
      const child = {
        process: spawn(
          process.execPath,
          ["--env-file=.env", "--import", "tsx", "apps/realtime/src/index.ts"],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              APP_URL: origin,
              REALTIME_HOST: "127.0.0.1",
              REALTIME_PORT: String(port),
              REALTIME_NAMESPACE: namespace,
              METRICS_SCRAPE_TOKEN: metricsToken,
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
        output: "",
        port,
      };
      for (const stream of [child.process.stdout, child.process.stderr])
        stream?.on("data", (chunk: Buffer) => {
          child.output = (child.output + chunk.toString()).slice(-6000);
        });
      children.push(child);
      return child;
    }
    async function ready(child: (typeof children)[number]) {
      for (let i = 0; i < 100; i++) {
        if (child.process.exitCode !== null)
          throw new Error(`Owned worker exited: ${child.output}`);
        try {
          if (
            (
              await fetch(`http://127.0.0.1:${child.port}/health`, {
                signal: AbortSignal.timeout(300),
              })
            ).ok
          )
            return;
        } catch {
          /* Wait for the five second lease and SQL takeover. */
        }
        await wait(100);
      }
      throw new Error(`Owned worker did not become ready: ${child.output}`);
    }
    async function stop(child: (typeof children)[number], crash = false) {
      if (child.process.exitCode !== null || child.process.signalCode !== null)
        return;
      child.process.kill("SIGCONT");
      const exited = new Promise<void>((resolve) =>
        child.process.once("exit", () => resolve()),
      );
      child.process.kill(crash ? "SIGKILL" : "SIGTERM");
      await Promise.race([
        exited,
        wait(6000).then(() => {
          if (
            child.process.exitCode === null &&
            child.process.signalCode === null
          )
            child.process.kill("SIGKILL");
        }),
      ]);
    }
    async function connect(index: number, port: number) {
      const socket = io(`http://127.0.0.1:${port}`, {
        reconnection: false,
        transports: ["websocket"],
        extraHeaders: {
          Origin: origin,
          Cookie: `ta_session=${users[index].token}`,
        },
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
      });
      return socket;
    }
    function emit(socket: Socket, event: string, payload: unknown = {}) {
      return new Promise<{ data: Room; error?: string }>((resolve, reject) =>
        socket
          .timeout(5000)
          .emit(
            event,
            payload,
            (error: Error | null, result: { data: Room; error?: string }) =>
              error ? reject(error) : resolve(result),
          ),
      );
    }
    beforeAll(async () => {
      try {
        process.loadEnvFile(".env");
      } catch {
        /* Supplied runner environment. */
      }
      db = (await import("@tell-aviv/database")).db;
      redis = new Redis(process.env.REDIS_URL!);
      const { hashToken } = await import("@tell-aviv/auth");
      for (const user of users) {
        await db`INSERT INTO users(id,username,display_name) VALUES(${user.id},${user.username},'Two worker fixture')`;
        await db`INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(${randomUUID()},${user.id},${hashToken(user.token)},now()+interval '1 hour')`;
      }
    });
    afterAll(async () => {
      for (const socket of sockets) socket.disconnect();
      for (const child of children) await stop(child);
      if (redis) {
        const keys = await redis.keys(`${namespace}:*`);
        if (keys.length) await redis.del(...keys);
        for (const user of users) {
          for (const pattern of [
            `tell-aviv:rate:${user.id}:*`,
            `tell-aviv:connections:${user.id}`,
            `tell-aviv:activity:${user.id}`,
            `tell-aviv:presence:${user.id}`,
          ]) {
            const owned = await redis.keys(pattern);
            if (owned.length) await redis.del(...owned);
          }
        }
        await redis.quit();
      }
      if (db) {
        await db`DELETE FROM operational_metric_snapshots WHERE namespace=${namespace}`;
        await db`DELETE FROM realtime_worker_epochs WHERE namespace=${namespace}`;
        await db`DELETE FROM multiplayer_checkpoints WHERE namespace=${namespace}`;
        if (matchId)
          await db`DELETE FROM multiplayer_matches WHERE id=${matchId}`;
        await db`DELETE FROM users WHERE id=ANY(${users.map((user) => user.id)}::uuid[])`;
        await (await import("@tell-aviv/database")).closeDatabase();
      }
    }, 20000);
    it("rejects a competing live owner, fences a resumed former owner, and survives killing its replacement", async () => {
      const a = launch(3501);
      await ready(a);
      expect((await fetch("http://127.0.0.1:3501/metrics")).status).toBe(401);
      const metrics = await fetch("http://127.0.0.1:3501/metrics", {
        headers: { authorization: `Bearer ${metricsToken}` },
      });
      expect(metrics.status).toBe(200);
      expect(metrics.headers.get("cache-control")).toBe("no-store");
      const exposition = await metrics.text();
      expect(exposition).toContain("tell_aviv_worker_healthy 1");
      expect(exposition).not.toContain(metricsToken);
      const ownerA = await redis.get(`${namespace}:realtime-worker`);
      const competitor = launch(3502);
      for (let i = 0; i < 85 && competitor.process.exitCode === null; i++)
        await wait(100);
      expect(competitor.process.exitCode).toBe(1);
      expect(competitor.output).toContain("already owns this namespace");
      expect(await redis.get(`${namespace}:realtime-worker`)).toBe(ownerA);
      const a1 = await connect(0, 3501),
        a2 = await connect(1, 3501);
      const created = await emit(a1, "game:lobby:create", {
        gameId: "connect-four",
        visibility: "private",
      });
      expect(created.error).toBeUndefined();
      code = created.data.code;
      await emit(a2, "game:lobby:join", { code });
      await emit(a1, "game:lobby:ready", { ready: true });
      await emit(a2, "game:lobby:ready", { ready: true });
      const started = await emit(a1, "game:lobby:start");
      expect(started.error).toBeUndefined();
      matchId = started.data.matchId;
      const moved = await emit(a1, "game:action", { type: "drop", column: 0 });
      expect(moved.data.state.board[5][0]).toBe(users[0].id);
      const [firstEpoch] =
        await db`SELECT generation::int FROM realtime_worker_epochs WHERE namespace=${namespace}`;
      a.process.kill("SIGSTOP");
      const b = launch(3502);
      await ready(b);
      const [secondEpoch] =
        await db`SELECT generation::int FROM realtime_worker_epochs WHERE namespace=${namespace}`;
      expect(secondEpoch.generation).toBe(firstEpoch.generation + 1);
      const b1 = await connect(0, 3502),
        b2 = await connect(1, 3502);
      const recovered = await emit(b2, "game:lobby:recover");
      expect(recovered.data.matchId).toBe(started.data.matchId);
      expect(recovered.data.state.board[5][0]).toBe(users[0].id);
      const continued = await emit(b2, "game:action", {
        type: "drop",
        column: 1,
      });
      expect(continued.error).toBeUndefined();
      a.process.kill("SIGCONT");
      const stale = await emit(a1, "game:action", { type: "drop", column: 2 });
      expect(stale.error).toMatch(/ownership was lost/);
      const [canonical] =
        await db`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${code}`;
      expect(canonical.snapshot.state.board[5][2]).toBeNull();
      expect(canonical.snapshot.state.board[5][1]).toBe(users[1].id);
      const cache = JSON.parse(
        (await redis.get(`${namespace}:lobby:${code}`))!,
      );
      expect(cache.state.board).toEqual(canonical.snapshot.state.board);
      await stop(a);
      await stop(b, true);
      b1.disconnect();
      b2.disconnect();
      const c = launch(3501);
      await ready(c);
      const c1 = await connect(0, 3501);
      await connect(1, 3501);
      const afterCrash = await emit(c1, "game:lobby:recover");
      expect(afterCrash.data.matchId).toBe(started.data.matchId);
      expect(afterCrash.data.state.board[5][1]).toBe(users[1].id);
      const finalMove = await emit(c1, "game:action", {
        type: "drop",
        column: 2,
      });
      expect(finalMove.error).toBeUndefined();
      expect(finalMove.data.state.board[5][2]).toBe(users[0].id);
      const [thirdEpoch] =
        await db`SELECT generation::int FROM realtime_worker_epochs WHERE namespace=${namespace}`;
      expect(thirdEpoch.generation).toBe(secondEpoch.generation + 1);
      expect(
        await db`SELECT 1 FROM multiplayer_matches WHERE id=${started.data.matchId}`,
      ).toHaveLength(0);
    }, 45000);
  },
);
