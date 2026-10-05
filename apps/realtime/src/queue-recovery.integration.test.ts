import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import Redis from "ioredis";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QueueStatus } from "./queue";
interface Room {
  code: string;
  matchId: string;
  status: string;
  state: { board: (string | null)[][]; turn: string };
}
describe.runIf(process.env.RUN_INTEGRATION === "1")(
  "queue and matched game survive actual process loss",
  () => {
    const namespace = `tell-aviv:queue-recovery:${randomBytes(6).toString("hex")}`;
    const origin = "http://localhost:3000",
      url = "http://127.0.0.1:3997";
    const users = Array.from({ length: 2 }, () => ({
      id: randomUUID(),
      username: `qr_${randomBytes(5).toString("hex")}`,
      token: randomBytes(32).toString("base64url"),
    }));
    let child: ChildProcess | undefined,
      db: typeof import("@tell-aviv/database").db,
      redis: Redis;
    let output = "",
      code = "";
    const sockets: Socket[] = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    async function start() {
      output = "";
      child = spawn(
        process.execPath,
        ["--env-file=.env", "--import", "tsx", "apps/realtime/src/index.ts"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            REALTIME_PORT: "3997",
            REALTIME_HOST: "127.0.0.1",
            REALTIME_NAMESPACE: namespace,
            APP_URL: origin,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout?.on("data", (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-6000);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-6000);
      });
      for (let attempt = 0; attempt < 70; attempt++) {
        if (child.exitCode !== null)
          throw new Error(`Queue worker exited: ${output}`);
        try {
          if (
            (await fetch(`${url}/health`, { signal: AbortSignal.timeout(400) }))
              .ok
          )
            return;
        } catch {
          /* The worker lease must expire after a crash. */
        }
        await wait(150);
      }
      throw new Error(`Queue worker did not start: ${output}`);
    }
    async function stop(crash = false) {
      if (!child || child.exitCode !== null) return;
      const owned = child;
      const done = new Promise<void>((resolve) =>
        owned.once("exit", () => resolve()),
      );
      owned.kill(crash ? "SIGKILL" : "SIGTERM");
      await Promise.race([
        done,
        wait(7000).then(() => {
          if (owned.exitCode === null) owned.kill("SIGKILL");
        }),
      ]);
      child = undefined;
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
    function emit<T = QueueStatus>(
      socket: Socket,
      event: string,
      payload: unknown = {},
    ) {
      return new Promise<{ data: T; error?: string }>((resolve, reject) =>
        socket
          .timeout(6000)
          .emit(
            event,
            payload,
            (error: Error | null, response: { data: T; error?: string }) =>
              error ? reject(error) : resolve(response),
          ),
      );
    }
    async function waitForStatus(ticketId: string, expected: string) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const [ticket] =
          await db`SELECT status FROM matchmaking_tickets WHERE id=${ticketId}`;
        if (ticket?.status === expected) return;
        await wait(200);
      }
      throw new Error(`Queue ticket did not reach ${expected}`);
    }
    beforeAll(async () => {
      try {
        process.loadEnvFile(".env");
      } catch {
        /* Caller environment is supported. */
      }
      db = (await import("@tell-aviv/database")).db;
      redis = new Redis(process.env.REDIS_URL!);
      const { hashToken } = await import("@tell-aviv/auth");
      for (const user of users) {
        await db`INSERT INTO users(id,username,display_name) VALUES(${user.id},${user.username},'Queue recovery fixture')`;
        await db`INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(${randomUUID()},${user.id},${hashToken(user.token)},now()+interval '1 hour')`;
      }
      await start();
    }, 20000);
    afterAll(async () => {
      for (const socket of sockets) socket.disconnect();
      await stop();
      if (redis) {
        const keys = await redis.keys(`${namespace}:*`);
        if (keys.length) await redis.del(...keys);
        for (const user of users) {
          const keys = await redis.keys(`tell-aviv:rate:${user.id}:*`);
          if (keys.length) await redis.del(...keys);
          await redis.del(
            `tell-aviv:connections:${user.id}`,
            `tell-aviv:presence:${user.id}`,
          );
        }
        await redis.quit();
      }
      if (db) {
        await db`DELETE FROM multiplayer_matches WHERE lobby_code=${code}`;
        await db`DELETE FROM multiplayer_checkpoints WHERE namespace=${namespace}`;
        await db`DELETE FROM matchmaking_tickets WHERE namespace=${namespace}`;
        await db`DELETE FROM users WHERE id=ANY(${users.map((user) => user.id)}::uuid[])`;
      }
    }, 15000);
    it("preserves a waiting reservation, deduplicates reconnect, and restores a playing room from SQL after Redis loss", async () => {
      let a = await connect(0);
      const joined = await emit(a, "game:queue:join", {
        gameId: "connect-four",
        region: "europe",
      });
      expect(joined.error).toBeUndefined();
      const ticketId = joined.data.ticketId;
      await stop(true);
      await start();
      a = await connect(0);
      const b = await connect(1);
      const recovered = await emit(a, "game:queue:status");
      expect(recovered.data.ticketId).toBe(ticketId);
      expect(recovered.data.status).toBe("waiting");
      expect(
        (
          await emit(a, "game:queue:join", {
            gameId: "connect-four",
            region: "europe",
          })
        ).data.ticketId,
      ).toBe(ticketId);
      expect(
        (
          await emit(b, "game:queue:join", {
            gameId: "connect-four",
            region: "europe",
          })
        ).error,
      ).toBeUndefined();
      await waitForStatus(ticketId, "matched");
      const match = await emit(a, "game:queue:status");
      code = match.data.lobbyCode!;
      await emit(a, "game:lobby:ready", { ready: true });
      await emit(b, "game:lobby:ready", { ready: true });
      const started = await emit<Room>(a, "game:lobby:start");
      expect(started.data.status).toBe("playing");
      const matchId = started.data.matchId;
      const dropped = await emit<Room>(a, "game:action", {
        type: "drop",
        column: 0,
      });
      expect(dropped.data.state.board[5][0]).toBe(users[0].id);
      await waitForStatus(ticketId, "playing");
      await stop(true);
      const ownedKeys = await redis.keys(`${namespace}:*`);
      if (ownedKeys.length) await redis.del(...ownedKeys);
      await start();
      a = await connect(0);
      const restoredB = await connect(1);
      const room = await emit<Room>(restoredB, "game:lobby:recover");
      expect(room.data.code).toBe(code);
      expect(room.data.matchId).toBe(matchId);
      expect(room.data.state.board[5][0]).toBe(users[0].id);
      expect(room.data.state.turn).toBe(users[1].id);
      const continued = await emit<Room>(restoredB, "game:action", {
        type: "drop",
        column: 1,
      });
      expect(continued.error).toBeUndefined();
      expect(continued.data.state.board[5][1]).toBe(users[1].id);
      expect((await emit(a, "game:queue:status")).data.ticketId).toBe(ticketId);
      expect(
        await db`SELECT 1 FROM matchmaking_tickets WHERE namespace=${namespace} AND leader_id=${users[0].id}`,
      ).toHaveLength(1);
    }, 35000);
  },
);
