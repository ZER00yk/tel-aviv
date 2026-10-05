import { z } from "zod";
import type { TransactionSql } from "postgres";
import { db } from "@tell-aviv/database";
import {
  GameError,
  multiplayerGameIds,
  playerLimits,
  type MultiplayerGameId,
} from "./engines";
import { catalogGameId, requireMultiplayerAvailable } from "./availability";
import { eventChannel } from "./events";
import type { LobbyStore } from "./store";

export const queueOptionsSchema = z
  .object({
    gameId: z.enum(multiplayerGameIds),
    region: z
      .enum(["global", "americas", "europe", "asia-pacific"])
      .default("global"),
    mode: z.enum(["casual", "ranked"]).default("casual"),
    coopMode: z.enum(["gauntlet", "campaign"]).default("gauntlet"),
    party: z.boolean().default(false),
  })
  .strict();
export type QueueOptions = z.infer<typeof queueOptionsSchema>;
interface Ticket {
  id: string;
  namespace: string;
  leader_id: string;
  party_id: string | null;
  party_queued: boolean;
  member_count: number;
  game_id: MultiplayerGameId;
  region: QueueOptions["region"];
  mode: "casual";
  coop_mode: "gauntlet" | "campaign";
  status: string;
  lobby_code: string | null;
  reason: string | null;
  created_at: Date;
  updated_at: Date;
  matched_at: Date | null;
  ready_deadline: Date | null;
}
interface Member {
  id: string;
  username: string;
  seenAt?: Date;
}
export interface QueueStatus {
  ticketId: string;
  gameId: MultiplayerGameId;
  region: string;
  mode: "casual";
  coopMode: string;
  status: string;
  party: boolean;
  memberCount: number;
  leader: boolean;
  queuedAt: string;
  waitedSeconds: number;
  poolPlayers: number;
  minPlayers: number;
  maxPlayers: number;
  lobbyCode: string | null;
  readyDeadline: string | null;
  reason: string | null;
}
type Sql = TransactionSql;
const connectionsKey = (userId: string) => `tell-aviv:connections:${userId}`;
export class QueueStore {
  private lastTick = 0;
  constructor(
    public store: LobbyStore,
    private connectedUser?: (userId: string) => boolean,
  ) {}
  private get namespace() {
    return this.store.namespace;
  }
  private async locked<T>(fn: (sql: Sql) => Promise<T>) {
    return db.begin(async (sql) => {
      await this.store.guardTransaction(sql);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${this.namespace}:queue`}))`;
      return fn(sql);
    });
  }
  private async members(sql: Sql, ticketId: string): Promise<Member[]> {
    return sql<
      Member[]
    >`SELECT u.id,u.username,m.last_seen_at AS "seenAt" FROM matchmaking_members m JOIN users u ON u.id=m.user_id WHERE m.ticket_id=${ticketId} ORDER BY m.joined_at,u.id`;
  }
  private async online(userId: string) {
    if (this.connectedUser) return this.connectedUser(userId);
    await this.store.redis.zremrangebyscore(
      connectionsKey(userId),
      "-inf",
      Date.now(),
    );
    return (await this.store.redis.zcard(connectionsKey(userId))) > 0;
  }
  async recover() {
    // A new worker gives persisted waiting members time to reconnect before cancellation.
    await this.locked(async (sql) => {
      await sql`UPDATE matchmaking_members m SET last_seen_at=now() FROM matchmaking_tickets t WHERE t.id=m.ticket_id AND t.namespace=${this.namespace} AND t.status='waiting' AND m.active`;
    });
  }
  async connected(userId: string) {
    await this.locked(async (sql) => {
      await sql`UPDATE matchmaking_members SET last_seen_at=now() WHERE namespace=${this.namespace} AND user_id=${userId} AND active`;
    });
  }
  private async statusWith(
    sql: Sql,
    userId: string,
  ): Promise<QueueStatus | null> {
    const [ticket] = await sql<
      Ticket[]
    >`SELECT t.* FROM matchmaking_tickets t JOIN matchmaking_members m ON m.ticket_id=t.id WHERE t.namespace=${this.namespace} AND m.user_id=${userId} ORDER BY t.created_at DESC LIMIT 1`;
    if (!ticket) return null;
    const [pool] =
      await sql`SELECT count(*)::integer AS count FROM matchmaking_members m JOIN matchmaking_tickets t ON t.id=m.ticket_id WHERE t.namespace=${this.namespace} AND t.status='waiting' AND m.active AND t.game_id=${ticket.game_id} AND t.region=${ticket.region} AND t.mode=${ticket.mode} AND t.coop_mode=${ticket.coop_mode}`;
    const limits = playerLimits(ticket.game_id);
    return {
      ticketId: ticket.id,
      gameId: ticket.game_id,
      region: ticket.region,
      mode: ticket.mode,
      coopMode: ticket.coop_mode,
      status: ticket.status,
      party: ticket.party_queued,
      memberCount: ticket.member_count,
      leader: ticket.leader_id === userId,
      queuedAt: new Date(ticket.created_at).toISOString(),
      waitedSeconds: Math.max(
        0,
        Math.floor((Date.now() - new Date(ticket.created_at).getTime()) / 1000),
      ),
      poolPlayers: Number(pool.count),
      minPlayers: limits.min,
      maxPlayers: limits.max,
      lobbyCode: ticket.lobby_code,
      readyDeadline: ticket.ready_deadline
        ? new Date(ticket.ready_deadline).toISOString()
        : null,
      reason: ticket.reason,
    };
  }
  async status(userId: string) {
    await this.connected(userId);
    return db.begin((sql) => this.statusWith(sql, userId));
  }
  private async publish(ticketIds: string[]) {
    if (!ticketIds.length) return;
    const rows = await db<
      { user_id: string }[]
    >`SELECT DISTINCT user_id FROM matchmaking_members WHERE ticket_id=ANY(${ticketIds}::uuid[])`;
    for (const row of rows)
      await this.store.redis.publish(
        eventChannel,
        JSON.stringify({
          type: "queue:changed",
          userIds: [row.user_id],
          payload: { namespace: this.namespace },
        }),
      );
  }
  async requireNotWaiting(userId: string) {
    const [active] =
      await db`SELECT 1 FROM matchmaking_members m JOIN matchmaking_tickets t ON t.id=m.ticket_id WHERE m.namespace=${this.namespace} AND m.user_id=${userId} AND m.active AND t.status IN ('waiting','matching')`;
    if (active)
      throw new GameError(
        "Leave matchmaking before creating or joining another room",
      );
  }
  async authorizeLobbyJoin(userId: string, code: string) {
    const [reservation] =
      await db`SELECT 1 FROM matchmaking_tickets WHERE namespace=${this.namespace} AND lobby_code=${code} AND status IN ('matching','matched','playing')`;
    if (!reservation) return;
    const [member] =
      await db`SELECT 1 FROM matchmaking_members m JOIN matchmaking_tickets t ON t.id=m.ticket_id WHERE t.namespace=${this.namespace} AND t.lobby_code=${code} AND m.user_id=${userId}`;
    if (!member)
      throw new GameError(
        "This matched room is reserved for its queued players",
      );
  }
  async authorizeReady(userId: string) {
    const [reservation] =
      await db`SELECT t.status FROM matchmaking_tickets t JOIN matchmaking_members m ON m.ticket_id=t.id WHERE m.namespace=${this.namespace} AND m.user_id=${userId} AND m.active AND t.status IN ('waiting','matching')`;
    if (reservation)
      throw new GameError(
        "Wait for the matchmaking ready check before starting",
      );
  }
  async join(user: Member, options: QueueOptions) {
    if ((options.gameId as string) === "poker")
      throw new GameError(
        "Use private poker table controls; public poker matchmaking is not available",
      );
    if (options.gameId === "tower-defense")
      throw new GameError("Use a private room for live co-op defense.");
    if (options.mode !== "casual")
      throw new GameError(
        "Ranked multiplayer matchmaking is not available; solo ranked Ego Trip uses its separate server-simulated mode",
      );
    if (options.gameId !== "ego-trip" && options.coopMode !== "gauntlet")
      throw new GameError(
        "Campaign matchmaking is available for Ego Trip only",
      );
    await requireMultiplayerAvailable(options.gameId);
    let ticketId = "";
    const result = await this.locked(async (sql) => {
      const [existing] = await sql<
        Ticket[]
      >`SELECT t.* FROM matchmaking_tickets t JOIN matchmaking_members m ON m.ticket_id=t.id WHERE m.namespace=${this.namespace} AND m.user_id=${user.id} AND m.active LIMIT 1`;
      if (existing) {
        if (
          existing.game_id !== options.gameId ||
          existing.region !== options.region ||
          existing.coop_mode !== options.coopMode ||
          existing.party_queued !== options.party
        )
          throw new GameError("Leave your current matchmaking queue first");
        return this.statusWith(sql, user.id);
      }
      let partyId: string | null = null;
      let members: Member[] = [user];
      if (options.party) {
        const [party] =
          await sql`SELECT p.id,p.leader_id FROM parties p JOIN party_members m ON m.party_id=p.id WHERE m.user_id=${user.id}`;
        if (!party || party.leader_id !== user.id)
          throw new GameError(
            "Only the current party leader can queue a party",
          );
        const partyMembers =
          await sql`SELECT u.id,u.username,m.ready FROM party_members m JOIN users u ON u.id=m.user_id WHERE m.party_id=${party.id} ORDER BY m.joined_at,u.id`;
        if (partyMembers.some((member) => !member.ready))
          throw new GameError(
            "Every party member must be ready before matchmaking",
          );
        partyId = party.id;
        members = partyMembers.map((member) => ({
          id: String(member.id),
          username: String(member.username),
        }));
      }
      if (members.length > playerLimits(options.gameId).max || !members.length)
        throw new GameError("This party is too large for the selected game");
      const valid =
        await sql`SELECT id FROM users WHERE id=ANY(${members.map((member) => member.id)}::uuid[]) AND disabled=false`;
      if (valid.length !== members.length)
        throw new GameError("A queue account is unavailable");
      const [blocked] =
        await sql`SELECT 1 FROM user_blocks WHERE user_id=ANY(${members.map((member) => member.id)}::uuid[]) AND blocked_id=ANY(${members.map((member) => member.id)}::uuid[]) LIMIT 1`;
      if (blocked)
        throw new GameError(
          "A party member cannot match with another party member",
        );
      for (const member of members) {
        if (!(await this.online(member.id)))
          throw new GameError(
            "Every queued member must be connected to realtime",
          );
        if (await this.store.current(member.id))
          throw new GameError("A queued member is already in a room");
        const [queued] =
          await sql`SELECT 1 FROM matchmaking_members WHERE namespace=${this.namespace} AND user_id=${member.id} AND active`;
        if (queued) throw new GameError("A party member is already queued");
      }
      const [count] =
        await sql`SELECT count(*)::integer AS count FROM matchmaking_tickets WHERE namespace=${this.namespace} AND status IN ('waiting','matching')`;
      if (count.count >= 500)
        throw new GameError("The queue is busy; try again shortly");
      const [ticket] =
        await sql`INSERT INTO matchmaking_tickets(namespace,leader_id,party_id,party_queued,member_count,game_id,region,mode,coop_mode) VALUES(${this.namespace},${user.id},${partyId},${options.party},${members.length},${options.gameId},${options.region},'casual',${options.gameId === "ego-trip" ? options.coopMode : "gauntlet"}) RETURNING id`;
      ticketId = ticket.id;
      for (const member of members)
        await sql`INSERT INTO matchmaking_members(ticket_id,namespace,user_id) VALUES(${ticket.id},${this.namespace},${member.id})`;
      return this.statusWith(sql, user.id);
    });
    if (ticketId) await this.publish([ticketId]);
    return result;
  }
  private async closeTickets(
    sql: Sql,
    ticketIds: string[],
    status: string,
    reason: string,
  ) {
    await sql`UPDATE matchmaking_tickets SET status=${status},reason=${reason},closed_at=now(),updated_at=now() WHERE id=ANY(${ticketIds}::uuid[])`;
    await sql`UPDATE matchmaking_members SET active=false WHERE ticket_id=ANY(${ticketIds}::uuid[])`;
  }
  private async dissolve(sql: Sql, code: string, reason: string) {
    const tickets = await sql<
      { id: string }[]
    >`SELECT id FROM matchmaking_tickets WHERE namespace=${this.namespace} AND lobby_code=${code} AND status IN ('matching','matched')`;
    const lobby = await this.store.get(code);
    if (lobby?.status === "playing")
      throw new GameError(
        "This match has started; leave through the game controls",
      );
    if (lobby)
      for (const member of [...lobby.players]) {
        if ((await this.store.current(member.id))?.code === code)
          await this.store.leave(member.id);
      }
    await this.closeTickets(
      sql,
      tickets.map((ticket) => ticket.id),
      "cancelled",
      reason,
    );
    return tickets.map((ticket) => ticket.id);
  }
  async leave(userId: string) {
    let changed: string[] = [];
    const result = await this.locked(async (sql) => {
      const [ticket] = await sql<
        Ticket[]
      >`SELECT t.* FROM matchmaking_tickets t JOIN matchmaking_members m ON m.ticket_id=t.id WHERE m.namespace=${this.namespace} AND m.user_id=${userId} AND m.active LIMIT 1`;
      if (!ticket) return this.statusWith(sql, userId);
      if (ticket.status === "matched" && ticket.lobby_code)
        changed = await this.dissolve(
          sql,
          ticket.lobby_code,
          "A player declined the ready check",
        );
      else {
        changed = [ticket.id];
        await this.closeTickets(
          sql,
          changed,
          "cancelled",
          ticket.party_id
            ? "A party member cancelled matchmaking"
            : "Matchmaking cancelled",
        );
      }
      return this.statusWith(sql, userId);
    });
    await this.publish(changed);
    return result;
  }
  private async eligible(
    sql: Sql,
    ticket: Ticket,
  ): Promise<Member[] | "pending" | null> {
    const members = await this.members(sql, ticket.id);
    const valid =
      await sql`SELECT id FROM users WHERE id=ANY(${members.map((member) => member.id)}::uuid[]) AND disabled=false`;
    if (
      !members.length ||
      members.length !== ticket.member_count ||
      valid.length !== members.length ||
      (ticket.party_queued && !ticket.party_id)
    )
      return null;
    const [blocked] =
      await sql`SELECT 1 FROM user_blocks WHERE user_id=ANY(${members.map((member) => member.id)}::uuid[]) AND blocked_id=ANY(${members.map((member) => member.id)}::uuid[]) LIMIT 1`;
    if (blocked) return null;
    if (ticket.party_id) {
      const [party] =
        await sql`SELECT leader_id FROM parties WHERE id=${ticket.party_id}`;
      const partyMembers =
        await sql`SELECT user_id,ready FROM party_members WHERE party_id=${ticket.party_id}`;
      if (
        !party ||
        party.leader_id !== ticket.leader_id ||
        partyMembers.length !== members.length ||
        partyMembers.some(
          (member) =>
            !member.ready ||
            !members.some((queued) => queued.id === member.user_id),
        )
      )
        return null;
    }
    let pending = false;
    for (const member of members) {
      if (await this.store.current(member.id)) return null;
      if (await this.online(member.id))
        await sql`UPDATE matchmaking_members SET last_seen_at=now() WHERE ticket_id=${ticket.id} AND user_id=${member.id}`;
      else if (Date.now() - new Date(member.seenAt ?? 0).getTime() > 30_000)
        return null;
      else pending = true;
    }
    if (pending) return "pending";
    return members;
  }
  async tick(force = false) {
    if (!force && Date.now() - this.lastTick < 1000) return;
    this.lastTick = Date.now();
    const changed: string[] = [];
    await this.locked(async (sql) => {
      const now = Date.now();
      // A crash during reservation is cancelled rather than reusing a possibly partial room.
      const stale = await sql<
        Ticket[]
      >`SELECT * FROM matchmaking_tickets WHERE namespace=${this.namespace} AND status='matching' AND updated_at<now()-interval '10 seconds'`;
      for (const ticket of stale) {
        if (ticket.lobby_code)
          changed.push(
            ...(await this.dissolve(
              sql,
              ticket.lobby_code,
              "Match creation interrupted; join the queue again",
            )),
          );
        else {
          await this.closeTickets(
            sql,
            [ticket.id],
            "failed",
            "Match creation interrupted; join the queue again",
          );
          changed.push(ticket.id);
        }
      }
      const active = await sql<
        Ticket[]
      >`SELECT * FROM matchmaking_tickets WHERE namespace=${this.namespace} AND status IN ('matched','playing')`;
      for (const code of [
        ...new Set(
          active
            .map((ticket) => ticket.lobby_code)
            .filter((code): code is string => !!code),
        ),
      ]) {
        const tickets = active.filter((ticket) => ticket.lobby_code === code);
        const lobby = await this.store.get(code);
        if (!lobby) {
          const playing = tickets.filter(
            (ticket) => ticket.status === "playing",
          );
          const pending = tickets.filter(
            (ticket) => ticket.status !== "playing",
          );
          if (playing.length)
            await this.closeTickets(
              sql,
              playing.map((ticket) => ticket.id),
              "completed",
              "Match ended",
            );
          if (pending.length)
            await this.closeTickets(
              sql,
              pending.map((ticket) => ticket.id),
              "failed",
              "The matched room could not be restored",
            );
          changed.push(...tickets.map((ticket) => ticket.id));
        } else if (lobby.status === "playing") {
          const waiting = tickets.filter(
            (ticket) => ticket.status !== "playing",
          );
          if (waiting.length) {
            await sql`UPDATE matchmaking_tickets SET status='playing',updated_at=now() WHERE id=ANY(${waiting.map((ticket) => ticket.id)}::uuid[])`;
            await sql`UPDATE matchmaking_members SET active=false WHERE ticket_id=ANY(${waiting.map((ticket) => ticket.id)}::uuid[])`;
            changed.push(...waiting.map((ticket) => ticket.id));
          }
        } else if (lobby.status === "finished") {
          await this.closeTickets(
            sql,
            tickets.map((ticket) => ticket.id),
            "completed",
            "Match finished",
          );
          changed.push(...tickets.map((ticket) => ticket.id));
        } else if (
          tickets.some(
            (ticket) =>
              ticket.ready_deadline &&
              new Date(ticket.ready_deadline).getTime() < now,
          )
        )
          changed.push(
            ...(await this.dissolve(
              sql,
              code,
              "Ready check expired; join the queue again",
            )),
          );
      }
      const waiting = await sql<
        Ticket[]
      >`SELECT * FROM matchmaking_tickets WHERE namespace=${this.namespace} AND status='waiting' ORDER BY created_at,id LIMIT 500`;
      const candidates: { ticket: Ticket; members: Member[] }[] = [];
      for (const ticket of waiting) {
        let interrupted = false;
        for (const member of await this.members(sql, ticket.id)) {
          const room = await this.store.current(member.id);
          if (!room?.queueTicketIds?.includes(ticket.id)) continue;
          const reservationIds = room.queueTicketIds;
          if (room.status === "playing") {
            await sql`UPDATE matchmaking_tickets SET status='playing',lobby_code=${room.code},matched_at=coalesce(matched_at,now()),updated_at=now() WHERE namespace=${this.namespace} AND id=ANY(${reservationIds}::uuid[]) AND status IN ('waiting','matching')`;
            await sql`UPDATE matchmaking_members SET active=false WHERE ticket_id=ANY(${reservationIds}::uuid[])`;
          } else {
            for (const reserved of [...room.players])
              if ((await this.store.current(reserved.id))?.code === room.code)
                await this.store.leave(reserved.id);
            await this.closeTickets(
              sql,
              reservationIds,
              "failed",
              "Match creation interrupted; join the queue again",
            );
          }
          changed.push(...reservationIds);
          interrupted = true;
          break;
        }
        if (interrupted || changed.includes(ticket.id)) continue;
        if (now - new Date(ticket.created_at).getTime() > 10 * 60_000) {
          await this.closeTickets(
            sql,
            [ticket.id],
            "expired",
            "Queue wait expired",
          );
          changed.push(ticket.id);
          continue;
        }
        const members = await this.eligible(sql, ticket);
        if (members === "pending") continue;
        if (!members) {
          await this.closeTickets(
            sql,
            [ticket.id],
            "cancelled",
            "A queued member disconnected, changed party, or became unavailable",
          );
          changed.push(ticket.id);
          continue;
        }
        try {
          await requireMultiplayerAvailable(ticket.game_id);
        } catch {
          await this.closeTickets(
            sql,
            [ticket.id],
            "cancelled",
            "This game is temporarily unavailable",
          );
          changed.push(ticket.id);
          continue;
        }
        candidates.push({ ticket, members });
      }
      const used = new Set<string>();
      for (const first of candidates) {
        if (used.has(first.ticket.id)) continue;
        const limits = playerLimits(first.ticket.game_id),
          selected = [first];
        let members = [...first.members];
        for (const next of candidates) {
          if (
            next === first ||
            used.has(next.ticket.id) ||
            next.ticket.game_id !== first.ticket.game_id ||
            next.ticket.region !== first.ticket.region ||
            next.ticket.coop_mode !== first.ticket.coop_mode ||
            members.length + next.members.length > limits.max
          )
            continue;
          const ids = members.map((member) => member.id),
            otherIds = next.members.map((member) => member.id);
          const [blocked] =
            await sql`SELECT 1 FROM user_blocks WHERE (user_id=ANY(${ids}::uuid[]) AND blocked_id=ANY(${otherIds}::uuid[])) OR (blocked_id=ANY(${ids}::uuid[]) AND user_id=ANY(${otherIds}::uuid[])) LIMIT 1`;
          if (blocked) continue;
          selected.push(next);
          members = [...members, ...next.members];
          if (members.length === limits.max) break;
        }
        if (members.length < limits.min) continue;
        const ticketIds = selected.map((candidate) => candidate.ticket.id);
        for (const id of ticketIds) used.add(id);
        let code: string | null = null;
        try {
          await sql`UPDATE matchmaking_tickets SET status='matching',updated_at=now() WHERE id=ANY(${ticketIds}::uuid[])`;
          const host =
            members.find((member) => member.id === first.ticket.leader_id) ??
            members[0];
          const lobby = await this.store.create(
            host,
            first.ticket.game_id,
            "private",
            first.ticket.coop_mode,
            ticketIds,
          );
          code = lobby.code;
          await sql`UPDATE matchmaking_tickets SET lobby_code=${code} WHERE id=ANY(${ticketIds}::uuid[])`;
          for (const member of members)
            if (member.id !== host.id) await this.store.join(code, member);
          await sql`UPDATE matchmaking_tickets SET status='matched',matched_at=now(),ready_deadline=now()+interval '45 seconds',updated_at=now() WHERE id=ANY(${ticketIds}::uuid[])`;
          for (const member of members)
            await sql`INSERT INTO notifications(user_id,kind,title,link) VALUES(${member.id},'matchmaking','Match ready: confirm in your game room',${`/games/${catalogGameId(first.ticket.game_id)}/play`})`;
          changed.push(...ticketIds);
        } catch (error) {
          if (code)
            for (const member of members)
              if ((await this.store.current(member.id))?.code === code)
                await this.store.leave(member.id).catch(() => undefined);
          await this.closeTickets(
            sql,
            ticketIds,
            "failed",
            error instanceof GameError
              ? error.message
              : "Match creation failed; try again",
          );
          changed.push(...ticketIds);
        }
      }
    });
    await this.publish(changed);
  }
}
