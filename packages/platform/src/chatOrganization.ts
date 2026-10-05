import { z } from "zod";
import { db } from "../../database/src/index";
import { fail, type User } from "../../shared/src/index";
import { publishEvent } from "../../../apps/realtime/src/events";
import type { TransactionSql } from "postgres";

type Room = {
  id: string;
  kind: string;
  owner_id?: string | null;
  server_id?: string | null;
};
export type ChatOrganizationDeps = {
  authorizeRoom: (
    userId: string,
    roomId: string,
    permission?: "view_channel" | "send_messages",
  ) => Promise<Room>;
  threadAccess: (
    userId: string,
    roomId: string,
    threadId: string,
  ) => Promise<{ id: string; rootId: string | null }>;
  requireServerPermission: (
    userId: string,
    serverId: string,
    permission: "manage_messages",
  ) => Promise<unknown>;
  notify: (
    userId: string,
    actorId: string,
    kind: string,
    title: string,
    link: string,
  ) => Promise<void>;
};
const uuid = z.string().uuid();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    fail(400, result.error.issues.map((issue) => issue.message).join("; "));
  return result.data;
}
// Group removal/leave locks this same row, so stale authorization cannot write
// thread metadata or recreate subscriptions after a member has been removed.
async function lockAuthorizedRoom(
  tx: TransactionSql,
  user: User,
  room: Room,
  deps: ChatOrganizationDeps,
) {
  const [current] =
    await tx`SELECT id FROM chat_rooms WHERE id=${room.id} FOR SHARE`;
  if (!current) fail(404, "Chat room not found");
  return deps.authorizeRoom(user.id, room.id);
}
export async function ensureThread(
  userId: string,
  room: Room,
  threadId: string,
  deps: ChatOrganizationDeps,
) {
  const access = await deps.threadAccess(
    userId,
    room.id,
    parse(uuid, threadId),
  );
  await db.begin(async (tx) => {
    const existing =
      await tx`SELECT id FROM chat_threads WHERE id=${threadId} AND room_id=${room.id}`;
    if (existing.length) return;
    const [root] =
      await tx`SELECT id,author_id FROM chat_messages WHERE id=${access.rootId} AND room_id=${room.id} AND thread_id IS NULL FOR KEY SHARE`;
    if (!root) fail(409, "The thread root changed. Reopen the conversation.");
    await tx`INSERT INTO chat_threads(id,room_id,root_message_id,created_by) VALUES(${threadId},${room.id},${root.id},${root.author_id}) ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO chat_thread_members(thread_id,user_id) VALUES(${threadId},${root.author_id}) ON CONFLICT DO NOTHING`;
  });
  return access;
}

export async function threadDetails(
  user: User,
  room: Room,
  threadId: string,
  deps: ChatOrganizationDeps,
) {
  const [thread] =
    await db`SELECT t.name,t.archived_at AS "archivedAt",t.created_by AS "createdBy",t.updated_at AS "updatedAt",COALESCE(tm.following,false) AS following,(SELECT count(*)::int FROM chat_messages m WHERE m.thread_id=t.id AND m.deleted_at IS NULL AND m.author_id<>${user.id} AND m.created_at>COALESCE(tm.read_at,'epoch'::timestamptz) AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=${user.id} AND b.blocked_id=m.author_id) OR (b.blocked_id=${user.id} AND b.user_id=m.author_id))) AS unread FROM chat_threads t LEFT JOIN chat_thread_members tm ON tm.thread_id=t.id AND tm.user_id=${user.id} WHERE t.id=${threadId} AND t.room_id=${room.id}`;
  if (!thread) {
    const [root] =
      await db`SELECT author_id FROM chat_messages WHERE id=${threadId} AND room_id=${room.id} AND thread_id IS NULL`;
    return {
      name: "",
      archivedAt: null,
      following: false,
      unread: 0,
      canManage:
        root?.author_id === user.id ||
        room.owner_id === user.id ||
        ["owner", "admin"].includes(user.role),
    };
  }
  let canManage =
    thread.createdBy === user.id ||
    room.owner_id === user.id ||
    ["owner", "admin"].includes(user.role);
  if (!canManage && room.kind === "channel" && room.server_id) {
    try {
      await deps.requireServerPermission(
        user.id,
        room.server_id,
        "manage_messages",
      );
      canManage = true;
    } catch {
      /* View access does not grant moderation. */
    }
  }
  return { ...thread, canManage };
}

/** Visible activity is derived from authorized messages, including exact SQL timestamp cursors. */
export async function listThreads(userId: string, room: Room, url: URL) {
  const limit = Math.min(
    100,
    Math.max(1, Math.trunc(Number(url.searchParams.get("limit"))) || 50),
  );
  const cursor = url.searchParams.get("before");
  if (cursor) parse(uuid, cursor);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const archived = url.searchParams.get("archived") === "true";
  const followed = url.searchParams.get("following") === "true";
  const summaries = db`SELECT t.id,t.name,t.archived_at AS "archivedAt",t.created_at AS "createdAt",CASE WHEN root.deleted_at IS NULL THEN root.content ELSE '' END AS "rootContent",root.deleted_at AS "rootDeletedAt",u.display_name AS "displayName",count(reply.id)::int AS "replyCount",GREATEST(t.created_at,COALESCE(max(reply.created_at),t.created_at)) AS "updatedAt",COALESCE(tm.following,false) AS following,count(reply.id) FILTER(WHERE reply.author_id<>${userId} AND reply.created_at>COALESCE(tm.read_at,'epoch'::timestamptz))::int AS unread FROM chat_threads t LEFT JOIN chat_messages root ON root.id=t.root_message_id LEFT JOIN users u ON u.id=root.author_id LEFT JOIN chat_thread_members tm ON tm.thread_id=t.id AND tm.user_id=${userId} LEFT JOIN chat_messages reply ON reply.thread_id=t.id AND reply.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=${userId} AND b.blocked_id=reply.author_id) OR (b.blocked_id=${userId} AND b.user_id=reply.author_id)) WHERE t.room_id=${room.id} AND (t.archived_at IS NOT NULL)=${archived} AND (${!followed} OR tm.following=true) AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=${userId} AND b.blocked_id=root.author_id) OR (b.blocked_id=${userId} AND b.user_id=root.author_id)) AND (${!q} OR t.name ILIKE ${"%" + q + "%"} OR (root.deleted_at IS NULL AND root.content ILIKE ${"%" + q + "%"})) GROUP BY t.id,root.id,u.display_name,tm.following,tm.read_at,tm.user_id HAVING count(reply.id)>0 OR t.name<>'' OR t.created_by=${userId} OR tm.user_id IS NOT NULL`;
  if (
    cursor &&
    !(
      await db`WITH summaries AS (${summaries}) SELECT id FROM summaries WHERE id=${cursor}`
    ).length
  )
    fail(400, "Invalid thread discovery cursor");
  const rows =
    await db`WITH summaries AS (${summaries}) SELECT * FROM summaries WHERE (${!cursor} OR ("updatedAt",id)<(SELECT "updatedAt",id FROM summaries WHERE id=${cursor || room.id}::uuid)) ORDER BY "updatedAt" DESC,id DESC LIMIT ${limit + 1}`;
  const more = rows.length > limit;
  const threads = rows.slice(0, limit);
  return { threads, nextCursor: more ? (threads.at(-1)?.id ?? null) : null };
}

export async function notifyThreadSubscribers(
  user: User,
  room: Room,
  threadId: string,
  deps: ChatOrganizationDeps,
) {
  const subscribers =
    await db`SELECT user_id FROM chat_thread_members WHERE thread_id=${threadId} AND following=true AND user_id<>${user.id}`;
  for (const subscriber of subscribers) {
    try {
      await deps.authorizeRoom(subscriber.user_id, room.id);
      await deps.threadAccess(subscriber.user_id, room.id, threadId);
    } catch {
      continue;
    }
    await deps.notify(
      subscriber.user_id,
      user.id,
      "thread",
      `${user.displayName} replied in a followed thread`,
      `/chat?room=${room.id}&thread=${threadId}`,
    );
  }
}

export async function handleThreadOrganization(
  path: string[],
  method: string,
  user: User,
  input: unknown,
  deps: ChatOrganizationDeps,
) {
  const [, roomId, segment, threadId, action] = path;
  if (!roomId || segment !== "threads" || !threadId || method === "GET")
    return undefined;
  if (!(
    (!action && method === "PATCH") ||
    (["follow", "read"].includes(action ?? "") && method === "POST")
  ))
    return undefined;
  const room = await deps.authorizeRoom(user.id, roomId);
  await ensureThread(user.id, room, threadId, deps);
  if (!action) {
    const data = parse(
      z
        .object({
          name: z.string().trim().min(1).max(100).optional(),
          archived: z.boolean().optional(),
        })
        .strict(),
      input,
    );
    await db.begin(async (tx) => {
      const currentRoom = await lockAuthorizedRoom(tx, user, room, deps);
      const [current] =
        await tx`SELECT name,archived_at FROM chat_threads WHERE id=${threadId} AND room_id=${room.id} FOR UPDATE`;
      if (!current) fail(404, "Thread not found");
      const details = await threadDetails(user, currentRoom, threadId, deps);
      if (!details.canManage)
        fail(403, "Thread creator or room moderator required");
      await tx`UPDATE chat_threads SET name=${data.name ?? current.name},archived_at=${data.archived === undefined ? current.archived_at : data.archived ? new Date() : null} WHERE id=${threadId}`;
    });
    await publishEvent({
      type: "chat:thread:update",
      roomId: room.id,
      payload: { threadId, authorId: user.id },
    });
  } else if (action === "follow") {
    const { following } = parse(
      z.object({ following: z.boolean() }).strict(),
      input,
    );
    await db.begin(async (tx) => {
      await lockAuthorizedRoom(tx, user, room, deps);
      await tx`SELECT id FROM chat_threads WHERE id=${threadId} FOR UPDATE`;
      const [existing] =
        await tx`SELECT following FROM chat_thread_members WHERE thread_id=${threadId} AND user_id=${user.id}`;
      if (
        following &&
        !existing?.following &&
        Number(
          (
            await tx`SELECT count(*)::int AS count FROM chat_thread_members WHERE thread_id=${threadId} AND following=true`
          )[0].count,
        ) >= 1000
      )
        fail(409, "This thread has reached its 1,000 follower limit");
      await tx`INSERT INTO chat_thread_members(thread_id,user_id,following) VALUES(${threadId},${user.id},${following}) ON CONFLICT(thread_id,user_id) DO UPDATE SET following=EXCLUDED.following`;
    });
    await publishEvent({
      type: "chat:thread:read",
      userIds: [user.id],
      payload: { threadId, roomId: room.id },
    });
  } else {
    const { messageId } = parse(
      z.object({ messageId: uuid.optional() }).strict(),
      input,
    );
    await db.begin(async (tx) => {
      await lockAuthorizedRoom(tx, user, room, deps);
      if (
        messageId &&
        !(
          await tx`SELECT id FROM chat_messages WHERE id=${messageId} AND thread_id=${threadId} AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=${user.id} AND b.blocked_id=author_id) OR (b.blocked_id=${user.id} AND b.user_id=author_id))`
        ).length
      )
        fail(400, "Read message must be a visible reply in this thread");
      await tx`INSERT INTO chat_thread_members(thread_id,user_id,following,read_message_id,read_at) VALUES(${threadId},${user.id},false,${messageId ?? null},COALESCE((SELECT created_at FROM chat_messages WHERE id=${messageId ?? null}),now())) ON CONFLICT(thread_id,user_id) DO UPDATE SET read_at=GREATEST(chat_thread_members.read_at,EXCLUDED.read_at),read_message_id=CASE WHEN EXCLUDED.read_at>=chat_thread_members.read_at THEN EXCLUDED.read_message_id ELSE chat_thread_members.read_message_id END`;
    });
    await publishEvent({
      type: "chat:thread:read",
      userIds: [user.id],
      payload: { threadId, roomId: room.id },
    });
  }
  return threadDetails(user, room, threadId, deps);
}

export async function handleGroupOrganization(
  path: string[],
  method: string,
  user: User,
  input: unknown,
) {
  const [, roomId, action, target] = path;
  if (
    !roomId ||
    !(
      (!action && method === "PATCH") ||
      (action === "members" &&
        (method === "GET" || (method === "DELETE" && target)))
    )
  )
    return undefined;
  parse(uuid, roomId);
  const [room] =
    await db`SELECT r.id,r.owner_id AS "ownerId",r.name,r.icon FROM chat_rooms r JOIN chat_members m ON m.room_id=r.id AND m.user_id=${user.id} WHERE r.id=${roomId} AND r.kind='group'`;
  if (!room) fail(403, "Group membership required");
  if (method === "GET")
    return {
      ...room,
      members:
        await db`SELECT u.id,u.username,u.display_name AS "displayName",u.avatar,m.joined_at AS "joinedAt" FROM chat_members m JOIN users u ON u.id=m.user_id WHERE m.room_id=${roomId} ORDER BY m.joined_at,u.id`,
    };
  const data = !action
    ? parse(
        z
          .object({
            name: z.string().trim().min(1).max(100).optional(),
            icon: z
              .string()
              .url()
              .max(2048)
              .refine(
                (value) => /^https:\/\//.test(value),
                "Use an HTTPS image URL",
              )
              .nullable()
              .optional(),
          })
          .strict(),
        input,
      )
    : null;
  if (target) parse(uuid, target);
  const memberIds: string[] = await db.begin(async (tx) => {
    const [current] =
      await tx`SELECT r.* FROM chat_rooms r JOIN chat_members m ON m.room_id=r.id AND m.user_id=${user.id} WHERE r.id=${roomId} AND r.kind='group' FOR UPDATE OF r`;
    if (!current || current.owner_id !== user.id)
      fail(403, "Group owner required");
    const members =
      await tx`SELECT user_id FROM chat_members WHERE room_id=${roomId}`;
    if (target) {
      if (target === user.id)
        fail(400, "Use Leave group to transfer ownership and leave");
      if (!members.some((member) => member.user_id === target))
        fail(404, "Group member not found");
      await tx`DELETE FROM chat_members WHERE room_id=${roomId} AND user_id=${target}`;
      await tx`DELETE FROM chat_thread_members tm USING chat_threads t WHERE tm.thread_id=t.id AND t.room_id=${roomId} AND tm.user_id=${target}`;
    } else if (data)
      await tx`UPDATE chat_rooms SET name=${data.name ?? current.name},icon=${data.icon === undefined ? current.icon : data.icon} WHERE id=${roomId}`;
    return members.map((member) => String(member.user_id));
  });
  await publishEvent({
    type: "chat:room:update",
    userIds: memberIds,
    payload: { roomId },
  });
  if (target)
    await publishEvent({
      type: "chat:room:removed",
      userIds: [target],
      payload: { roomId },
    });
  return { ok: true };
}

export async function groupChanged(roomId: string, departed?: string) {
  const members =
    await db`SELECT user_id FROM chat_members WHERE room_id=${roomId}`;
  await publishEvent({
    type: "chat:room:update",
    userIds: members.map((member) => String(member.user_id)),
    payload: { roomId },
  });
  if (departed)
    await publishEvent({
      type: "chat:room:removed",
      userIds: [departed],
      payload: { roomId },
    });
}
