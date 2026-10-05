import { randomBytes, randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { db } from "@tell-aviv/database";
import type { TransactionSql } from "postgres";
import type { WorkerFence } from "./workerFence";
type Sql = TransactionSql;
import {
  syncCasinoPoker,
  requireCasinoPokerEligibility,
} from "../../../packages/platform/src/casinoPoker";
import {
  foldDepartedPokerSeat,
  cancelPokerState,
} from "../../../games/casino/multiplayer-poker";
import {
  applyGameAction,
  createLobby,
  GameError,
  lobbyView,
  playerLimits,
  startGame,
  tickGame,
  resumeRecoveredLobby,
  type Lobby,
  type MultiplayerGameId,
  type Player,
} from "./engines";
import { eventChannel } from "./events";
import { settleEgoCoopProgress } from "../../../packages/platform/src/egoCoop";
import { departCoop } from "../../../games/ego-trip/coop-engine";
import {
  catalogGameId,
  disabledMultiplayerGames,
  requireMultiplayerAvailable,
} from "./availability";

export const lobbyKey = (code: string) => `tell-aviv:lobby:${code}`;
export const membershipKey = (userId: string) =>
  `tell-aviv:user-lobby:${userId}`;
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateCode() {
  return Array.from(
    randomBytes(6),
    (b) => codeAlphabet[b % codeAlphabet.length],
  ).join("");
}
function publicIdentity(player: Player): Player {
  return {
    id: player.id,
    username: player.username,
    ready: player.ready,
    connected: player.connected,
    ...(player.disconnectedAt === undefined
      ? {}
      : { disconnectedAt: player.disconnectedAt }),
  };
}
const immediateCheckpoint = (gameId: string) =>
  ["poker", "connect-four", "checkers", "chess"].includes(gameId);
export class LobbyStore {
  private lastSnapshot = new Map<string, { at: number; marker: string }>();
  workerFence?: WorkerFence;
  async guardTransaction(sql: TransactionSql) {
    await this.workerFence?.guardTransaction(sql);
  }
  private async cacheWrite(commands: (string | number)[][]) {
    if (this.workerFence) return this.workerFence.write(commands);
    const pipe = this.redis.pipeline();
    for (const [command, ...args] of commands)
      pipe.call(String(command), ...args);
    const results = await pipe.exec();
    if (results?.some(([error]) => error))
      throw results.find(([error]) => error)![0];
    return results?.map(([, value]) => value) ?? [];
  }
  private async publishCache(lobby: Lobby, onlyIfMissing = false) {
    const [saved] = await this.cacheWrite([
      [
        "set",
        this.lobbyKey(lobby.code),
        JSON.stringify(lobby),
        "EX",
        3600,
        ...(onlyIfMissing ? ["NX"] : []),
      ],
    ]);
    if (!saved) return false;
    await this.cacheWrite([
      ["zadd", this.activeKey, Date.now(), lobby.code],
      ...lobby.players.map((p) => [
        "set",
        this.membershipKey(p.id),
        lobby.code,
        "EX",
        3600,
      ]),
    ]);
    return true;
  }
  constructor(
    public redis: Redis,
    public namespace = process.env.REALTIME_NAMESPACE ?? "tell-aviv",
  ) {
    if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(namespace))
      throw new Error("Invalid realtime namespace");
  }
  private lobbyKey(code: string) {
    return `${this.namespace}:lobby:${code}`;
  }
  private membershipKey(userId: string) {
    return `${this.namespace}:user-lobby:${userId}`;
  }
  private get activeKey() {
    return `${this.namespace}:lobbies`;
  }
  private async saveSnapshot(lobby: Lobby, force = false) {
    lobby.players = lobby.players.map(publicIdentity);
    if (!lobby.players.length) {
      await db.begin(async (sql) => {
        await this.guardTransaction(sql);
        if (lobby.state?.kind === "poker" || lobby.pokerTable) {
          const financial = await syncCasinoPoker(sql, lobby, this.namespace);
          if (
            financial?.status === "refunded" &&
            lobby.state?.kind === "poker" &&
            lobby.state.phase === "betting"
          ) {
            cancelPokerState(
              lobby.state as import("../../../games/casino/multiplayer-poker").PokerState,
              "This hand was refunded",
            );
            lobby.status = "finished";
          }
        }
        await this.record(lobby, sql);
        await sql`DELETE FROM multiplayer_checkpoints WHERE namespace=${this.namespace} AND lobby_code=${lobby.code}`;
      });
      this.lastSnapshot.delete(lobby.code);
      return;
    }
    const marker = `${lobby.matchId}:${lobby.status}:${lobby.state?.kind === "ego-trip" ? `${lobby.state.stage}:${lobby.state.campaign?.room.index ?? lobby.state.bossIndex}` : lobby.state?.kind === "tower-defense" ? `${lobby.state.defense.phase}:${lobby.state.commandRevision}` : ""}:${lobby.players.map((p) => `${p.id}:${p.connected}`).join(",")}`;
    const last = this.lastSnapshot.get(lobby.code),
      now = Date.now();
    if (
      !force &&
      lobby.gameId !== "poker" &&
      last?.marker === marker &&
      now - last.at < 1000
    )
      return;
    // Deleted accounts cannot be resurrected by an old live Redis lobby.
    const users =
      await db`SELECT id FROM users WHERE id=ANY(${lobby.players.map((p) => p.id)}::uuid[])`;
    if (users.length !== lobby.players.length)
      throw new GameError("A lobby account no longer exists");
    await db.begin(async (sql) => {
      await this.guardTransaction(sql);
      if (lobby.state?.kind === "poker" || lobby.pokerTable) {
        const financial = await syncCasinoPoker(sql, lobby, this.namespace);
        if (
          financial?.status === "refunded" &&
          lobby.state?.kind === "poker" &&
          lobby.state.phase === "betting"
        ) {
          cancelPokerState(lobby.state, "This hand was refunded");
          lobby.status = "finished";
        }
      }
      // The completed outcome and the state which produced it must commit
      // together, including periodic games and terminal board turns.
      await this.record(lobby, sql);
      if (lobby.state?.kind === "tower-defense")
        lobby.state.checkpointSerial = (lobby.state.checkpointSerial ?? 0) + 1;
      await sql`INSERT INTO multiplayer_checkpoints(namespace,lobby_code,match_id,snapshot,expires_at) VALUES(${this.namespace},${lobby.code},${lobby.matchId},${sql.json(JSON.parse(JSON.stringify(lobby)))},${new Date(now + 24 * 60 * 60 * 1000).toISOString()}) ON CONFLICT(namespace,lobby_code) DO UPDATE SET match_id=excluded.match_id,snapshot=excluded.snapshot,updated_at=now(),expires_at=excluded.expires_at`;
      await sql`DELETE FROM multiplayer_checkpoint_members WHERE namespace=${this.namespace} AND lobby_code=${lobby.code} AND NOT(user_id=ANY(${lobby.players.map((p) => p.id)}::uuid[]))`;
      for (const p of lobby.players)
        await sql`INSERT INTO multiplayer_checkpoint_members(namespace,lobby_code,user_id) VALUES(${this.namespace},${lobby.code},${p.id}) ON CONFLICT DO NOTHING`;
    });
    this.lastSnapshot.set(lobby.code, { at: now, marker });
  }
  private async removeSnapshot(code: string) {
    await db.begin(async (sql) => {
      await this.guardTransaction(sql);
      await sql`DELETE FROM multiplayer_checkpoints WHERE namespace=${this.namespace} AND lobby_code=${code}`;
    });
    this.lastSnapshot.delete(code);
  }
  async initializeRecovery() {
    // Expired snapshots are removed within this environment only.
    await db.begin(async (sql) => {
      await this.guardTransaction(sql);
      await sql`DELETE FROM multiplayer_checkpoints WHERE namespace=${this.namespace} AND expires_at<=now()`;
    });
    const rows =
      await db`SELECT lobby_code,updated_at FROM multiplayer_checkpoints WHERE namespace=${this.namespace} AND expires_at>now()`;
    for (const row of rows) {
      // The server holds an exclusive namespace lease before this step.
      const lobby = await this.get(row.lobby_code);
      if (!lobby) continue;
      if (lobby.status === "playing")
        lobby.recoveryPausedAt ??= new Date(row.updated_at).getTime();
      for (const p of lobby.players) {
        p.connected = false;
        p.disconnectedAt = Date.now();
      }
      // Turn games read SQL as canonical. Persist the recovered pause before
      // accepting clients, otherwise a subsequent read could resume old clocks.
      await this.saveSnapshot(lobby, true);
      await this.publishCache(lobby);
    }
  }
  async checkpointAll() {
    for (const code of await this.redis.zrange(this.activeKey, 0, -1)) {
      const lobby = await this.get(code);
      if (lobby) await this.saveSnapshot(lobby, true);
    }
  }
  private async withUserLock<T>(userId: string, action: () => Promise<T>) {
    const key = `${this.namespace}:lock:user-lobby:${userId}`,
      token = randomUUID();
    let acquired = false;
    for (let attempt = 0; attempt < 20 && !acquired; attempt++) {
      acquired = !!(await this.redis.set(key, token, "PX", 5000, "NX"));
      if (!acquired) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!acquired) throw new GameError("Another lobby request is pending");
    try {
      return await action();
    } finally {
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        key,
        token,
      );
    }
  }
  async get(code: string): Promise<Lobby | null> {
    const raw = await this.redis.get(this.lobbyKey(code));
    if (raw) {
      let lobby = JSON.parse(raw) as Lobby;
      // SQL commits lifecycle transitions before Redis. Periodic simulations
      // may have newer unsaved movement, but cannot undo a committed finish or
      // restart a different match. Never update Redis from this unlocked read.
      const [row] =
        await db`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${this.namespace} AND lobby_code=${code} AND expires_at>now() AND snapshot_version=1`;
      if (row) {
        const checkpoint = row.snapshot as Lobby;
        if (
          immediateCheckpoint(lobby.gameId) ||
          checkpoint.matchId !== lobby.matchId ||
          checkpoint.status !== lobby.status ||
          (checkpoint.recorded && !lobby.recorded) ||
          (checkpoint.state?.kind === "tower-defense" &&
            lobby.state?.kind === "tower-defense" &&
            ((checkpoint.state.checkpointSerial ?? 0) >
              (lobby.state.checkpointSerial ?? 0) ||
              checkpoint.state.commandRevision > lobby.state.commandRevision ||
              (checkpoint.state.commandRevision ===
                lobby.state.commandRevision &&
                ((checkpoint.state.simulation?.tick ?? 0) >
                  (lobby.state.simulation?.tick ?? 0) ||
                  Boolean(
                    checkpoint.recoveryPausedAt && !lobby.recoveryPausedAt,
                  )))))
        )
          lobby = checkpoint;
      }
      lobby.players = lobby.players.map(publicIdentity);
      return lobby;
    }
    const [row] =
      await db`SELECT snapshot,updated_at FROM multiplayer_checkpoints WHERE namespace=${this.namespace} AND lobby_code=${code} AND expires_at>now() AND snapshot_version=1`;
    if (!row) return null;
    const lobby = row.snapshot as Lobby;
    lobby.players = lobby.players.map(publicIdentity);
    if (lobby.code !== code || !lobby.players.length) return null;
    const existing =
      await db`SELECT id FROM users WHERE id=ANY(${lobby.players.map((p) => p.id)}::uuid[])`;
    if (existing.length !== lobby.players.length) {
      await this.removeSnapshot(code);
      return null;
    }
    const now = Date.now();
    if (!immediateCheckpoint(lobby.gameId)) {
      lobby.recoveryPausedAt = new Date(row.updated_at).getTime();
      for (const p of lobby.players) {
        p.connected = false;
        p.disconnectedAt = now;
      }
    }
    if (lobby.state?.kind === "ego-trip")
      for (const p of Object.values(lobby.state.players)) {
        p.input = null;
        p.inputAt = 0;
      }
    if (await this.publishCache(lobby, true)) {
      return lobby;
    }
    // Another reader may have hydrated the cache. Turn games retain the SQL
    // snapshot read above; their next locked mutation will read SQL again.
    const raced = await this.redis.get(this.lobbyKey(code));
    const restored =
      immediateCheckpoint(lobby.gameId) || !raced
        ? lobby
        : (JSON.parse(raced) as Lobby);
    restored.players = restored.players.map(publicIdentity);
    return restored;
  }
  async current(userId: string) {
    let code = await this.redis.get(this.membershipKey(userId));
    if (!code) {
      const [row] =
        await db`SELECT m.lobby_code FROM multiplayer_checkpoint_members m JOIN multiplayer_checkpoints c USING(namespace,lobby_code) WHERE m.namespace=${this.namespace} AND m.user_id=${userId} AND c.expires_at>now() ORDER BY c.updated_at DESC LIMIT 1`;
      code = row?.lobby_code;
    }
    if (!code) return null;
    const lobby = await this.get(code);
    if (lobby && !lobby.players.some((p) => p.id === userId)) {
      await this.redis.eval(
        "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        this.membershipKey(userId),
        code,
      );
      return null;
    }
    return lobby;
  }
  async mutate(code: string, fn: (lobby: Lobby) => Promise<void> | void) {
    await this.workerFence?.assertLease();
    const lockKey = `${this.namespace}:lock:lobby:${code}`,
      token = randomUUID();
    let locked = false;
    for (let attempt = 0; attempt < 20 && !locked; attempt++) {
      locked = !!(await this.redis.set(lockKey, token, "PX", 5000, "NX"));
      if (!locked) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!locked) throw new GameError("Lobby is busy; retry shortly");
    try {
      const lobby = await this.get(code);
      if (!lobby) throw new GameError("Lobby expired or does not exist");
      const valid =
        await db`SELECT id FROM users WHERE id=ANY(${lobby.players.map((p) => p.id)}::uuid[]) AND disabled=false`;
      const validIds = new Set(valid.map((p) => p.id as string));
      const invalid = lobby.players.filter((p) => !validIds.has(p.id));
      if (invalid.length) {
        if (
          lobby.state &&
          !(lobby.state.kind === "poker" && lobby.state.phase !== "betting")
        ) {
          lobby.state.result = {
            winners: [],
            scores: Object.fromEntries(
              lobby.players
                .filter((p) => validIds.has(p.id))
                .map((p) => [p.id, 0]),
            ),
            reason: "A player account became unavailable",
          };
          if (lobby.state.kind === "poker")
            cancelPokerState(
              lobby.state,
              "A player account became unavailable",
            );
          if (lobby.state.kind === "ego-trip") {
            for (const p of invalid) delete lobby.state.players[p.id];
            lobby.state.shots = lobby.state.shots.filter(
              (shot) => !shot.ownerId || validIds.has(shot.ownerId),
            );
            lobby.state.stage = "lost";
          }
        }
        if (lobby.pokerTable && !lobby.pokerTable.closed)
          lobby.pokerTable.pendingOperation = {
            type: "close",
            userId: lobby.hostId,
            requestId: randomUUID(),
          };
        lobby.status = "finished";
        lobby.players = lobby.players.filter((p) => validIds.has(p.id));
        if (!validIds.has(lobby.hostId) && lobby.players.length)
          lobby.hostId = lobby.players[0].id;
        for (const p of invalid)
          await this.cacheWrite([["del", this.membershipKey(p.id)]]);
      } else await fn(lobby);
      await this.saveSnapshot(lobby, immediateCheckpoint(lobby.gameId));
      await this.publishCache(lobby);
      await this.cacheWrite([
        [
          "publish",
          eventChannel,
          JSON.stringify({
            type: "lobby:changed",
            payload: { code, namespace: this.namespace },
          }),
        ],
      ]);
      return lobby;
    } finally {
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        token,
      );
    }
  }
  async create(
    user: { id: string; username: string },
    gameId: MultiplayerGameId,
    visibility: "public" | "private",
    coopMode: "gauntlet" | "campaign" = "gauntlet",
    queueTicketIds?: string[],
  ) {
    return this.withUserLock(user.id, () =>
      this.createUnlocked(user, gameId, visibility, coopMode, queueTicketIds),
    );
  }
  private async createUnlocked(
    user: { id: string; username: string },
    gameId: MultiplayerGameId,
    visibility: "public" | "private",
    coopMode: "gauntlet" | "campaign" = "gauntlet",
    queueTicketIds?: string[],
  ) {
    await this.workerFence?.assertLease();
    await requireMultiplayerAvailable(gameId);
    if (gameId === "poker") await requireCasinoPokerEligibility(user.id, []);
    if (await this.current(user.id))
      throw new GameError("Leave your current lobby first");
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode(),
        lobby = createLobby(
          user,
          gameId,
          visibility,
          code,
          Date.now(),
          coopMode,
        );
      if (queueTicketIds) lobby.queueTicketIds = [...queueTicketIds];
      const [allocated] = await this.cacheWrite([
        ["set", this.lobbyKey(code), JSON.stringify(lobby), "EX", 3600, "NX"],
      ]);
      if (allocated) {
        await this.saveSnapshot(lobby, true);
        await this.publishCache(lobby);
        return lobby;
      }
    }
    throw new GameError("Cannot allocate room; try again");
  }
  async join(code: string, user: { id: string; username: string }) {
    return this.withUserLock(user.id, () => this.joinUnlocked(code, user));
  }
  private async joinUnlocked(
    code: string,
    user: { id: string; username: string },
  ) {
    const current = await this.current(user.id);
    if (current && current.code !== code)
      throw new GameError("Leave your current lobby first");
    return this.mutate(code, async (lobby) => {
      const existing = lobby.players.find((p) => p.id === user.id);
      if (existing) {
        resumeRecoveredLobby(lobby);
        existing.connected = true;
        delete existing.disconnectedAt;
        return;
      }
      await requireMultiplayerAvailable(lobby.gameId);
      if (lobby.gameId === "poker")
        await requireCasinoPokerEligibility(
          user.id,
          lobby.players.map((p) => p.id),
        );
      if (lobby.status === "playing")
        throw new GameError("A match is running; only reconnects can join");
      if (lobby.players.length >= playerLimits(lobby.gameId).max)
        throw new GameError("Lobby is full");
      const blocked =
        await db`SELECT 1 FROM user_blocks WHERE (user_id=${user.id} AND blocked_id=ANY(${lobby.players.map((p) => p.id)}::uuid[])) OR (blocked_id=${user.id} AND user_id=ANY(${lobby.players.map((p) => p.id)}::uuid[])) LIMIT 1`;
      if (blocked.length) throw new GameError("Lobby is unavailable");
      lobby.players.push({
        id: user.id,
        username: user.username,
        ready: false,
        connected: true,
      });
    });
  }
  async leave(userId: string) {
    return this.withUserLock(userId, () => this.leaveUnlocked(userId));
  }
  private async leaveUnlocked(userId: string) {
    const lobby = await this.current(userId);
    if (!lobby) return;
    await this.mutate(lobby.code, async (l) => {
      if (l.pokerTable && !l.pokerTable.closed)
        l.pokerTable.pendingOperation = {
          type: "leave",
          userId,
          requestId: randomUUID(),
        };
      if (l.status === "playing" && l.state?.kind === "poker") {
        foldDepartedPokerSeat(l.state, userId);
        if (l.state.result) l.status = "finished";
      } else if (
        l.status === "playing" &&
        l.state?.kind === "ego-trip" &&
        l.state.campaign
      ) {
        departCoop(l.state, userId);
      } else if (l.status === "playing") {
        // A voluntary departure counts as a forfeit, with no new competitive reward.
        l.status = "finished";
        if (l.state)
          l.state.result = {
            winners: [],
            scores: Object.fromEntries(l.players.map((p) => [p.id, 0])),
            reason: "A player left the match",
          };
      }
      l.players = l.players.filter((p) => p.id !== userId);
      if (l.hostId === userId && l.players.length) l.hostId = l.players[0].id;
    });
    await this.cacheWrite([["del", this.membershipKey(userId)]]);
    if (!lobby.players.length || lobby.players.length === 1) {
      const updated = await this.get(lobby.code);
      if (!updated?.players.length) {
        await this.cacheWrite([
          ["del", this.lobbyKey(lobby.code)],
          ["zrem", this.activeKey, lobby.code],
        ]);
        await this.removeSnapshot(lobby.code);
      }
    }
  }
  async ready(userId: string, ready: boolean) {
    const l = await this.required(userId);
    return this.mutate(l.code, (lobby) => {
      if (lobby.status === "playing")
        throw new GameError("Match already running");
      if (
        ready &&
        lobby.pokerTable &&
        !lobby.pokerTable.seats.some(
          (p) =>
            p.userId === userId &&
            p.stack > 0 &&
            !p.sittingOut &&
            !p.pendingLeave,
        )
      )
        throw new GameError(
          "Reserve an active funded poker seat before readying",
        );
      lobby.players.find((p) => p.id === userId)!.ready = ready;
    });
  }
  async pokerOptions(
    userId: string,
    buyIn: number,
    options?: { persistent?: boolean; minBuyIn?: number; maxBuyIn?: number },
  ) {
    const l = await this.required(userId);
    if (l.gameId !== "poker") throw new GameError("Open a poker table first");
    if (!Number.isInteger(buyIn) || buyIn < 100 || buyIn > 10000)
      throw new GameError("Poker buy-in must be100–10000Credits");
    return this.mutate(l.code, (lobby) => {
      if (lobby.hostId !== userId)
        throw new GameError("Only the host can set the buy-in");
      if (lobby.status === "playing")
        throw new GameError("Finish this hand before changing the buy-in");
      if (lobby.pokerTable && !lobby.pokerTable.closed)
        throw new GameError(
          "Close the persistent table before changing its bounds",
        );
      if (options?.persistent) {
        const minBuyIn = options.minBuyIn ?? buyIn,
          maxBuyIn = options.maxBuyIn ?? buyIn;
        if (
          !Number.isInteger(minBuyIn) ||
          !Number.isInteger(maxBuyIn) ||
          minBuyIn < 100 ||
          maxBuyIn > 10000 ||
          maxBuyIn < minBuyIn
        )
          throw new GameError("Choose table bounds between100and10000Credits");
        lobby.pokerTable = {
          id: randomUUID(),
          minBuyIn,
          maxBuyIn,
          handNumber: 0,
          seats: [],
        };
        lobby.state = null;
        lobby.status = "waiting";
      } else {
        delete lobby.pokerTable;
        lobby.state = null;
        lobby.status = "waiting";
      }
      lobby.pokerBuyIn = buyIn;
      lobby.players.forEach((p) => (p.ready = false));
    });
  }
  async pokerSeat(
    userId: string,
    options: { amount: number; sittingOut?: boolean; requestId: string },
  ) {
    const l = await this.required(userId);
    return this.mutate(l.code, (lobby) => {
      if (
        lobby.gameId !== "poker" ||
        !lobby.pokerTable ||
        lobby.pokerTable.closed
      )
        throw new GameError("Open an active persistent poker table first");
      if (lobby.status === "playing")
        throw new GameError("Change your seat between hands");
      lobby.pokerTable.pendingOperation = { type: "seat", userId, ...options };
      lobby.players.find((p) => p.id === userId)!.ready = false;
    });
  }
  async pokerClose(userId: string) {
    const l = await this.required(userId);
    return this.mutate(l.code, (lobby) => {
      if (lobby.gameId !== "poker" || !lobby.pokerTable)
        throw new GameError("Open a persistent poker table first");
      if (lobby.hostId !== userId)
        throw new GameError("Only the host can close the table");
      if (lobby.status === "playing")
        throw new GameError("Close the table between hands");
      lobby.pokerTable.pendingOperation = {
        type: "close",
        userId,
        requestId: randomUUID(),
      };
      lobby.players.forEach((p) => (p.ready = false));
    });
  }
  async start(userId: string) {
    const l = await this.required(userId);
    await requireMultiplayerAvailable(l.gameId);
    return this.mutate(l.code, (lobby) => {
      if (lobby.hostId !== userId)
        throw new GameError("Only the host can start");
      startGame(lobby);
    });
  }
  async action(userId: string, input: unknown) {
    const l = await this.required(userId);
    return this.mutate(l.code, (lobby) => {
      applyGameAction(lobby, userId, input);
    });
  }
  async required(userId: string) {
    const l = await this.current(userId);
    if (!l || !l.players.some((p) => p.id === userId))
      throw new GameError("Join a lobby first");
    return l;
  }
  async disconnected(userId: string, isStillDisconnected = () => true) {
    const l = await this.current(userId);
    if (l)
      await this.mutate(l.code, (lobby) => {
        // A reconnect may have joined while this old disconnect waited for
        // the lobby lock. Recheck live socket ownership inside that lock.
        if (!isStillDisconnected()) return;
        const p = lobby.players.find((p) => p.id === userId);
        if (p) {
          p.connected = false;
          p.disconnectedAt = Date.now();
          if (
            lobby.status === "playing" &&
            (lobby.state?.kind === "tower-defense" ||
              (lobby.state?.kind === "ego-trip" && lobby.state.campaign)) &&
            lobby.players.every((member) => !member.connected)
          )
            lobby.recoveryPausedAt = Date.now();
        }
      });
  }
  async list(gameId?: MultiplayerGameId) {
    const disabled = await disabledMultiplayerGames();
    const codes = await this.redis.zrevrange(this.activeKey, 0, 100),
      lobbies = await Promise.all(codes.map((code) => this.get(code)));
    return lobbies
      .filter(
        (l): l is Lobby =>
          !!l &&
          l.visibility === "public" &&
          !disabled.has(catalogGameId(l.gameId)) &&
          l.status !== "playing" &&
          (!gameId || l.gameId === gameId) &&
          l.players.length < playerLimits(l.gameId).max,
      )
      .map((l) => ({
        code: l.code,
        gameId: l.gameId,
        players: l.players.length,
        maxPlayers: playerLimits(l.gameId).max,
        host: l.players.find((p) => p.id === l.hostId)?.username,
      }));
  }
  async tick(now = Date.now()) {
    await this.workerFence?.assertLease();
    const codes = await this.redis.zrange(this.activeKey, 0, -1);
    for (const code of codes) {
      const l = await this.get(code);
      if (!l) {
        await this.cacheWrite([["zrem", this.activeKey, code]]);
        continue;
      }
      const expired = l.players.filter(
        (p) =>
          p.disconnectedAt &&
          !l.recoveryPausedAt &&
          now - p.disconnectedAt >
            (l.state?.kind === "tower-defense" ||
            (l.state?.kind === "ego-trip" && l.state.campaign)
              ? 120_000
              : 60_000),
      );
      const valid =
        await db`SELECT id FROM users WHERE id=ANY(${l.players.map((p) => p.id)}::uuid[]) AND disabled=false`;
      const invalidAccount = valid.length !== l.players.length;
      const needsTick = tickGame(structuredClone(l), now) || invalidAccount;
      if (needsTick || expired.length) {
        await this.mutate(code, (lobby) => {
          tickGame(lobby, now);
          if (expired.length && lobby.state?.kind === "poker") {
            // Inactive seats time out through normal check/fold; all-ins retain showdown eligibility.
            for (const p of expired) {
              if (lobby.pokerTable && !lobby.pokerTable.closed) {
                const tableSeat = lobby.pokerTable.seats.find(
                  (seat) => seat.userId === p.id,
                );
                if (tableSeat) tableSeat.pendingLeave = true;
              }
              const seat = lobby.state.seats.find(
                (seat) => seat.userId === p.id,
              );
              if (seat && !seat.allIn)
                foldDepartedPokerSeat(lobby.state, p.id, now);
            }
            if (lobby.state.result) lobby.status = "finished";
            lobby.players = lobby.players.filter(
              (p) => !expired.some((old) => old.id === p.id),
            );
            if (
              !lobby.players.some((p) => p.id === lobby.hostId) &&
              lobby.players.length
            )
              lobby.hostId = lobby.players[0].id;
          } else if (
            expired.length &&
            lobby.status === "playing" &&
            lobby.state?.kind === "ego-trip" &&
            lobby.state.campaign
          ) {
            for (const p of expired) departCoop(lobby.state, p.id);
            lobby.players = lobby.players.filter(
              (p) => !expired.some((e) => e.id === p.id),
            );
            if (
              !lobby.players.some((p) => p.id === lobby.hostId) &&
              lobby.players.length
            )
              lobby.hostId = lobby.players[0].id;
          } else if (expired.length && lobby.status === "playing") {
            lobby.status = "finished";
            if (lobby.state)
              lobby.state.result = {
                winners: [],
                scores: Object.fromEntries(lobby.players.map((p) => [p.id, 0])),
                reason: "Reconnect window expired",
              };
          }
          if (expired.length && lobby.status !== "playing") {
            lobby.players = lobby.players.filter(
              (p) => !expired.some((e) => e.id === p.id),
            );
            if (
              !lobby.players.some((p) => p.id === lobby.hostId) &&
              lobby.players.length
            )
              lobby.hostId = lobby.players[0].id;
          }
        }).catch((e) => {
          if (!(e instanceof GameError)) throw e;
        });
        for (const p of expired) {
          if ((await this.redis.get(this.membershipKey(p.id))) === code)
            await this.cacheWrite([["del", this.membershipKey(p.id)]]);
        }
      }
    }
  }
  private async record(lobby: Lobby, sql: Sql) {
    if (lobby.status !== "finished" || !lobby.state?.result || lobby.recorded)
      return;
    const result = lobby.state.result;
    await sql`INSERT INTO multiplayer_matches(id,game_id,lobby_code,started_at,result) VALUES(${lobby.matchId},${lobby.gameId},${lobby.code},${new Date(lobby.startedAt ?? lobby.createdAt).toISOString()},${sql.json({ winners: result.winners, scores: result.scores, reason: result.reason })}) ON CONFLICT(id) DO NOTHING`;
    const participants =
      lobby.state?.kind === "poker"
        ? lobby.state.seats.map((p) => ({ id: p.userId }))
        : // A departing participant can leave before the terminal snapshot.
          // Scores are generated by the server engine and retain that identity.
          Object.keys(result.scores).map((id) => ({ id }));
    for (const p of participants)
      await sql`INSERT INTO multiplayer_results(match_id,user_id,score,won) SELECT ${lobby.matchId},id,${result.scores[p.id] ?? 0},${result.winners.includes(p.id)} FROM users WHERE id=${p.id} AND disabled=false ON CONFLICT DO NOTHING`;
    if (lobby.state.kind === "ego-trip")
      await settleEgoCoopProgress(sql, lobby.matchId, lobby.state);
    lobby.recorded = true;
  }
  view(lobby: Lobby, userId: string) {
    return lobbyView(lobby, userId);
  }
}
