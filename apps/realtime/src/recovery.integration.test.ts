import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { io, type Socket } from "socket.io-client";
import type { CoopView } from "../../../games/ego-trip/coop-engine";
import type { PokerView } from "../../../games/casino/multiplayer-poker";
const enabled = process.env.RUN_INTEGRATION === "1";
interface View {
  code: string;
  matchId: string;
  gameId: string;
  status: string;
  hostId: string;
  state: CoopView & { word?: string; drawerId?: string };
  players: { id: string; connected: boolean }[];
}
type PokerLobbyView = Omit<View, "state"> & { state: PokerView };
describe.skipIf(!enabled)(
  "actual realtime process crash and durable recovery",
  () => {
    let child: ChildProcess | undefined,
      db: typeof import("@tell-aviv/database").db,
      redis: Redis;
    const namespace = `tell-aviv:recovery:${randomBytes(6).toString("hex")}`,
      origin = "http://localhost:3000";
    const users = Array.from({ length: 5 }, () => ({
      id: randomUUID(),
      token: randomBytes(32).toString("base64url"),
      username: `recover_${randomBytes(5).toString("hex")}`,
    }));
    const sockets: Socket[] = [],
      codes: string[] = [];
    let output = "";
    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    async function start() {
      output = "";
      child = spawn(
        process.execPath,
        ["--env-file=.env", "--import", "tsx", "apps/realtime/src/index.ts"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            REALTIME_PORT: "3993",
            REALTIME_HOST: "127.0.0.1",
            REALTIME_NAMESPACE: namespace,
            APP_URL: origin,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout?.on("data", (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-8000);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-8000);
      });
      for (let attempt = 0; attempt < 50; attempt++) {
        if (child.exitCode !== null)
          throw new Error(`Realtime child exited: ${output}`);
        try {
          const res = await fetch("http://127.0.0.1:3993/health", {
            signal: AbortSignal.timeout(500),
          });
          if (res.ok) return;
        } catch {
          /* worker lease expires after a crash */
        }
        await wait(200);
      }
      throw new Error(`Realtime child did not become ready: ${output}`);
    }
    async function stop(crash = false) {
      if (!child || child.exitCode !== null) return;
      const processToStop = child;
      const exited = new Promise<void>((resolve) =>
        processToStop.once("exit", () => resolve()),
      );
      processToStop.kill(crash ? "SIGKILL" : "SIGTERM");
      await Promise.race([
        exited,
        wait(7000).then(() => {
          if (processToStop.exitCode === null) processToStop.kill("SIGKILL");
        }),
      ]);
      child = undefined;
    }
    async function connect(index: number) {
      const socket = io("http://127.0.0.1:3993", {
        reconnection: false,
        transports: ["polling"],
        extraHeaders: {
          Origin: origin,
          Cookie: `ta_session=${users[index].token}`,
        },
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("connect_error", reject);
      });
      return socket;
    }
    function emit<T = View>(
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
            (err: Error | null, result: { data: T; error?: string }) =>
              err ? reject(err) : resolve(result),
          ),
      );
    }
    async function match(
      a: Socket,
      b: Socket,
      gameId: string,
      coopMode = "gauntlet",
    ) {
      const created = await emit(a, "game:lobby:create", {
        gameId,
        visibility: "private",
        coopMode,
      });
      expect(created.error).toBeUndefined();
      codes.push(created.data.code);
      expect(
        (await emit(b, "game:lobby:join", { code: created.data.code })).error,
      ).toBeUndefined();
      await emit(a, "game:lobby:ready", { ready: true });
      await emit(b, "game:lobby:ready", { ready: true });
      const started = await emit(a, "game:lobby:start");
      expect(started.error).toBeUndefined();
      return started.data;
    }
    beforeAll(async () => {
      try {
        process.loadEnvFile(".env");
      } catch {
        /* runner env */
      }
      db = (await import("@tell-aviv/database")).db;
      const { hashToken } = await import("@tell-aviv/auth");
      redis = new Redis(process.env.REDIS_URL!);
      for (const user of users) {
        await db`INSERT INTO users(id,username,display_name) VALUES(${user.id},${user.username},${user.username})`;
        await db`INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(${randomUUID()},${user.id},${hashToken(user.token)},now()+interval '1 hour')`;
      }
      await start();
    }, 20_000);
    afterAll(async () => {
      sockets.forEach((socket) => socket.disconnect());
      await stop();
      if (redis) {
        const keys = await redis.keys(`${namespace}:*`);
        if (keys.length) await redis.del(...keys);
        await redis.quit();
      }
      if (db) {
        await db`DELETE FROM multiplayer_checkpoints WHERE namespace=${namespace}`;
        await db`DELETE FROM multiplayer_matches WHERE lobby_code=ANY(${codes}::varchar[])`;
        await db`DELETE FROM users WHERE id=ANY(${users.map((user) => user.id)}::uuid[])`;
        await (await import("@tell-aviv/database")).closeDatabase();
      }
    }, 15_000);
    it("restores both campaign accounts after SIGKILL with Redis retained, rejects stale controls and transfers a departed leader", async () => {
      let a = await connect(0),
        b = await connect(1);
      const initial = await match(a, b, "ego-trip", "campaign");
      expect(initial.state.campaign?.totalRooms).toBe(40);
      const controls = (sequence: number) => ({
        type: "coop:input",
        sequence,
        dx: 0,
        dy: 0,
        aimX: initial.state.campaign!.enemies[0].x,
        aimY: initial.state.campaign!.enemies[0].y,
        fire: true,
        alternate: false,
        dash: false,
        revive: false,
      });
      for (let frame = 0; frame < 16; frame++) {
        expect(
          (await emit(a, "game:action", controls(frame))).error,
        ).toBeUndefined();
        await emit(b, "game:action", controls(frame));
        await wait(120);
      }
      await wait(1200);
      const [checkpoint] =
        await db`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${initial.code}`;
      expect(
        checkpoint.snapshot.state.players[users[0].id].damage,
      ).toBeGreaterThan(0);
      await stop(true);
      a.disconnect();
      b.disconnect();
      await start();
      a = await connect(0);
      b = await connect(1);
      const restoredA = (await emit(a, "game:lobby:recover")).data,
        restoredB = (await emit(b, "game:lobby:recover")).data;
      expect(restoredA.matchId).toBe(initial.matchId);
      expect(restoredB.code).toBe(initial.code);
      expect(restoredA.status).toBe("playing");
      expect(
        restoredA.state.players.find((p) => p.id === users[0].id)!.damage,
      ).toBeGreaterThan(0);
      expect(restoredA.state.campaign!.room.index).toBe(
        initial.state.campaign!.room.index,
      );
      expect(restoredA.state).not.toHaveProperty("lastTick");
      expect(restoredA.state.campaign).not.toHaveProperty("seed");
      expect(restoredA.state.players[1]).not.toHaveProperty("input");
      expect((await emit(a, "game:action", controls(0))).error).toMatch(
        "Stale",
      );
      await emit(a, "game:lobby:leave");
      const remaining = (await emit(b, "game:lobby:recover")).data;
      expect(remaining.status).toBe("playing");
      expect(remaining.hostId).toBe(users[1].id);
      expect(remaining.players).toHaveLength(1);
      await emit(b, "game:lobby:leave");
      expect(output).not.toContain("Game tick failed");
    }, 30_000);
    it("rehydrates lost Redis match/membership from SQL while keeping the drawing word private", async () => {
      let a = await connect(0),
        b = await connect(1);
      const initial = await match(a, b, "drawing");
      const secret = initial.state.word;
      expect(secret).toBeTruthy();
      expect(
        (await emit(b, "game:lobby:recover")).data.state.word,
      ).toBeUndefined();
      await stop(true);
      a.disconnect();
      b.disconnect();
      // Delete only this fixture namespace to emulate lost ephemeral Redis data.
      const keys = await redis.keys(`${namespace}:*`);
      if (keys.length) await redis.del(...keys);
      await start();
      a = await connect(0);
      b = await connect(1);
      const drawer = (await emit(a, "game:lobby:recover")).data,
        guesser = (await emit(b, "game:lobby:recover")).data;
      expect(drawer.matchId).toBe(initial.matchId);
      expect(drawer.state.word).toBe(secret);
      expect(guesser.state.word).toBeUndefined();
      expect(guesser.state).not.toHaveProperty("questions");
      expect(
        (await emit(b, "game:action", { type: "guess", text: secret })).error,
      ).toBeUndefined();
      await emit(a, "game:lobby:leave");
      await emit(b, "game:lobby:leave");
    }, 20_000);
    it("plays chess and forced checkers captures through the shared wire and records outcomes once", async () => {
      const a = await connect(0),
        b = await connect(1);
      const chess = await match(a, b, "chess");
      const emptyChess = await redis.get(`${namespace}:lobby:${chess.code}`);
      expect(
        (
          await emit(b, "game:action", {
            type: "board:move",
            from: "e7",
            to: "e5",
          })
        ).error,
      ).toMatch("turn");
      for (const [socket, from, to] of [
        [a, "f2", "f3"],
        [b, "e7", "e5"],
        [a, "g2", "g4"],
        [b, "d8", "h4"],
      ] as [Socket, string, string][]) {
        expect(
          (await emit(socket, "game:action", { type: "board:move", from, to }))
            .error,
        ).toBeUndefined();
        if (from === "f2")
          // SQL accepted this turn; model a crash before the Redis write.
          await redis.set(
            `${namespace}:lobby:${chess.code}`,
            emptyChess!,
            "EX",
            3600,
          );
      }
      const ended = (await emit(a, "game:lobby:recover")).data;
      expect(ended.status).toBe("finished");
      expect(ended.state.result?.reason).toBe("Checkmate");
      expect(ended.state.result?.winners).toEqual([users[1].id]);
      expect(
        await db`SELECT 1 FROM multiplayer_matches WHERE id=${chess.matchId}`,
      ).toHaveLength(1);
      await emit(a, "game:lobby:leave");
      await emit(b, "game:lobby:leave");
      const checkers = await match(a, b, "checkers");
      for (const [socket, from, to] of [
        [a, "c3", "d4"],
        [b, "b6", "c5"],
      ] as [Socket, string, string][]) {
        expect(
          (await emit(socket, "game:action", { type: "board:move", from, to }))
            .error,
        ).toBeUndefined();
      }
      expect(
        (
          await emit(a, "game:action", {
            type: "board:move",
            from: "a3",
            to: "b4",
          })
        ).error,
      ).toMatch("mandatory");
      expect(
        (
          await emit(a, "game:action", {
            type: "board:move",
            from: "d4",
            to: "b6",
          })
        ).error,
      ).toBeUndefined();
      await emit(b, "game:action", { type: "board:resign" });
      const checkersEnded = (await emit(a, "game:lobby:recover")).data;
      expect(checkersEnded.status).toBe("finished");
      expect(checkersEnded.state.result?.winners).toEqual([users[0].id]);
      expect(
        await db`SELECT 1 FROM multiplayer_matches WHERE id=${checkers.matchId}`,
      ).toHaveLength(1);
      await emit(a, "game:lobby:leave");
      await emit(b, "game:lobby:leave");
    }, 15_000);
    it("commits poker stakes and cards together, recovers SQL-ahead stale Redis and Redis loss after SIGKILL, and cashes out exactly once", async () => {
      let a = await connect(0),
        b = await connect(1);
      const created = await emit(a, "game:lobby:create", {
        gameId: "poker",
        visibility: "private",
      });
      expect(created.error).toBeUndefined();
      codes.push(created.data.code);
      expect(
        (await emit(b, "game:lobby:join", { code: created.data.code })).error,
      ).toBeUndefined();
      expect(
        (await emit(a, "game:lobby:poker-options", { buyIn: 10000 })).error,
      ).toBeUndefined();
      await emit(a, "game:lobby:ready", { ready: true });
      await emit(b, "game:lobby:ready", { ready: true });
      expect((await emit(a, "game:lobby:start")).error).toMatch("Not enough");
      expect((await emit(a, "game:lobby:recover")).data.status).toBe("waiting");
      expect(
        await db`SELECT 1 FROM casino_poker_hands WHERE namespace=${namespace} AND lobby_code=${created.data.code}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT 1 FROM currency_accounts WHERE user_id=ANY(${users.slice(0, 2).map((u) => u.id)}::uuid[]) AND currency='casino-credits'`,
      ).toHaveLength(0);
      await emit(a, "game:lobby:poker-options", { buyIn: 100 });
      await emit(a, "game:lobby:ready", { ready: true });
      await emit(b, "game:lobby:ready", { ready: true });
      const started = await emit<PokerLobbyView>(a, "game:lobby:start");
      expect(started.error).toBeUndefined();
      const initial = started.data;
      const pocket = initial.state.seats.find(
        (p) => p.userId === users[0].id,
      )!.hole;
      expect(pocket.every((n) => n >= 0)).toBe(true);
      expect(
        initial.state.seats.find((p) => p.userId === users[1].id)!.hole,
      ).toEqual([-1, -1]);
      expect(initial.state).not.toHaveProperty("deck");
      expect(initial.state).not.toHaveProperty("acted");
      expect(
        (await emit(b, "game:action", { type: "poker:all-in" })).error,
      ).toMatch("turn");
      expect(
        await db`SELECT balance FROM currency_accounts WHERE user_id=ANY(${users.slice(0, 2).map((u) => u.id)}::uuid[]) AND currency='casino-credits'`,
      ).toEqual(
        expect.arrayContaining([{ balance: "900" }, { balance: "900" }]),
      );
      const priorRevision = await redis.get(
        `${namespace}:lobby:${initial.code}`,
      );
      expect(
        (await emit(a, "game:action", { type: "poker:all-in" })).error,
      ).toBeUndefined();
      await redis.set(
        `${namespace}:lobby:${initial.code}`,
        priorRevision!,
        "EX",
        3600,
      );
      const liveRecovered = (
        await emit<PokerLobbyView>(b, "game:lobby:recover")
      ).data;
      expect(
        liveRecovered.state.seats.find((p) => p.userId === users[0].id)!.allIn,
      ).toBe(true);
      expect(liveRecovered.state.revision).toBeGreaterThan(
        initial.state.revision,
      );
      // Re-create the durable SQL / older Redis window, then kill the owner.
      await redis.set(
        `${namespace}:lobby:${initial.code}`,
        priorRevision!,
        "EX",
        3600,
      );
      await stop(true);
      a.disconnect();
      b.disconnect();
      await start();
      a = await connect(0);
      b = await connect(1);
      const afterStaleCrash = (
        await emit<PokerLobbyView>(b, "game:lobby:recover")
      ).data;
      expect(
        afterStaleCrash.state.seats.find((p) => p.userId === users[0].id)!
          .allIn,
      ).toBe(true);
      expect(afterStaleCrash.state.turn).toBe(users[1].id);
      await stop(true);
      a.disconnect();
      b.disconnect();
      const keys = await redis.keys(`${namespace}:*`);
      if (keys.length) await redis.del(...keys);
      await start();
      a = await connect(0);
      b = await connect(1);
      const restored = (await emit<PokerLobbyView>(a, "game:lobby:recover"))
        .data;
      const peer = (await emit<PokerLobbyView>(b, "game:lobby:recover")).data;
      expect(restored.matchId).toBe(initial.matchId);
      expect(
        restored.state.seats.find((p) => p.userId === users[0].id)!.hole,
      ).toEqual(pocket);
      expect(
        peer.state.seats.find((p) => p.userId === users[0].id)!.hole,
      ).toEqual([-1, -1]);
      expect(restored.state.turn).toBe(users[1].id);
      expect(
        restored.state.seats.find((p) => p.userId === users[0].id)!.allIn,
      ).toBe(true);
      const settled = await emit<PokerLobbyView>(b, "game:action", {
        type: "poker:call",
      });
      expect(settled.error).toBeUndefined();
      expect(settled.data.status).toBe("finished");
      expect(settled.data.state.phase).toBe("settled");
      expect(settled.data.state.community).toHaveLength(5);
      expect(
        Object.values(settled.data.state.payouts!).reduce(
          (sum, n) => sum + n,
          0,
        ),
      ).toBe(200);
      expect(
        settled.data.state.seats.every((p) => p.hole.every((n) => n >= 0)),
      ).toBe(true);
      for (let n = 0; n < 3; n++) await emit(a, "game:lobby:recover");
      expect(
        (await emit(a, "game:action", { type: "poker:all-in" })).error,
      ).toBeTruthy();
      const [total] =
        await db`SELECT sum(balance)::integer AS balance FROM currency_accounts WHERE user_id=ANY(${users.slice(0, 2).map((u) => u.id)}::uuid[]) AND currency='casino-credits'`;
      expect(total.balance).toBe(2000);
      const ledger =
        await db`SELECT user_id,reason,count(*)::integer AS count FROM currency_ledger WHERE reference_id=${initial.matchId} GROUP BY user_id,reason`;
      expect(
        ledger.filter((r) => r.reason === "multiplayer poker buy-in"),
      ).toHaveLength(2);
      expect(ledger.every((r) => r.count === 1)).toBe(true);
      expect(
        await db`SELECT 1 FROM casino_poker_escrows WHERE match_id=${initial.matchId} AND status='active'`,
      ).toHaveLength(0);
      expect(
        await db`SELECT 1 FROM multiplayer_matches WHERE id=${initial.matchId}`,
      ).toHaveLength(1);
      const newcomer = await connect(2);
      const waiting = await emit<PokerLobbyView>(newcomer, "game:lobby:join", {
        code: initial.code,
      });
      expect(waiting.error).toBeUndefined();
      expect(waiting.data.state).toBeNull();
      await emit(newcomer, "game:lobby:leave");
      await db`UPDATE users SET disabled=true WHERE id=${users[1].id}`;
      const disabledPruned = (
        await emit<PokerLobbyView>(a, "game:lobby:recover")
      ).data;
      expect(disabledPruned.state.phase).toBe("settled");
      expect(disabledPruned.state.result?.reason).toBe("Showdown");
      expect(disabledPruned.players.map((p) => p.id)).toEqual([users[0].id]);
      expect(
        await db`SELECT 1 FROM currency_ledger WHERE reference_id=${initial.matchId} AND reason='multiplayer poker abort refund'`,
      ).toHaveLength(0);
      await db`UPDATE users SET disabled=false WHERE id=${users[1].id}`;
      await emit(a, "game:lobby:leave");
      await emit(b, "game:lobby:leave");
      expect(output).not.toContain("Game tick failed");
    }, 30_000);
    it("prunes an account erased after poker settlement without rewriting the paid outcome or refunding it", async () => {
      const a = await connect(0),
        b = await connect(4);
      const initial = await match(a, b, "poker");
      expect(
        (await emit(a, "game:action", { type: "poker:fold" })).error,
      ).toBeUndefined();
      const before = (await emit<PokerLobbyView>(a, "game:lobby:recover")).data;
      const [wallet] =
        await db`SELECT balance FROM currency_accounts WHERE user_id=${users[0].id} AND currency='casino-credits'`;
      await db`DELETE FROM users WHERE id=${users[4].id}`;
      const after = (await emit<PokerLobbyView>(a, "game:lobby:recover")).data;
      expect(after.state.phase).toBe("settled");
      expect(after.state.result).toEqual(before.state.result);
      expect(after.players.map((p) => p.id)).toEqual([users[0].id]);
      const [current] =
        await db`SELECT balance FROM currency_accounts WHERE user_id=${users[0].id} AND currency='casino-credits'`;
      expect(current.balance).toBe(wallet.balance);
      expect(
        await db`SELECT 1 FROM currency_ledger WHERE reference_id=${initial.matchId} AND reason='multiplayer poker abort refund'`,
      ).toHaveLength(0);
      const [hand] =
        await db`SELECT status FROM casino_poker_hands WHERE match_id=${initial.matchId}`;
      expect(hand.status).toBe("settled");
      await emit(a, "game:lobby:leave");
      expect(output).not.toContain("Game tick failed");
    }, 15_000);
    it("refunds a live poker table when an account is erased and cannot pay out its stale private engine", async () => {
      const a = await connect(0),
        b = await connect(3);
      const [before] =
        await db`SELECT balance FROM currency_accounts WHERE user_id=${users[0].id} AND currency='casino-credits'`;
      const initial = await match(a, b, "poker");
      await db`DELETE FROM users WHERE id=${users[3].id}`;
      let view: PokerLobbyView | undefined;
      for (let i = 0; i < 15; i++) {
        view = (await emit<PokerLobbyView>(a, "game:lobby:recover")).data;
        if (view.status === "finished") break;
        await wait(100);
      }
      expect(view?.status).toBe("finished");
      expect(view?.state.phase).toBe("cancelled");
      expect(view?.state.result?.winners).toEqual([]);
      expect(view?.players.map((p) => p.id)).toEqual([users[0].id]);
      expect(
        (await emit(a, "game:action", { type: "poker:all-in" })).error,
      ).toBeTruthy();
      const [after] =
        await db`SELECT balance FROM currency_accounts WHERE user_id=${users[0].id} AND currency='casino-credits'`;
      expect(after.balance).toBe(before.balance);
      expect(
        await db`SELECT 1 FROM currency_ledger WHERE user_id=${users[0].id} AND reference_id=${initial.matchId} AND reason='multiplayer poker abort refund'`,
      ).toHaveLength(1);
      const [hand] =
        await db`SELECT status FROM casino_poker_hands WHERE match_id=${initial.matchId}`;
      expect(hand.status).toBe("refunded");
      await emit(a, "game:lobby:leave");
      expect(output).not.toContain("violates foreign key");
      expect(output).not.toContain("Game tick failed");
    }, 15_000);
    it("invalidates erased-player checkpoints and ends a live Redis match without a result foreign-key failure", async () => {
      const a = await connect(0),
        b = await connect(2);
      const initial = await match(a, b, "ego-trip", "campaign");
      await db`DELETE FROM users WHERE id=${users[2].id}`;
      expect(
        await db`SELECT 1 FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${initial.code}`,
      ).toHaveLength(0);
      let view: View | undefined;
      for (let i = 0; i < 12; i++) {
        const result = await emit(a, "game:lobby:recover");
        view = result.data;
        if (view.status === "finished") break;
        await wait(100);
      }
      expect(view?.status).toBe("finished");
      expect(view?.players.map((p) => p.id)).toEqual([users[0].id]);
      expect(view?.state.result?.reason).toBe(
        "A player account became unavailable",
      );
      const results =
        await db`SELECT user_id,won FROM multiplayer_results WHERE match_id=${initial.matchId}`;
      expect(results).toHaveLength(1);
      expect(results[0].user_id).toBe(users[0].id);
      expect(results[0].won).toBe(false);
      await emit(a, "game:lobby:leave");
      expect(output).not.toContain("violates foreign key");
      expect(output).not.toContain("Game tick failed");
    }, 15_000);
  },
);
