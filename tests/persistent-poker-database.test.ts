import { randomUUID } from "node:crypto";
import { createPokerState } from "../games/casino/multiplayer-poker";
import Redis from "ioredis";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import { LobbyStore } from "../apps/realtime/src/store";
import type { Lobby } from "../apps/realtime/src/engines";
import type { PokerState } from "../games/casino/multiplayer-poker";
import {
  casinoPokerHistory,
  syncCasinoPoker,
  cancelCasinoPokerForAccount,
  expireCasinoPokerHands,
} from "../packages/platform/src/casinoPoker";
import { handleAdmin } from "../packages/platform/src/admin";

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "persistent private poker table SQL checkpoints",
  () => {
    let redis: Redis,
      store: LobbyStore,
      namespace: string,
      code: string,
      tableId: string;
    let ids: string[] = [];
    const legacyHands: string[] = [];
    const balance = async (id: string) =>
      Number(
        (
          await db`SELECT balance FROM currency_accounts WHERE user_id=${id} AND currency='casino-credits'`
        )[0].balance,
      );
    const get = async () => (await store.get(code))!;
    const reserve = (
      id: string,
      amount: number,
      requestId = randomUUID(),
      sittingOut?: boolean,
    ) =>
      store.pokerSeat(id, {
        amount,
        requestId,
        ...(sittingOut === undefined ? {} : { sittingOut }),
      });
    const hand = (lobby: Lobby) => lobby.state as PokerState;
    async function start() {
      const lobby = await get();
      for (const p of lobby.players)
        if (
          lobby.pokerTable!.seats.some(
            (s) => s.userId === p.id && s.stack > 0 && !s.sittingOut,
          )
        )
          await store.ready(p.id, true);
      return store.start(lobby.hostId);
    }
    async function play(style: "fold" | "call" | "all-in" = "call") {
      for (let i = 0; i < 50; i++) {
        const lobby = await get(),
          s = hand(lobby);
        if (s.phase !== "betting") return lobby;
        const p = s.seats[s.turnIndex!];
        await store.action(p.userId, {
          type:
            style === "fold"
              ? "poker:fold"
              : style === "all-in"
                ? "poker:all-in"
                : p.streetBet < s.currentBet
                  ? "poker:call"
                  : "poker:check",
          revision: s.revision,
        });
      }
      throw new Error("Fixture hand failed to finish");
    }
    beforeEach(async () => {
      namespace = `persistent-poker-${randomUUID()}`;
      redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
      store = new LobbyStore(redis, namespace);
      for (let i = 0; i < 3; i++) {
        const id = randomUUID();
        ids.push(id);
        await db`INSERT INTO users(id,username,display_name) VALUES(${id},${`pt_${id.slice(0, 8)}`},'Persistent fixture')`;
        await db`INSERT INTO currency_accounts(user_id,currency,balance) VALUES(${id},'casino-credits',1000)`;
      }
      const lobby = await store.create(
        { id: ids[0], username: "host" },
        "poker",
        "private",
      );
      code = lobby.code;
      await store.join(code, { id: ids[1], username: "guest" });
      await store.join(code, { id: ids[2], username: "third" });
      const table = await store.pokerOptions(ids[0], 100, {
        persistent: true,
        minBuyIn: 100,
        maxBuyIn: 1000,
      });
      tableId = table.pokerTable!.id;
    });
    afterEach(async () => {
      await db`DELETE FROM multiplayer_checkpoints WHERE namespace=${namespace}`;
      await db`DELETE FROM multiplayer_matches WHERE lobby_code=${code}`;
      await db`DELETE FROM casino_poker_tables WHERE id=${tableId}`;
      for (const id of ids) await db`DELETE FROM users WHERE id=${id}`;
      for (const matchId of legacyHands.splice(0))
        await db`DELETE FROM casino_poker_hands WHERE match_id=${matchId}`;
      let cursor = "0";
      do {
        const result = await redis.scan(
          cursor,
          "MATCH",
          `${namespace}:*`,
          "COUNT",
          1000,
        );
        cursor = result[0];
        if (result[1].length) await redis.del(...result[1]);
      } while (cursor !== "0");
      await redis.quit();
      ids = [];
    });
    it("atomically reserves selected unequal stacks, rejects bounds, and replays one wallet operation once", async () => {
      const requestId = randomUUID();
      await reserve(ids[0], 200, requestId);
      await reserve(ids[0], 200, requestId);
      expect(await balance(ids[0])).toBe(800);
      expect((await get()).pokerTable!.seats[0].stack).toBe(200);
      expect(
        await db`SELECT 1 FROM currency_ledger WHERE reference_id=${requestId}`,
      ).toHaveLength(1);
      await expect(reserve(ids[0], 201, requestId)).rejects.toThrow("reused");
      await expect(reserve(ids[1], 99)).rejects.toThrow("bounds");
      await expect(reserve(ids[1], 1001)).rejects.toThrow("valid");
      await expect(store.ready(ids[1], true)).rejects.toThrow("funded");
      expect(await balance(ids[1])).toBe(1000);
      const [checkpoint] =
        await db`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${code}`;
      expect(checkpoint.snapshot.pokerTable.seats[0].stack).toBe(200);
      expect(JSON.stringify(checkpoint.snapshot)).not.toContain(
        "pendingOperation",
      );
    });
    it("plays three actual hands with retained unequal stacks, rotating dealer and no repeated wallet debit, then closes once", async () => {
      for (let i = 0; i < ids.length; i++) await reserve(ids[i], 100 * (i + 1));
      let previousDealer = "";
      for (const style of ["fold", "call", "all-in"] as const) {
        const before = (await get()).pokerTable!.seats;
        const lobby = await start(),
          s = hand(lobby);
        expect(s.table!.handNumber).toBe(
          ["fold", "call", "all-in"].indexOf(style) + 1,
        );
        expect(s.seats.map((p) => p.initialStack)).toEqual(
          lobby.players.map(
            (p) => before.find((seat) => seat.userId === p.id)!.stack,
          ),
        );
        const dealer = s.seats[s.dealerIndex].userId;
        if (previousDealer) expect(dealer).not.toBe(previousDealer);
        previousDealer = dealer;
        const complete = await play(style);
        expect(hand(complete).phase).toBe("settled");
        expect(
          complete.pokerTable!.seats.reduce((sum, p) => sum + p.stack, 0),
        ).toBe(600);
        expect(
          (await Promise.all(ids.map(balance))).reduce((sum, n) => sum + n, 0),
        ).toBe(2400);
      }
      expect(
        await db`SELECT 1 FROM casino_poker_table_hands WHERE table_id=${tableId} AND status='settled'`,
      ).toHaveLength(3);
      const [buys] =
        await db`SELECT count(*)::integer AS count FROM currency_ledger WHERE user_id=ANY(${ids}::uuid[]) AND reason='persistent poker buy-in'`;
      expect(buys.count).toBe(3);
      const fundedCount = (await get()).pokerTable!.seats.filter(
        (p) => p.stack > 0,
      ).length;
      await store.pokerClose(ids[0]);
      await store.pokerClose(ids[0]);
      expect((await get()).pokerTable!.closed).toBe(true);
      expect(
        (await Promise.all(ids.map(balance))).reduce((sum, n) => sum + n, 0),
      ).toBe(3000);
      const [ledger] =
        await db`SELECT coalesce(sum(amount),0)::integer AS sum FROM currency_ledger WHERE user_id=ANY(${ids}::uuid[])`;
      expect(ledger.sum).toBe(0);
      expect(
        await db`SELECT 1 FROM currency_ledger WHERE reference_id=${tableId} AND reason='persistent poker close'`,
      ).toHaveLength(fundedCount);
      await expect(start()).rejects.toThrow("closed");
    });
    it("rechecks bidirectional blocks before reserving a seat and leaves no operation or debit", async () => {
      await db`INSERT INTO user_blocks(user_id,blocked_id) VALUES(${ids[0]},${ids[1]})`;
      const requestId = randomUUID();
      await expect(reserve(ids[1], 100, requestId)).rejects.toThrow(
        "unavailable",
      );
      expect(await balance(ids[1])).toBe(1000);
      expect(
        await db`SELECT 1 FROM casino_poker_table_operations WHERE request_id=${requestId}`,
      ).toHaveLength(0);
      expect((await get()).pokerTable!.seats).toHaveLength(0);
    });
    it("rolls a rebuy and its operation journal back with a failed checkpoint transaction", async () => {
      await reserve(ids[0], 100);
      const lobby = await get(),
        requestId = randomUUID();
      lobby.pokerTable!.pendingOperation = {
        type: "seat",
        userId: ids[0],
        amount: 50,
        requestId,
      };
      await expect(
        db.begin(async (sql) => {
          await syncCasinoPoker(sql, lobby, namespace);
          await sql`UPDATE multiplayer_checkpoints SET snapshot=${sql.json(JSON.parse(JSON.stringify(lobby)))} WHERE namespace=${namespace} AND lobby_code=${code}`;
          throw new Error("fixture checkpoint failed");
        }),
      ).rejects.toThrow("checkpoint failed");
      expect(await balance(ids[0])).toBe(900);
      expect((await get()).pokerTable!.seats[0].stack).toBe(100);
      expect(
        await db`SELECT 1 FROM casino_poker_table_operations WHERE request_id=${requestId}`,
      ).toHaveLength(0);
      await reserve(ids[0], 50, requestId);
      expect(await balance(ids[0])).toBe(850);
      expect((await get()).pokerTable!.seats[0].stack).toBe(150);
    });
    it("lets a funded seat sit out, view hidden pockets, rejoin and leave between hands without disrupting others", async () => {
      for (const id of ids) await reserve(id, 200);
      await reserve(ids[2], 0, randomUUID(), true);
      const lobby = await start();
      expect(hand(lobby).seats).toHaveLength(2);
      const view = store.view(lobby, ids[2]).state as ReturnType<
        typeof import("../games/casino/multiplayer-poker").publicPokerTable
      >;
      expect(view.seats.every((p) => p.hole.every((card) => card === -1))).toBe(
        true,
      );
      expect(view.self.canAct).toBe(false);
      await play("fold");
      await reserve(ids[2], 0, randomUUID(), false);
      await store.leave(ids[2]);
      expect(await balance(ids[2])).toBe(1000);
      expect((await get()).pokerTable!.seats).toHaveLength(2);
      expect((await get()).players).toHaveLength(2);
    });
    it("retains a departing all-in's side-pot rights until showdown, then returns its final stack exactly once", async () => {
      for (const id of ids) await reserve(id, 200);
      const started = await start(),
        s = hand(started),
        leaver = s.seats[s.turnIndex!].userId;
      await store.action(leaver, {
        type: "poker:all-in",
        revision: s.revision,
      });
      await store.leave(leaver);
      expect(await balance(leaver)).toBe(800);
      const active = await get();
      expect(hand(active).seats.find((p) => p.userId === leaver)!.folded).toBe(
        false,
      );
      expect(
        active.pokerTable!.seats.find((p) => p.userId === leaver)!.pendingLeave,
      ).toBe(true);
      const settled = await play("all-in"),
        payout = hand(settled).payouts![leaver];
      expect(await balance(leaver)).toBe(800 + payout);
      expect(settled.pokerTable!.seats.some((p) => p.userId === leaver)).toBe(
        false,
      );
      await store.checkpointAll();
      expect(await balance(leaver)).toBe(800 + payout);
      const [total] =
        await db`SELECT (SELECT sum(balance) FROM currency_accounts WHERE user_id=ANY(${ids}::uuid[]) AND currency='casino-credits')+(SELECT sum(stack) FROM casino_poker_table_seats WHERE table_id=${tableId} AND status='active') AS chips`;
      expect(Number(total.chips)).toBe(3000);
    });
    it("restores private pockets and stacks from SQL after Redis loss, and rejects stale and duplicate actions", async () => {
      for (const id of ids) await reserve(id, 200);
      const started = await start(),
        first = hand(started),
        actor = first.seats[first.turnIndex!].userId;
      const cards = first.seats.find((p) => p.userId === actor)!.hole;
      const action = { type: "poker:call", revision: first.revision };
      await store.action(actor, action);
      await expect(store.action(actor, action)).rejects.toThrow();
      const current = await get();
      await redis.del(
        `${namespace}:lobby:${code}`,
        ...ids.map((id) => `${namespace}:user-lobby:${id}`),
      );
      const recovered = await store.current(actor);
      expect(recovered!.pokerTable!.id).toBe(tableId);
      expect(
        hand(recovered!).seats.find((p) => p.userId === actor)!.hole,
      ).toEqual(cards);
      expect(hand(recovered!).revision).toBe(hand(current).revision);
      expect(await balance(actor)).toBe(800);
      await play("fold");
      await start();
      await expect(store.action(actor, action)).rejects.toThrow();
    });
    it("blocks admin reset during retained escrow even between hands and allows it after closing", async () => {
      await db`UPDATE users SET role='owner' WHERE id=${ids[2]}`;
      const actor = (await getUser(ids[2]))!,
        target = (await getUser(ids[0]))!,
        operationId = randomUUID();
      await reserve(target.id, 100);
      const reset = () =>
        handleAdmin(
          ["admin", "users", target.id, "currency"],
          "POST",
          {
            user: actor,
            request: new Request("http://localhost:3000/api/admin"),
          },
          {
            operationId,
            currency: "casino-credits",
            mode: "reset",
            amount: 0,
            reason: "Persistent escrow fixture",
            confirmation: `RESET casino-credits ${target.username}`,
          },
        );
      await expect(reset()).rejects.toMatchObject({ status: 409 });
      expect(await balance(target.id)).toBe(900);
      expect(
        await db`SELECT 1 FROM admin_audit_log WHERE id=${operationId}`,
      ).toHaveLength(0);
      await store.pokerClose(ids[0]);
      await expect(reset()).resolves.toMatchObject({ ok: true, balance: 0 });
    });
    it("account deletion restores the current hand's starting stacks while preserving earlier committed hand results", async () => {
      for (const id of ids) await reserve(id, 200);
      await start();
      const first = await play("fold"),
        retained = new Map(
          first.pokerTable!.seats.map((p) => [p.userId, p.stack]),
        );
      await start();
      await db`DELETE FROM users WHERE id=${ids[0]}`;
      expect(await balance(ids[1])).toBe(800 + retained.get(ids[1])!);
      expect(await balance(ids[2])).toBe(800 + retained.get(ids[2])!);
      const [table] =
        await db`SELECT status FROM casino_poker_tables WHERE id=${tableId}`;
      expect(table.status).toBe("closed");
      expect(
        await db`SELECT 1 FROM casino_poker_table_hands WHERE table_id=${tableId} AND status='refunded'`,
      ).toHaveLength(1);
    });
    it("serializes simultaneous seat reservations and exclusive legacy versus persistent wallet escrow", async () => {
      const requestId = randomUUID();
      const reservations = await Promise.all([
        reserve(ids[0], 100, requestId),
        reserve(ids[0], 100, requestId),
      ]);
      expect(
        reservations.every((l) =>
          l.pokerTable!.seats.some(
            (p) => p.userId === ids[0] && p.stack === 100,
          ),
        ),
      ).toBe(true);
      expect(await balance(ids[0])).toBe(900);
      await expect(reserve(ids[0], 901)).rejects.toThrow("bounds");
      await store.leave(ids[0]);
      expect(await balance(ids[0])).toBe(1000);
      await store.join(code, { id: ids[0], username: "host" });
      const matchId = randomUUID();
      legacyHands.push(matchId);
      const legacy = {
        matchId,
        code: "LEGACYAB",
        visibility: "private",
        status: "playing",
        players: ids.slice(0, 2).map((id) => ({ id, username: "legacy" })),
        state: createPokerState(ids.slice(0, 2), 100),
      };
      const race = await Promise.allSettled([
        reserve(ids[0], 100),
        db.begin((sql) => syncCasinoPoker(sql, legacy, namespace)),
      ]);
      expect(
        race.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        race.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      expect(await balance(ids[0])).toBe(900);
      const [active] =
        await db`SELECT (SELECT count(*) FROM casino_poker_escrows WHERE user_id=${ids[0]} AND status='active')+(SELECT count(*) FROM casino_poker_table_seats WHERE user_id=${ids[0]} AND status='active') AS count`;
      expect(Number(active.count)).toBe(1);
    });
    it("serializes simultaneous room joins into at most six unique persistent seats", async () => {
      const joining: string[] = [];
      for (let i = 0; i < 4; i++) {
        const id = randomUUID();
        joining.push(id);
        ids.push(id);
        await db`INSERT INTO users(id,username,display_name) VALUES(${id},${`pj_${id.slice(0, 8)}`},'Joining fixture')`;
      }
      const result = await Promise.allSettled(
        joining.map((id, i) =>
          store.join(code, { id, username: `joiner${i}` }),
        ),
      );
      expect(
        result.filter((value) => value.status === "fulfilled"),
      ).toHaveLength(3);
      expect(
        result.filter((value) => value.status === "rejected"),
      ).toHaveLength(1);
      const lobby = await get();
      expect(lobby.players).toHaveLength(6);
      expect(new Set(lobby.players.map((p) => p.id)).size).toBe(6);
      const members =
        await db`SELECT user_id FROM multiplayer_checkpoint_members WHERE namespace=${namespace} AND lobby_code=${code}`;
      expect(members).toHaveLength(6);
      expect(lobby.pokerTable!.id).toBe(tableId);
    });
    it("times out a disconnected active seat through normal rules and returns the retained result once", async () => {
      await reserve(ids[0], 200);
      await reserve(ids[1], 200);
      await start();
      await store.disconnected(ids[0]);
      const now = Date.now() + 61000;
      await store.tick(now);
      const finished = await get();
      expect(hand(finished).phase).toBe("settled");
      expect(finished.players.some((p) => p.id === ids[0])).toBe(false);
      expect(finished.pokerTable!.seats.some((p) => p.userId === ids[0])).toBe(
        false,
      );
      expect(await balance(ids[0])).toBe(995);
      await store.tick(now + 1000);
      expect(await balance(ids[0])).toBe(995);
      const [sum] =
        await db`SELECT (SELECT sum(balance) FROM currency_accounts WHERE user_id=ANY(${ids}::uuid[]) AND currency='casino-credits')+(SELECT sum(stack) FROM casino_poker_table_seats WHERE table_id=${tableId} AND status='active') AS total`;
      expect(Number(sum.total)).toBe(3000);
    });
    it("exports only own cards and expires orphan table escrow once after its checkpoint window", async () => {
      for (const id of ids) await reserve(id, 200);
      await start();
      await play("fold");
      const history = await db.begin((sql) =>
        casinoPokerHistory(sql, ids[0], true),
      );
      expect(history.pokerTables[0].tableId).toBe(tableId);
      expect(history.pokerHands[0].yourCards).toHaveLength(2);
      expect(history.pokerHands[0].summary.revealed).toEqual([]);
      expect(history.pokerEscrowCredits).toBe(
        (await get()).pokerTable!.seats.find((p) => p.userId === ids[0])!.stack,
      );
      await db`UPDATE casino_poker_tables SET updated_at=now()-interval '25 hours' WHERE id=${tableId}`;
      expect(await expireCasinoPokerHands(10, ids[0])).toBe(0);
      await db`DELETE FROM multiplayer_checkpoints WHERE namespace=${namespace}`;
      const expired = await Promise.all([
        expireCasinoPokerHands(10, ids[0]),
        expireCasinoPokerHands(10, ids[0]),
      ]);
      expect(expired.reduce((sum, n) => sum + n, 0)).toBe(1);
      expect(
        (await Promise.all(ids.map(balance))).reduce((sum, n) => sum + n, 0),
      ).toBe(3000);
      await db.begin((sql) => cancelCasinoPokerForAccount(sql, ids[0]));
      expect(
        (await Promise.all(ids.map(balance))).reduce((sum, n) => sum + n, 0),
      ).toBe(3000);
    });
  },
);
