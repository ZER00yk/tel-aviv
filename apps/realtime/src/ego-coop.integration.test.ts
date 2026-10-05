import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { startRealtime } from "./server";
import type { CoopView } from "../../../games/ego-trip/coop-engine";

interface View {
  code: string;
  gameId: string;
  status: string;
  state: CoopView;
  players: { id: string }[];
}
const enabled = process.env.RUN_INTEGRATION === "1";
describe.skipIf(!enabled)(
  "Ego Trip authenticated two-account co-op wire",
  () => {
    let service: Awaited<ReturnType<typeof startRealtime>>;
    let db: typeof import("@tell-aviv/database").db;
    const users = Array.from({ length: 3 }, () => ({
      id: randomUUID(),
      token: randomBytes(32).toString("base64url"),
      username: `coop_${randomBytes(5).toString("hex")}`,
    }));
    const sockets: Socket[] = [];
    const codes: string[] = [];
    const origin = "http://localhost:3000";
    function connect(index: number) {
      const socket = io("http://127.0.0.1:3992", {
        withCredentials: true,
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
    function emit<T = View>(socket: Socket, name: string, input: unknown = {}) {
      return new Promise<{ data: T; error?: string }>((resolve, reject) =>
        socket
          .timeout(4000)
          .emit(
            name,
            input,
            (error: Error | null, result: { data: T; error?: string }) =>
              error ? reject(error) : resolve(result),
          ),
      );
    }
    beforeAll(async () => {
      try {
        process.loadEnvFile(".env");
      } catch {
        /* Environment may be supplied by runner. */
      }
      process.env.REALTIME_PORT = "3992";
      process.env.REALTIME_NAMESPACE = "tell-aviv:test:3992";
      process.env.APP_URL = origin;
      db = (await import("@tell-aviv/database")).db;
      const { hashToken } = await import("@tell-aviv/auth");
      for (const user of users) {
        await db`INSERT INTO users(id,username,display_name) VALUES(${user.id},${user.username},${user.username})`;
        await db`INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(${randomUUID()},${user.id},${hashToken(user.token)},now()+interval '1 hour')`;
      }
      service = await (await import("./server")).startRealtime();
    }, 20_000);
    afterAll(async () => {
      sockets.forEach((socket) => socket.disconnect());
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (service) {
        for (const code of codes) {
          await service.redis.del(`tell-aviv:test:3992:lobby:${code}`);
          await service.redis.zrem("tell-aviv:test:3992:lobbies", code);
        }
        for (const user of users)
          await service.redis.del(
            `tell-aviv:test:3992:user-lobby:${user.id}`,
            `tell-aviv:presence:${user.id}`,
            `tell-aviv:connections:${user.id}`,
          );
      }
      if (db) {
        await db`DELETE FROM multiplayer_matches WHERE lobby_code=ANY(${codes}::varchar[])`;
        await db`DELETE FROM users WHERE id=ANY(${users.map((user) => user.id)}::uuid[])`;
      }
      if (service) await service.close();
    });
    it("starts a private team, validates controls, broadcasts real damage to both accounts and persists a forfeit once", async () => {
      const [a, b, outsider] = await Promise.all(
        users.map((_, i) => connect(i)),
      );
      expect(
        (
          await emit(a, "game:lobby:create", {
            gameId: "ego-trip",
            visibility: "public",
          })
        ).error,
      ).toMatch("private");
      const created = await emit(a, "game:lobby:create", {
        gameId: "ego-trip",
        visibility: "private",
      });
      expect(created.error).toBeUndefined();
      codes.push(created.data.code);
      expect(
        (
          await emit<View[]>(outsider, "game:lobby:list", {
            gameId: "ego-trip",
          })
        ).data,
      ).toEqual([]);
      expect(
        (await emit(b, "game:lobby:join", { code: created.data.code })).data
          .players,
      ).toHaveLength(2);
      expect((await emit(b, "game:lobby:start")).error).toMatch("host");
      expect((await emit(a, "game:lobby:start")).error).toMatch("ready");
      await emit(a, "game:lobby:ready", { ready: true });
      await emit(b, "game:lobby:ready", { ready: true });
      const started = await emit(a, "game:lobby:start");
      expect(started.data.state.players).toHaveLength(2);
      const initialHp = started.data.state.boss.hp;
      const initialX = started.data.state.players[0].x;
      expect(
        (await emit(outsider, "game:lobby:join", { code: created.data.code }))
          .error,
      ).toMatch("running");
      expect(
        (await emit(outsider, "game:action", { type: "coop:input" })).error,
      ).toMatch("Join");
      const controls = (
        sequence: number,
        override: Record<string, unknown> = {},
      ) => ({
        type: "coop:input",
        sequence,
        dx: 0,
        dy: 0,
        aimX: 450,
        aimY: 160,
        fire: true,
        alternate: false,
        dash: false,
        revive: false,
        ...override,
      });
      expect(
        (
          await emit(
            a,
            "game:action",
            controls(0, { hp: 10000, score: 1_000_000 }),
          )
        ).error,
      ).toBeTruthy();
      expect(
        (await emit(a, "game:action", controls(0, { dx: 1, dash: true })))
          .error,
      ).toBeUndefined();
      expect((await emit(a, "game:action", controls(0))).error).toMatch(
        "Stale",
      );
      let view = started.data;
      for (let frame = 1; frame < 35; frame++) {
        const aim = { aimX: view.state.boss.x, aimY: view.state.boss.y };
        const result = await emit(a, "game:action", controls(frame, aim));
        expect(result.error).toBeUndefined();
        view = result.data;
        expect(
          (await emit(b, "game:action", controls(frame, aim))).error,
        ).toBeUndefined();
        await new Promise((resolve) => setTimeout(resolve, 110));
      }
      const recoveredA = await emit(a, "game:lobby:recover");
      const recoveredB = await emit(b, "game:lobby:recover");
      expect(recoveredA.data.state.boss.hp).toBeLessThan(initialHp);
      expect(recoveredA.data.state.players[0].x).toBeGreaterThan(initialX);
      for (const user of users.slice(0, 2))
        expect(
          recoveredA.data.state.players.find((player) => player.id === user.id)
            ?.damage,
        ).toBeGreaterThan(0);
      expect(recoveredB.data.state.boss.maxHp).toBe(initialHp);
      expect(recoveredA.data.state.players[0]).not.toHaveProperty("input");
      expect(recoveredA.data.state.players[1]).not.toHaveProperty("sequence");
      b.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const reconnected = await connect(1);
      expect((await emit(reconnected, "game:lobby:recover")).data.code).toBe(
        created.data.code,
      );
      await emit(a, "game:lobby:leave");
      const ended = await emit(reconnected, "game:lobby:recover");
      expect(ended.data.status).toBe("finished");
      expect(ended.data.state.result?.winners).toEqual([]);
      const matches =
        await db`SELECT result FROM multiplayer_matches WHERE lobby_code=${created.data.code}`;
      expect(matches).toHaveLength(1);
      expect(matches[0].result.reason).toBe("A player left the match");
      const results =
        await db`SELECT score,won FROM multiplayer_results WHERE match_id IN (SELECT id FROM multiplayer_matches WHERE lobby_code=${created.data.code})`;
      expect(results).toHaveLength(2);
      expect(results.every((result) => !result.won && result.score === 0)).toBe(
        true,
      );
      await emit(reconnected, "game:lobby:leave");
    }, 20_000);
  },
);
