import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import type { TransactionSql } from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@tell-aviv/database";
import { LobbyStore } from "../apps/realtime/src/store";
import {
  applyGameAction,
  createLobby,
  startGame,
  tickGame,
  type Lobby,
} from "../apps/realtime/src/engines";

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "atomic multiplayer outcomes and recovery checkpoints",
  () => {
    let namespace: string;
    let redis: Redis;
    let store: LobbyStore;
    let users: { id: string; username: string }[];
    const matches: string[] = [];

    beforeEach(async () => {
      namespace = `checkpoint-fixture-${randomUUID()}`;
      redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
      store = new LobbyStore(redis, namespace);
      users = Array.from({ length: 2 }, () => {
        const id = randomUUID();
        return { id, username: `checkpoint_${id.slice(0, 8)}` };
      });
      for (const user of users)
        await db`INSERT INTO users(id,username,display_name) VALUES(${user.id},${user.username},'Checkpoint fixture')`;
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await db`DELETE FROM multiplayer_checkpoints WHERE namespace=${namespace}`;
      for (const matchId of matches)
        await db`DELETE FROM multiplayer_matches WHERE id=${matchId}`;
      matches.length = 0;
      for (const user of users)
        await db`DELETE FROM users WHERE id=${user.id}`;
      // Exact random namespace; shared services and other fixtures remain intact.
      const keys = await redis.keys(`${namespace}:*`);
      if (keys.length) await redis.del(...keys);
      await redis.quit();
    });

    async function seed(gameId: "chess" | "reaction") {
      const lobby = createLobby(users[0], gameId, "private", "FIXTURE");
      lobby.players.push({ ...users[1], ready: false, connected: true });
      lobby.players.forEach((player) => (player.ready = true));
      startGame(lobby);
      if (lobby.state?.kind === "reaction") {
        lobby.state.round = 4;
        lobby.state.deadline = Date.now() - 1;
        lobby.state.scores[users[0].id] = 7;
        lobby.state.scores[users[1].id] = 2;
      }
      matches.push(lobby.matchId);
      await db`INSERT INTO multiplayer_checkpoints(namespace,lobby_code,match_id,snapshot,expires_at) VALUES(${namespace},${lobby.code},${lobby.matchId},${db.json(JSON.parse(JSON.stringify(lobby)))},now()+interval '24 hours')`;
      const pipeline = redis
        .pipeline()
        .set(`${namespace}:lobby:${lobby.code}`, JSON.stringify(lobby), "EX", 3600)
        .zadd(`${namespace}:lobbies`, Date.now(), lobby.code);
      for (const user of users) {
        pipeline.set(`${namespace}:user-lobby:${user.id}`, lobby.code, "EX", 3600);
        await db`INSERT INTO multiplayer_checkpoint_members(namespace,lobby_code,user_id) VALUES(${namespace},${lobby.code},${user.id})`;
      }
      await pipeline.exec();
      return lobby;
    }

    function injectCheckpointFailure(statement: "INSERT" | "DELETE") {
      const begin = db.begin.bind(db);
      const replacement = (callback: (sql: TransactionSql) => Promise<unknown>) =>
        begin(async (sql) => {
          const guarded = new Proxy(sql, {
            apply(target, receiver, args: unknown[]) {
              const strings = args[0];
              if (
                Array.isArray(strings) &&
                strings.join(" ").trimStart().startsWith(`${statement} `) &&
                strings.join(" ").includes("multiplayer_checkpoints")
              )
                throw new Error("Injected checkpoint persistence failure");
              return Reflect.apply(target, receiver, args);
            },
          });
          return callback(guarded);
        });
      return vi.spyOn(db, "begin").mockImplementation(replacement as typeof db.begin);
    }

    const finish = (lobby: Lobby) => {
      if (lobby.state?.kind === "chess")
        applyGameAction(lobby, users[1].id, { type: "board:resign" });
      else expect(tickGame(lobby)).toBe(true);
    };

    it.each(["chess", "reaction"] as const)(
      "rolls back a completed %s result with a failed checkpoint and commits the retry once",
      async (gameId) => {
        const initial = await seed(gameId);
        const spy = injectCheckpointFailure("INSERT");
        await expect(store.mutate(initial.code, finish)).rejects.toThrow(
          "Injected checkpoint persistence failure",
        );
        spy.mockRestore();
        expect(
          await db`SELECT 1 FROM multiplayer_matches WHERE id=${initial.matchId}`,
        ).toHaveLength(0);
        expect(
          await db`SELECT 1 FROM multiplayer_results WHERE match_id=${initial.matchId}`,
        ).toHaveLength(0);
        const [before] =
          await db`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${initial.code}`;
        expect(before.snapshot.status).toBe("playing");
        expect(JSON.parse((await redis.get(`${namespace}:lobby:${initial.code}`))!).status).toBe("playing");

        const ended = await store.mutate(initial.code, finish);
        expect(ended.status).toBe("finished");
        expect(ended.recorded).toBe(true);
        const [after] =
          await db`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${initial.code}`;
        expect(after.snapshot.state.result).toEqual(ended.state?.result);
        expect(after.snapshot.recorded).toBe(true);
        await store.mutate(initial.code, () => undefined);
        expect(
          await db`SELECT 1 FROM multiplayer_matches WHERE id=${initial.matchId}`,
        ).toHaveLength(1);
        const results =
          await db`SELECT user_id,won FROM multiplayer_results WHERE match_id=${initial.matchId}`;
        expect(results).toHaveLength(2);
        expect(results.find((result) => result.user_id === users[0].id)?.won).toBe(true);
      },
    );

    it("recovers a committed timed-game outcome from an older playing cache without overwriting it at startup", async () => {
      const initial = await seed("reaction");
      const stale = (await redis.get(`${namespace}:lobby:${initial.code}`))!;
      const ended = await store.mutate(initial.code, finish);
      await redis.set(`${namespace}:lobby:${initial.code}`, stale, "EX", 3600);

      const recovered = await store.get(initial.code);
      expect(recovered?.status).toBe("finished");
      expect(recovered?.state?.result).toEqual(ended.state?.result);
      expect(recovered?.recorded).toBe(true);
      // An unlocked read leaves Redis alone even while selecting newer SQL.
      expect(await redis.get(`${namespace}:lobby:${initial.code}`)).toBe(stale);
      await store.initializeRecovery();
      const [checkpoint] =
        await db`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${initial.code}`;
      expect(checkpoint.snapshot.status).toBe("finished");
      expect(checkpoint.snapshot.state.result).toEqual(ended.state?.result);
      expect(JSON.parse((await redis.get(`${namespace}:lobby:${initial.code}`))!).status).toBe("finished");
      expect(
        await db`SELECT 1 FROM multiplayer_matches WHERE id=${initial.matchId}`,
      ).toHaveLength(1);
      expect(
        await db`SELECT 1 FROM multiplayer_results WHERE match_id=${initial.matchId}`,
      ).toHaveLength(2);
    });

    it("recovers a committed new match over an older finished cache", async () => {
      const initial = await seed("reaction");
      await store.mutate(initial.code, finish);
      const stale = (await redis.get(`${namespace}:lobby:${initial.code}`))!;
      const next = await store.mutate(initial.code, (lobby) => {
        lobby.players.forEach((player) => (player.ready = true));
        startGame(lobby);
      });
      matches.push(next.matchId);
      expect(next.matchId).not.toBe(initial.matchId);
      await redis.set(`${namespace}:lobby:${initial.code}`, stale, "EX", 3600);

      const recovered = await store.get(initial.code);
      expect(recovered?.matchId).toBe(next.matchId);
      expect(recovered?.status).toBe("playing");
      expect(recovered?.recorded).toBe(false);
      expect(recovered?.state?.result).toBeUndefined();
      await store.initializeRecovery();
      const [checkpoint] =
        await db`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${initial.code}`;
      expect(checkpoint.snapshot.matchId).toBe(next.matchId);
      expect(checkpoint.snapshot.status).toBe("playing");
      expect(checkpoint.snapshot.recoveryPausedAt).toBeGreaterThan(0);
      expect(checkpoint.snapshot.players.every((player: { connected: boolean }) => !player.connected)).toBe(true);
      expect(
        await db`SELECT 1 FROM multiplayer_matches WHERE id=${next.matchId}`,
      ).toHaveLength(0);
    });

    it("retains newer unsaved periodic simulation within the same playing match", async () => {
      const initial = await seed("reaction");
      if (initial.state?.kind !== "reaction") throw new Error("Invalid fixture");
      initial.state.scores[users[0].id] = 99;
      await redis.set(`${namespace}:lobby:${initial.code}`, JSON.stringify(initial), "EX", 3600);
      const recovered = await store.get(initial.code);
      expect(recovered?.state?.kind).toBe("reaction");
      if (recovered?.state?.kind !== "reaction") throw new Error("Invalid recovery");
      expect(recovered.state.scores[users[0].id]).toBe(99);
      const [checkpoint] =
        await db`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${initial.code}`;
      expect(checkpoint.snapshot.state.scores[users[0].id]).toBe(7);
    });

    it("rolls back empty-room checkpoint removal and retains departed result participants", async () => {
      const initial = await seed("chess");
      const finishEmpty = (lobby: Lobby) => {
        finish(lobby);
        lobby.players = [];
      };
      const spy = injectCheckpointFailure("DELETE");
      await expect(store.mutate(initial.code, finishEmpty)).rejects.toThrow(
        "Injected checkpoint persistence failure",
      );
      spy.mockRestore();
      expect(
        await db`SELECT 1 FROM multiplayer_matches WHERE id=${initial.matchId}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT 1 FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${initial.code}`,
      ).toHaveLength(1);
      await store.mutate(initial.code, finishEmpty);
      expect(
        await db`SELECT 1 FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${initial.code}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT 1 FROM multiplayer_matches WHERE id=${initial.matchId}`,
      ).toHaveLength(1);
      expect(
        await db`SELECT 1 FROM multiplayer_results WHERE match_id=${initial.matchId}`,
      ).toHaveLength(2);
    });

    it("records both server-scored participants when a voluntary departure ends the match", async () => {
      const initial = await seed("chess");
      await store.leave(users[1].id);
      const [checkpoint] =
        await db`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${initial.code}`;
      expect(checkpoint.snapshot.status).toBe("finished");
      expect(checkpoint.snapshot.players.map((player: { id: string }) => player.id)).toEqual([users[0].id]);
      const results =
        await db`SELECT user_id,won FROM multiplayer_results WHERE match_id=${initial.matchId}`;
      expect(results).toHaveLength(2);
      expect(results.every((result) => !result.won)).toBe(true);
      expect(await redis.get(`${namespace}:user-lobby:${users[1].id}`)).toBeNull();
    });
  },
);
