import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import { handleAdmin } from "../packages/platform/src/admin";
import {
  createPokerState,
  applyPokerAction,
} from "../games/casino/multiplayer-poker";
import {
  syncCasinoPoker,
  requireCasinoPokerEligibility,
  casinoPokerHistory,
  cancelCasinoPokerForAccount,
  expireCasinoPokerHands,
  type PokerEconomyLobby,
} from "../packages/platform/src/casinoPoker";
interface FinancialState {
  kind: "poker";
  phase: "betting" | "settled" | "cancelled";
  buyIn: number;
  seats: {
    userId: string;
    stack: number;
    committed: number;
    streetBet: number;
    folded: boolean;
    allIn: boolean;
    hole: number[];
  }[];
  pot: number;
  street: string;
  community: number[];
  revision: number;
  actionLog: { userId: string; action: string; amount: number; at: number }[];
  payouts?: Record<string, number>;
  result?: {
    winners: string[];
    scores: Record<string, number>;
    reason: string;
  };
}
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "private poker escrow and checkpoint settlement",
  () => {
    let ids: string[] = [];
    let namespace: string;
    let hands: string[] = [];
    const fresh = (): PokerEconomyLobby & { state: FinancialState } => {
      const matchId = randomUUID();
      hands.push(matchId);
      return {
        matchId,
        code: matchId.replaceAll("-", "").slice(0, 8).toUpperCase(),
        visibility: "private",
        status: "playing",
        players: ids.map((id, i) => ({ id, username: `poker${i}` })),
        startedAt: Date.now(),
        state: {
          kind: "poker",
          phase: "betting",
          buyIn: 100,
          seats: ids.map((userId, i) => ({
            userId,
            stack: 100,
            committed: 0,
            streetBet: 0,
            folded: false,
            allIn: false,
            hole: [i * 2, i * 2 + 1],
          })),
          pot: 0,
          street: "preflop",
          community: [],
          revision: 0,
          actionLog: [],
        },
      };
    };
    const save = async (lobby: PokerEconomyLobby, failAfter = false) =>
      db.begin(async (sql) => {
        const result = await syncCasinoPoker(sql, lobby, namespace);
        await sql`INSERT INTO multiplayer_checkpoints(namespace,lobby_code,match_id,snapshot,expires_at) VALUES(${namespace},${lobby.code},${lobby.matchId},${sql.json(JSON.parse(JSON.stringify(lobby)))},now()+interval '24 hours') ON CONFLICT(namespace,lobby_code) DO UPDATE SET snapshot=excluded.snapshot,match_id=excluded.match_id`;
        if (failAfter) throw new Error("fixture failed checkpoint transaction");
        return result;
      });
    const balance = async (id: string) =>
      Number(
        (
          await db`SELECT balance FROM currency_accounts WHERE user_id=${id} AND currency='casino-credits'`
        )[0].balance,
      );
    beforeEach(async () => {
      namespace = `poker-fixture-${randomUUID()}`;
      for (let i = 0; i < 3; i++) {
        const id = randomUUID();
        ids.push(id);
        await db`INSERT INTO users(id,username,display_name) VALUES(${id},${`poker_${id.slice(0, 8)}`},'Poker fixture')`;
        await db`INSERT INTO currency_accounts(user_id,currency,balance) VALUES(${id},'casino-credits',1000)`;
      }
    });
    afterEach(async () => {
      await db`DELETE FROM multiplayer_checkpoints WHERE namespace=${namespace}`;
      for (const id of ids) await db`DELETE FROM users WHERE id=${id}`;
      for (const matchId of hands)
        await db`DELETE FROM casino_poker_hands WHERE match_id=${matchId}`;
      ids = [];
      hands = [];
    });
    it("commits canonical private state and all buy-ins together, and rolls both back on snapshot failure", async () => {
      const lobby = fresh();
      await expect(save(lobby, true)).rejects.toThrow("failed checkpoint");
      expect(await balance(ids[0])).toBe(1000);
      expect(
        (
          await db`SELECT 1 FROM casino_poker_hands WHERE match_id=${lobby.matchId}`
        ).length,
      ).toBe(0);
      expect(
        (
          await db`SELECT 1 FROM currency_ledger WHERE reference_id=${lobby.matchId}`
        ).length,
      ).toBe(0);
      await save(lobby);
      for (const id of ids) expect(await balance(id)).toBe(900);
      expect(
        (
          await db`SELECT 1 FROM multiplayer_checkpoints WHERE namespace=${namespace} AND match_id=${lobby.matchId}`
        ).length,
      ).toBe(1);
      expect(
        (
          await db`SELECT 1 FROM casino_poker_escrows WHERE match_id=${lobby.matchId} AND status='active'`
        ).length,
      ).toBe(3);
    });
    it("blocks an administrator reset during escrow without an audit or wallet change, then allows it after settlement", async () => {
      await db`UPDATE users SET role='owner' WHERE id=${ids[2]}`;
      const actor = (await getUser(ids[2]))!;
      const target = (await getUser(ids[0]))!;
      const lobby = fresh();
      await save(lobby);
      const operationId = randomUUID();
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
            reason: "Poker escrow reset regression",
            confirmation: `RESET casino-credits ${target.username}`,
          },
        );
      const ledgerBefore =
        await db`SELECT id FROM currency_ledger WHERE user_id=${target.id}`;
      await expect(reset()).rejects.toMatchObject({ status: 409 });
      expect(await balance(target.id)).toBe(900);
      expect(
        await db`SELECT id FROM currency_ledger WHERE user_id=${target.id}`,
      ).toEqual(ledgerBefore);
      expect(
        await db`SELECT id FROM admin_audit_log WHERE id=${operationId}`,
      ).toHaveLength(0);
      lobby.status = "finished";
      lobby.state.phase = "settled";
      lobby.state.revision++;
      lobby.state.seats.forEach((seat, i) => {
        seat.stack = i === 0 ? 300 : 0;
      });
      lobby.state.payouts = Object.fromEntries(
        lobby.state.seats.map((seat) => [seat.userId, seat.stack]),
      );
      await save(lobby);
      expect(await balance(target.id)).toBe(1200);
      await expect(reset()).resolves.toMatchObject({ ok: true, balance: 0 });
      expect(await balance(target.id)).toBe(0);
      expect(
        await db`SELECT id FROM admin_audit_log WHERE id=${operationId}`,
      ).toHaveLength(1);
    });
    it("settles racing repeated final checkpoints once with conserved balances and ledger", async () => {
      const lobby = fresh();
      await save(lobby);
      lobby.status = "finished";
      lobby.state.phase = "settled";
      lobby.state.revision = 1;
      lobby.state.seats.forEach((player, i) => {
        player.stack = i === 0 ? 300 : 0;
        player.committed = 100;
      });
      lobby.state.payouts = Object.fromEntries(
        lobby.state.seats.map((player) => [player.userId, player.stack]),
      );
      await Promise.all([save(lobby), save(lobby)]);
      expect(await balance(ids[0])).toBe(1200);
      expect(await balance(ids[1])).toBe(900);
      expect(await balance(ids[2])).toBe(900);
      const ledger =
        await db`SELECT amount FROM currency_ledger WHERE reference_id=${lobby.matchId}`;
      expect(ledger.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(0);
      expect(ledger.filter((row) => Number(row.amount) > 0)).toHaveLength(1);
      expect(
        (
          await db`SELECT 1 FROM casino_poker_chip_journal WHERE match_id=${lobby.matchId}`
        ).length,
      ).toBe(2);
    });
    it("recovers identical settled JSONB state and upgrades legacy record-order digests without another payout", async () => {
      // Equal-length UUID keys sort ascending in JSONB; seat order is deliberately descending.
      ids.sort((a, b) => b.localeCompare(a));
      const lobby = fresh();
      await save(lobby);
      lobby.status = "finished";
      lobby.state.phase = "settled";
      lobby.state.revision = 1;
      lobby.state.seats.forEach((seat, i) => {
        seat.stack = i === 0 ? 300 : 0;
        seat.committed = 100;
      });
      lobby.state.payouts = Object.fromEntries(
        lobby.state.seats.map((seat) => [seat.userId, seat.stack]),
      );
      lobby.state.result = {
        winners: [ids[0]],
        scores: { ...lobby.state.payouts },
        reason: "Fixture showdown",
      };
      await save(lobby);
      const [stored] =
        await db`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND match_id=${lobby.matchId}`;
      const recovered = stored.snapshot as typeof lobby;
      expect(Object.keys(recovered.state.payouts!)).not.toEqual(
        Object.keys(lobby.state.payouts),
      );
      await expect(save(recovered)).resolves.toEqual({ status: "settled" });
      const legacyDigest = createHash("sha256")
        .update(JSON.stringify(lobby.state))
        .digest("hex");
      await db`UPDATE casino_poker_hands SET state_digest=${legacyDigest} WHERE match_id=${lobby.matchId}`;
      await expect(save(recovered)).resolves.toEqual({ status: "settled" });
      const [hand] =
        await db`SELECT state_digest FROM casino_poker_hands WHERE match_id=${lobby.matchId}`;
      expect(hand.state_digest).not.toBe(legacyDigest);
      await expect(save(recovered)).resolves.toEqual({ status: "settled" });
      expect(await balance(ids[0])).toBe(1200);
      expect(await balance(ids[1])).toBe(900);
      expect(
        await db`SELECT 1 FROM casino_poker_chip_journal WHERE match_id=${lobby.matchId}`,
      ).toHaveLength(2);
      expect(
        await db`SELECT 1 FROM currency_ledger WHERE reference_id=${lobby.matchId}`,
      ).toHaveLength(4);
      const changed = structuredClone(recovered);
      changed.state.result!.scores[ids[0]]++;
      await expect(save(changed)).rejects.toThrow("revision");
      const reordered = structuredClone(recovered);
      reordered.state.seats.reverse();
      await expect(save(reordered)).rejects.toThrow("revision");
    });
    it("rejects forged chip totals, stale revisions and changed identities without money mutation", async () => {
      const lobby = fresh();
      await save(lobby);
      const before = await balance(ids[0]);
      const forged = structuredClone(lobby);
      forged.state.revision = 1;
      forged.state.seats[0].stack = 1000;
      await expect(save(forged)).rejects.toThrow("conservation");
      expect(await balance(ids[0])).toBe(before);
      const reused = structuredClone(lobby);
      reused.state.seats[0].folded = true;
      await expect(save(reused)).rejects.toThrow("revision");
      const switched = structuredClone(lobby);
      switched.code = "OTHERABC";
      await expect(save(switched)).rejects.toThrow("identity");
    });
    it("journals an actual server-engine hand through every street and pays its computed showdown", async () => {
      const lobby = fresh();
      const engine = createPokerState(ids, 100, 0, Date.now());
      lobby.state = engine;
      await save(lobby);
      for (
        let action = 0;
        action < 40 && engine.phase === "betting";
        action++
      ) {
        const player = engine.seats[engine.turnIndex!];
        applyPokerAction(engine, player.userId, {
          type:
            player.streetBet < engine.currentBet ? "poker:call" : "poker:check",
        });
        if (lobby.state.phase === "settled") lobby.status = "finished";
        await save(lobby);
      }
      expect(engine.phase).toBe("settled");
      expect(engine.community).toHaveLength(5);
      expect(
        (await Promise.all(ids.map(balance))).reduce(
          (sum, amount) => sum + amount,
          0,
        ),
      ).toBe(3000);
      const journal =
        await db`SELECT revision FROM casino_poker_chip_journal WHERE match_id=${lobby.matchId}`;
      expect(journal.length).toBeGreaterThan(10);
      const history = await db.begin((sql) => casinoPokerHistory(sql, ids[0]));
      expect(history.pokerHands[0].summary.revealed).toHaveLength(3);
      expect(history.pokerHands[0].summary.actions.length).toBeGreaterThan(10);
    });
    it("an unaffordable participant rolls back every other player's buy-in", async () => {
      await db`UPDATE currency_accounts SET balance=50 WHERE user_id=${ids[2]} AND currency='casino-credits'`;
      const lobby = fresh();
      await expect(save(lobby)).rejects.toThrow("Not enough");
      expect(await balance(ids[0])).toBe(1000);
      expect(await balance(ids[1])).toBe(1000);
      expect(
        (
          await db`SELECT 1 FROM currency_ledger WHERE reference_id=${lobby.matchId}`
        ).length,
      ).toBe(0);
    });
    it("enforces private tables, current blocks and only one active financial hand per player", async () => {
      const publicLobby = fresh();
      publicLobby.visibility = "public";
      await expect(save(publicLobby)).rejects.toThrow("private");
      await db`INSERT INTO user_blocks(user_id,blocked_id) VALUES(${ids[0]},${ids[1]})`;
      await expect(
        requireCasinoPokerEligibility(ids[1], [ids[0]]),
      ).rejects.toThrow("unavailable");
      await expect(save(fresh())).rejects.toThrow("unavailable");
      await db`DELETE FROM user_blocks WHERE user_id=${ids[0]}`;
      await save(fresh());
      await expect(save(fresh())).rejects.toThrow("another poker hand");
    });
    it("returns original stakes on server cancellation without awarding an arbitrary winner", async () => {
      const lobby = fresh();
      await save(lobby);
      lobby.status = "finished";
      lobby.state.phase = "cancelled";
      lobby.state.revision = 1;
      await save(lobby);
      for (const id of ids) expect(await balance(id)).toBe(1000);
      const [hand] =
        await db`SELECT status FROM casino_poker_hands WHERE match_id=${lobby.matchId}`;
      expect(hand.status).toBe("refunded");
      await save(lobby);
      for (const id of ids) expect(await balance(id)).toBe(1000);
    });
    it("participant history contains only their pocket cards and never reveals a fold winner's cards", async () => {
      const lobby = fresh();
      await save(lobby);
      const own = await db.begin((sql) => casinoPokerHistory(sql, ids[0]));
      expect(own.pokerHands[0].yourCards).toEqual([0, 1]);
      expect(own.pokerHands[0].summary.revealed).toEqual([]);
      expect(JSON.stringify(own)).not.toContain('"deck"');
      lobby.status = "finished";
      lobby.state.phase = "settled";
      lobby.state.revision = 1;
      lobby.state.seats.forEach((player, i) => (player.folded = i !== 0));
      lobby.state.payouts = Object.fromEntries(
        lobby.state.seats.map((player) => [player.userId, player.stack]),
      );
      await save(lobby);
      const history = await db.begin((sql) => casinoPokerHistory(sql, ids[1]));
      expect(history.pokerHands[0].yourCards).toEqual([2, 3]);
      expect(history.pokerHands[0].summary.revealed).toEqual([]);
    });
    it("account erasure and its defensive SQL trigger refund the remaining participants", async () => {
      const lobby = fresh();
      await save(lobby);
      await db`DELETE FROM users WHERE id=${ids[0]}`;
      expect(await balance(ids[1])).toBe(1000);
      expect(await balance(ids[2])).toBe(1000);
      const [hand] =
        await db`SELECT status FROM casino_poker_hands WHERE match_id=${lobby.matchId}`;
      expect(hand.status).toBe("refunded");
      // A stale live server cannot settle refunded funds again.
      const stale = await db.begin((sql) =>
        syncCasinoPoker(sql, lobby, namespace),
      );
      expect(stale?.status).toBe("refunded");
      expect(await balance(ids[1])).toBe(1000);
    });
    it("explicit account cleanup aborts once, and aged orphan escrow expires in isolated maintenance", async () => {
      const lobby = fresh();
      await save(lobby);
      await db.begin((sql) => cancelCasinoPokerForAccount(sql, ids[0]));
      for (const id of ids) expect(await balance(id)).toBe(1000);
      const orphan = fresh();
      await save(orphan);
      await db`UPDATE casino_poker_hands SET updated_at=now()-interval '25 hours' WHERE match_id=${orphan.matchId}`;
      expect(await expireCasinoPokerHands(20, ids[0])).toBe(0);
      await db`DELETE FROM multiplayer_checkpoints WHERE namespace=${namespace} AND match_id=${orphan.matchId}`;
      const counts = await Promise.all([
        expireCasinoPokerHands(20, ids[0]),
        expireCasinoPokerHands(20, ids[0]),
      ]);
      expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
      for (const id of ids) expect(await balance(id)).toBe(1000);
    });
  },
);
