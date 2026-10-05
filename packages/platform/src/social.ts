import { movementKeysSchema } from "../../shared/src/movement";
import { randomBytes } from "node:crypto";
import { publishEvent } from "../../../apps/realtime/src/events";
import { gameById } from "../../../games/catalog";
import {
  validateFile,
  storeFile,
  readFile,
  MAX_FILE_BYTES,
} from "../../storage/src/index";
import { storageUsage } from "./storageQuota";
import { requestStorageCleanup } from "./account";
import {
  assertUploadBindable,
  queueChatAttachmentCleanup,
  removeUncommittedFile,
} from "./storageCleanup";
import {
  groupChanged,
  handleGroupOrganization,
  handleThreadOrganization,
  listThreads,
  notifyThreadSubscribers,
  threadDetails,
  type ChatOrganizationDeps,
} from "./chatOrganization";
import { handleServerEmoji, searchGifs } from "./chatMedia";
import { handleLinkPreview } from "./linkPreview";
import { z } from "zod";
import { db, getUser, mapUser } from "@tell-aviv/database";
import {
  fail,
  levelForXp,
  type ApiHandler,
  type User,
  type Json,
} from "@tell-aviv/shared";

const id = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const media = z
  .string()
  .max(2048)
  .refine(
    (v) =>
      v === "" ||
      /^https:\/\//.test(v) ||
      /^\/api\/files\/[a-zA-Z0-9-]+$/.test(v),
    "Use an HTTPS image URL or a platform file URL",
  )
  .nullable();
const permissions = [
  "view_channel",
  "send_messages",
  "attach_files",
  "embed_links",
  "add_reactions",
  "mention_everyone",
  "manage_messages",
  "manage_channels",
  "manage_roles",
  "manage_server",
  "create_invite",
] as const;
export type SocialPermission = (typeof permissions)[number];
const defaultPermissions: SocialPermission[] = [
  "view_channel",
  "send_messages",
  "attach_files",
  "embed_links",
  "add_reactions",
  "create_invite",
];
const settingsSchema = z
  .object({
    appearance: z.enum(["dark", "light", "system"]).optional(),
    focusMode: z.boolean().optional(),
    accent: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
    presence: z.enum(["online", "idle", "dnd", "invisible"]).optional(),
    privacy: z
      .object({
        showFriends: z.boolean().optional(),
        showActivity: z.boolean().optional(),
        allowFriendRequests: z.boolean().optional(),
        allowDMs: z.enum(["everyone", "friends", "none"]).optional(),
      })
      .optional(),
    notifications: z.record(z.string().max(60), z.boolean()).optional(),
    accessibility: z
      .object({
        reducedMotion: z.boolean().optional(),
        highContrast: z.boolean().optional(),
        fontScale: z.number().min(0.8).max(1.5).optional(),
      })
      .optional(),
    games: z
      .object({
        volume: z.number().min(0).max(1).optional(),
        music: z.boolean().optional(),
        effects: z.boolean().optional(),
        movementKeys: movementKeysSchema.optional(),
      })
      .optional(),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success)
    fail(
      400,
      r.error.issues
        .map((v) => `${v.path.join(".") || "input"}: ${v.message}`)
        .join("; "),
    );
  return r.data;
}
function uuid(value: string) {
  return parse(id, value);
}
export function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}
export function canGrant(
  granted: readonly string[],
  held: readonly string[],
  owner: boolean,
) {
  return owner || granted.every((p) => held.includes(p));
}
export function publicProfile(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    banner: user.banner,
    bio: user.bio,
    status: user.status,
    xp: user.xp,
    level: levelForXp(user.xp),
    role: user.role,
  };
}
async function existsUser(userId: string) {
  const user = await getUser(uuid(userId));
  if (!user) fail(404, "User not found");
  return user;
}
export async function usersBlocked(a: string, b: string) {
  const rows =
    await db`SELECT 1 FROM user_blocks WHERE (user_id=${a} AND blocked_id=${b}) OR (user_id=${b} AND blocked_id=${a})`;
  return rows.length > 0;
}
async function requireInteraction(a: string, b: string) {
  if (a === b) fail(400, "Choose another user");
  await existsUser(b);
  if (await usersBlocked(a, b)) fail(403, "Interaction unavailable");
}
async function friends(a: string, b: string) {
  const [low, high] = canonicalPair(a, b);
  return (
    (
      await db`SELECT 1 FROM friendships WHERE user_low=${low} AND user_high=${high}`
    ).length > 0
  );
}
async function notify(
  userId: string,
  actorId: string,
  kind: string,
  title: string,
  link: string,
) {
  if (userId === actorId) return;
  const target = await getUser(userId);
  const prefs = target?.settings.notifications as
    Record<string, unknown> | undefined;
  if (prefs?.[kind] === false || (await usersBlocked(userId, actorId))) return;
  if (
    (
      await db`SELECT 1 FROM friend_preferences WHERE user_id=${userId} AND friend_id=${actorId} AND muted=true`
    ).length
  )
    return;
  const n = (
    await db`INSERT INTO notifications(user_id,actor_id,kind,title,link) VALUES(${userId},${actorId},${kind},${title},${link}) RETURNING id`
  )[0];
  await publishEvent({
    type: "notification:create",
    userIds: [userId],
    payload: { ...n, kind, title, link },
  });
}
async function rateLimit(
  userId: string,
  bucket: string,
  max: number,
  seconds: number,
) {
  const row = (
    await db`INSERT INTO social_rate_windows(user_id,bucket,window_start,count) VALUES(${userId},${bucket},now(),1) ON CONFLICT(user_id,bucket) DO UPDATE SET window_start=CASE WHEN social_rate_windows.window_start<now()-make_interval(secs=>${seconds}) THEN now() ELSE social_rate_windows.window_start END,count=CASE WHEN social_rate_windows.window_start<now()-make_interval(secs=>${seconds}) THEN 1 ELSE social_rate_windows.count+1 END RETURNING count`
  )[0];
  if (row.count > max) fail(429, "Too many requests. Try again later");
}
async function friendList(userId: string) {
  return db`SELECT u.id,u.username,u.display_name AS "displayName",u.avatar,u.status,u.xp,COALESCE(p.favorite,false) AS favorite,COALESCE(p.close_friend,false) AS "closeFriend",COALESCE(p.muted,false) AS muted,COALESCE(p.nickname,'') AS nickname,COALESCE(p.note,'') AS note FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_low=${userId} THEN f.user_high ELSE f.user_low END LEFT JOIN friend_preferences p ON p.user_id=${userId} AND p.friend_id=u.id WHERE f.user_low=${userId} OR f.user_high=${userId} ORDER BY COALESCE(p.favorite,false) DESC,u.display_name`;
}
async function serverAccess(userId: string, serverId: string) {
  const rows =
    await db`SELECT s.*,(SELECT count(*) FROM server_members sm WHERE sm.server_id=s.id) AS member_count FROM servers s JOIN server_members m ON m.server_id=s.id AND m.user_id=${userId} WHERE s.id=${uuid(serverId)}`;
  if (!rows.length) fail(403, "Server membership required");
  const roles =
    await db`SELECT r.* FROM server_roles r WHERE r.server_id=${serverId} AND (r.is_default OR EXISTS(SELECT 1 FROM server_member_roles mr WHERE mr.role_id=r.id AND mr.user_id=${userId} AND mr.server_id=${serverId}))`;
  const held = new Set<string>();
  for (const r of roles)
    for (const permission of r.permissions as string[]) held.add(permission);
  const owner = rows[0].owner_id === userId;
  if (owner) for (const p of permissions) held.add(p);
  return { server: rows[0], roles, permissions: [...held], owner };
}
async function requireServerPermission(
  userId: string,
  serverId: string,
  permission: SocialPermission,
) {
  const a = await serverAccess(userId, serverId);
  if (!a.permissions.includes(permission))
    fail(403, `Missing permission: ${permission}`);
  return a;
}
/** Every HTTP and socket room operation must call this before accessing room state. */
export async function authorizeRoom(
  userId: string,
  roomId: string,
  permission: SocialPermission = "view_channel",
) {
  const rows =
    roomId === "global"
      ? await db`SELECT * FROM chat_rooms WHERE kind='global'`
      : await db`SELECT * FROM chat_rooms WHERE id=${uuid(roomId)}`;
  const room = rows[0];
  if (!room) fail(404, "Chat room not found");
  if (room.kind === "dm" || room.kind === "group") {
    if (
      !(
        await db`SELECT 1 FROM chat_members WHERE room_id=${room.id} AND user_id=${userId}`
      ).length
    )
      fail(403, "Chat membership required");
    const blocked =
      await db`SELECT 1 FROM chat_members m JOIN user_blocks b ON (b.user_id=${userId} AND b.blocked_id=m.user_id) OR (b.blocked_id=${userId} AND b.user_id=m.user_id) WHERE m.room_id=${room.id} LIMIT 1`;
    if (blocked.length) fail(403, "Direct chat unavailable");
  } else if (room.kind === "channel") {
    const access = await requireServerPermission(
      userId,
      room.server_id,
      permission,
    );
    if (
      room.restricted_role_id &&
      !access.owner &&
      !access.roles.some((r) => r.id === room.restricted_role_id)
    )
      fail(403, "Channel role required");
    if (
      permission === "send_messages" &&
      room.channel_type === "announcement" &&
      !access.permissions.includes("manage_messages")
    )
      fail(403, "Announcement posting requires manage messages");
  } else if (room.kind === "party") {
    if (
      !(
        await db`SELECT 1 FROM party_members WHERE party_id=${room.party_id} AND user_id=${userId}`
      ).length
    )
      fail(403, "Party membership required");
  }
  return room;
}
async function messageAccess(
  userId: string,
  messageId: string,
  permission: SocialPermission = "view_channel",
) {
  const rows =
    await db`SELECT * FROM chat_messages WHERE id=${uuid(messageId)}`;
  if (!rows.length) fail(404, "Message not found");
  await authorizeRoom(userId, rows[0].room_id, permission);
  if (await usersBlocked(userId, rows[0].author_id))
    fail(404, "Message not found");
  return rows[0];
}
async function manageMessage(userId: string, message: Record<string, unknown>) {
  if (message.author_id === userId) return;
  const room = await authorizeRoom(userId, String(message.room_id));
  if (room.kind === "channel") {
    await requireServerPermission(userId, room.server_id, "manage_messages");
    return;
  }
  const user = await getUser(userId);
  if (user?.role === "owner" || user?.role === "admin") return;
  fail(403, "Only the author can change this message");
}
async function threadAccess(userId: string, roomId: string, threadId: string) {
  uuid(threadId);
  const [thread] =
    await db`SELECT * FROM chat_threads WHERE id=${threadId} AND room_id=${roomId}`;
  const rootId = thread ? thread.root_message_id : threadId;
  if (rootId) {
    const root = await messageAccess(userId, rootId);
    if (root.room_id !== roomId || root.thread_id)
      fail(400, "A thread must start from a room message");
    return { id: threadId, rootId: String(rootId) };
  }
  if (!thread) fail(404, "Thread not found");
  return { id: threadId, rootId: null };
}
const organizationDeps: ChatOrganizationDeps = {
  authorizeRoom: async (userId, roomId, permission = "view_channel") => {
    const room = await authorizeRoom(userId, roomId, permission);
    return {
      id: String(room.id),
      kind: String(room.kind),
      owner_id: room.owner_id,
      server_id: room.server_id,
    };
  },
  threadAccess,
  requireServerPermission,
  notify,
};
async function roomMessages(
  userId: string,
  roomId: string,
  url: URL,
  threadId?: string,
) {
  const room = await authorizeRoom(userId, roomId);
  const thread = threadId
    ? await threadAccess(userId, room.id, threadId)
    : undefined;
  const limit = Math.min(
    100,
    Math.max(1, Math.trunc(Number(url.searchParams.get("limit"))) || 50),
  );
  const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
  const pinned = url.searchParams.get("pinned") === "true";
  const scope = threadId
    ? db`m.thread_id=${threadId}`
    : q || pinned
      ? db`TRUE`
      : db`m.thread_id IS NULL`;
  const before = url.searchParams.get("before");
  let cursor: { id: string } | undefined;
  if (before) {
    const rows =
      await db`SELECT m.id FROM chat_messages m WHERE m.id=${uuid(before)} AND m.room_id=${room.id} AND ${scope}`;
    if (!rows.length) fail(400, "Invalid history cursor");
    cursor = rows[0] as { id: string };
  }
  const projection = db`m.id,m.room_id AS "roomId",m.author_id AS "authorId",CASE WHEN m.deleted_at IS NULL THEN m.content ELSE '' END AS content,m.reply_to AS "replyTo",m.thread_id AS "threadId",(SELECT count(*)::int FROM chat_messages reply WHERE reply.thread_id=m.id AND reply.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=${userId} AND b.blocked_id=reply.author_id) OR (b.blocked_id=${userId} AND b.user_id=reply.author_id))) AS "threadReplyCount",m.created_at AS "createdAt",m.edited_at AS "editedAt",m.deleted_at AS "deletedAt",u.username,u.display_name AS "displayName",u.avatar,EXISTS(SELECT 1 FROM chat_pins p WHERE p.message_id=m.id) AS pinned,COALESCE((SELECT jsonb_agg(jsonb_build_object('emoji',r.emoji,'userId',r.user_id)) FROM chat_reactions r WHERE r.message_id=m.id AND m.deleted_at IS NULL),'[]'::jsonb) AS reactions,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename,'mime',a.mime,'bytes',a.bytes)) FROM chat_attachments a WHERE a.message_id=m.id AND m.deleted_at IS NULL),'[]'::jsonb) AS attachments,(SELECT jsonb_build_object('id',p.id,'question',p.question,'multiple',p.multiple,'closesAt',p.closes_at,'options',(SELECT jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'votes',(SELECT count(*) FROM chat_poll_votes v WHERE v.option_id=o.id),'voted',EXISTS(SELECT 1 FROM chat_poll_votes v WHERE v.option_id=o.id AND v.user_id=${userId})) ORDER BY o.position) FROM chat_poll_options o WHERE o.poll_id=p.id)) FROM chat_polls p WHERE p.message_id=m.id AND m.deleted_at IS NULL) AS poll`;
  const visible = db`NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=${userId} AND b.blocked_id=m.author_id) OR (b.blocked_id=${userId} AND b.user_id=m.author_id))`;
  const rows =
    await db`SELECT ${projection} FROM chat_messages m JOIN users u ON u.id=m.author_id WHERE m.room_id=${room.id} AND ${scope} AND (${!cursor} OR (m.created_at,m.id)<(SELECT c.created_at,c.id FROM chat_messages c WHERE c.id=${cursor?.id || room.id}::uuid)) AND (${!q} OR (m.deleted_at IS NULL AND to_tsvector('simple',m.content) @@ plainto_tsquery('simple',${q}))) AND (${!pinned} OR EXISTS(SELECT 1 FROM chat_pins p WHERE p.message_id=m.id)) AND ${visible} ORDER BY m.created_at DESC,m.id DESC LIMIT ${limit}`;
  const root = thread?.rootId
    ? (
        await db`SELECT ${projection} FROM chat_messages m JOIN users u ON u.id=m.author_id WHERE m.id=${thread.rootId} AND m.room_id=${room.id} AND ${visible}`
      )[0] || null
    : null;
  const viewer = thread ? await getUser(userId) : undefined;
  const metadata =
    thread && viewer
      ? await threadDetails(
          viewer,
          {
            id: String(room.id),
            kind: String(room.kind),
            owner_id: room.owner_id,
            server_id: room.server_id,
          },
          thread.id,
          organizationDeps,
        )
      : undefined;
  return {
    room: roomDescriptor(room),
    messages: rows.reverse(),
    nextCursor: rows.length === limit ? rows[0]?.id : null,
    ...(thread ? { thread: { id: thread.id, root, ...metadata } } : {}),
  };
}
function roomDescriptor(room: Record<string, unknown>) {
  return {
    id: room.id,
    kind: room.kind,
    name: room.name,
    serverId: room.server_id,
    partyId: room.party_id,
    channelType: room.channel_type,
    restrictedRoleId: room.restricted_role_id,
    ownerId: room.owner_id,
    icon: room.icon,
  };
}
async function partyState(userId: string, partyId?: string) {
  const rows = partyId
    ? await db`SELECT p.* FROM parties p JOIN party_members m ON m.party_id=p.id AND m.user_id=${userId} WHERE p.id=${uuid(partyId)}`
    : await db`SELECT p.* FROM parties p JOIN party_members m ON m.party_id=p.id WHERE m.user_id=${userId}`;
  if (!rows.length) return null;
  const p = rows[0];
  const members =
    await db`SELECT u.id,u.username,u.display_name AS "displayName",u.avatar,m.ready,m.joined_at AS "joinedAt" FROM party_members m JOIN users u ON u.id=m.user_id WHERE m.party_id=${p.id} ORDER BY m.joined_at`;
  const rooms = await db`SELECT id FROM chat_rooms WHERE party_id=${p.id}`;
  return {
    id: p.id,
    leaderId: p.leader_id,
    gameId: p.game_id,
    launchedAt: p.launched_at,
    roomId: rooms[0]?.id,
    members,
  };
}
async function requirePartyLeader(userId: string, partyId: string) {
  const p = await partyState(userId, partyId);
  if (!p) fail(403, "Party membership required");
  if (p.leaderId !== userId) fail(403, "Party leader required");
  return p;
}

export const handleSocial: ApiHandler = async (
  path,
  method,
  context,
  input,
) => {
  const [root, key, action] = path;
  const user = context.user;
  const userId = user.id;
  const url = new URL(context.request.url);
  if (root === "profile" && method === "POST") {
    const data = parse(
      z
        .object({
          displayName: text(60).optional(),
          bio: z.string().max(1000).optional(),
          status: z.string().max(120).optional(),
          avatar: media.optional(),
          banner: media.optional(),
          settings: settingsSchema.optional(),
        })
        .strict(),
      input,
    );
    const updated = await db.begin(async (tx) => {
      const [row] =
        await tx`SELECT * FROM users WHERE id=${userId} AND disabled=false FOR UPDATE`;
      if (!row) fail(401, "Session unavailable");
      const current = mapUser(row);
      const merged: User["settings"] = {
        ...current.settings,
        ...(data.settings as User["settings"] | undefined),
      };
      for (const category of [
        "privacy",
        "notifications",
        "accessibility",
        "games",
      ] as const)
        if (data.settings?.[category])
          merged[category] = {
            ...((current.settings[category] || {}) as Record<string, Json>),
            ...data.settings[category],
          };
      const [result] =
        await tx`UPDATE users SET display_name=${data.displayName ?? current.displayName},bio=${data.bio ?? current.bio},status=${data.status ?? current.status},avatar=${data.avatar === undefined ? current.avatar : data.avatar || null},banner=${data.banner === undefined ? current.banner : data.banner || null},settings=${tx.json(merged)},updated_at=now() WHERE id=${userId} RETURNING *`;
      return mapUser(result);
    });
    if (data.settings?.presence !== undefined || data.settings?.privacy)
      await publishEvent({
        type: "presence:changed",
        userIds: [userId],
        payload: { userId },
      });
    return updated;
  }
  if (root === "users" && method === "GET") {
    if (!key) {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
      if (!q) return [];
      return db`SELECT id,username,display_name AS "displayName",avatar,status,xp FROM users u WHERE disabled=false AND (username ILIKE ${"%" + q + "%"} OR display_name ILIKE ${"%" + q + "%"}) AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=${userId} AND b.blocked_id=u.id) OR (b.blocked_id=${userId} AND b.user_id=u.id)) ORDER BY username LIMIT 30`;
    }
    const target = await existsUser(key);
    if (await usersBlocked(userId, target.id)) fail(404, "User not found");
    const privacy = target.settings.privacy as
      Record<string, unknown> | undefined;
    const friendIds =
      privacy?.showFriends === false && target.id !== userId
        ? []
        : await db`SELECT u.id,u.username,u.display_name AS "displayName",u.avatar FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_low=${target.id} THEN f.user_high ELSE f.user_low END WHERE (f.user_low=${target.id} OR f.user_high=${target.id}) AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=${userId} AND b.blocked_id=u.id) OR (b.blocked_id=${userId} AND b.user_id=u.id)) LIMIT 50`;
    return {
      ...publicProfile(target),
      friends: friendIds,
      isFriend: await friends(userId, target.id),
      activity:
        (privacy?.showActivity === false ||
          target.settings.presence === "invisible") &&
        target.id !== userId
          ? []
          : await db`SELECT id,kind,title,link,created_at AS "createdAt" FROM social_activity WHERE user_id=${target.id} ORDER BY created_at DESC LIMIT 20`,
    };
  }
  if (root === "home" && method === "GET")
    return {
      friends: await friendList(userId),
      notifications:
        await db`SELECT id,kind,title,link,read_at AS "readAt",created_at AS "createdAt" FROM notifications WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 10`,
      activity:
        await db`SELECT a.id,a.kind,a.title,a.link,a.created_at AS "createdAt",u.username,u.display_name AS "displayName",u.avatar FROM social_activity a JOIN users u ON u.id=a.user_id WHERE (a.user_id=${userId} OR EXISTS(SELECT 1 FROM friendships f WHERE (f.user_low=${userId} AND f.user_high=a.user_id) OR (f.user_high=${userId} AND f.user_low=a.user_id))) AND (a.user_id=${userId} OR (COALESCE((u.settings->'privacy'->>'showActivity')::boolean,true) AND COALESCE(u.settings->>'presence','online')<>'invisible')) AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=${userId} AND b.blocked_id=a.user_id) OR (b.blocked_id=${userId} AND b.user_id=a.user_id)) ORDER BY a.created_at DESC LIMIT 30`,
    };
  if (root === "friends") return handleFriends(path, method, user, input);
  if (root === "chat")
    return handleChat(path, method, user, input, url, context.request);
  if (root === "servers" || root === "invites")
    return handleServers(path, method, user, input, url, context.request);
  if (root === "parties") return handleParties(path, method, user, input);
  if (root === "notifications") {
    if (method === "GET" && !key)
      return db`SELECT n.id,n.kind,n.title,n.link,n.read_at AS "readAt",n.created_at AS "createdAt",u.display_name AS "actorName",u.avatar FROM notifications n LEFT JOIN users u ON u.id=n.actor_id WHERE n.user_id=${userId} ORDER BY n.created_at DESC LIMIT 100`;
    if (method === "POST" && key === "read-all") {
      await db`UPDATE notifications SET read_at=now() WHERE user_id=${userId} AND read_at IS NULL`;
      return { ok: true };
    }
    if (method === "POST" && key && action === "read") {
      const r =
        await db`UPDATE notifications SET read_at=now() WHERE id=${uuid(key)} AND user_id=${userId} RETURNING id`;
      if (!r.length) fail(404, "Notification not found");
      return { ok: true };
    }
  }
  return undefined;
};

async function handleFriends(
  path: string[],
  method: string,
  user: User,
  input: Record<string, unknown>,
) {
  const [, key, action] = path;
  const userId = user.id;
  if (method === "GET" && !key)
    return {
      friends: await friendList(userId),
      incoming:
        await db`SELECT r.id,r.sender_id AS "userId",r.created_at AS "createdAt",u.username,u.display_name AS "displayName",u.avatar FROM friend_requests r JOIN users u ON u.id=r.sender_id WHERE r.recipient_id=${userId} ORDER BY r.created_at DESC`,
      outgoing:
        await db`SELECT r.id,r.recipient_id AS "userId",r.created_at AS "createdAt",u.username,u.display_name AS "displayName",u.avatar FROM friend_requests r JOIN users u ON u.id=r.recipient_id WHERE r.sender_id=${userId} ORDER BY r.created_at DESC`,
      blocked:
        await db`SELECT u.id,u.username,u.display_name AS "displayName",u.avatar FROM user_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=${userId}`,
    };
  if (method === "GET" && key === "suggested")
    return db`SELECT u.id,u.username,u.display_name AS "displayName",u.avatar,count(*)::int AS "mutualFriends" FROM friendships f1 JOIN friendships f2 ON (CASE WHEN f1.user_low=${userId} THEN f1.user_high ELSE f1.user_low END) IN (f2.user_low,f2.user_high) JOIN users u ON u.id=CASE WHEN f2.user_low IN (f1.user_low,f1.user_high) AND f2.user_low<>${userId} THEN f2.user_high ELSE f2.user_low END WHERE (f1.user_low=${userId} OR f1.user_high=${userId}) AND u.id<>${userId} AND NOT EXISTS(SELECT 1 FROM friendships f WHERE (f.user_low=${userId} AND f.user_high=u.id) OR (f.user_high=${userId} AND f.user_low=u.id)) AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=${userId} AND b.blocked_id=u.id) OR (b.blocked_id=${userId} AND b.user_id=u.id)) GROUP BY u.id ORDER BY count(*) DESC LIMIT 20`;
  if (method === "POST" && key === "request") {
    const { userId: target } = parse(z.object({ userId: id }).strict(), input);
    await rateLimit(userId, "friend_request", 20, 3600);
    await requireInteraction(userId, target);
    const targetUser = await existsUser(target);
    if (
      (targetUser.settings.privacy as Record<string, unknown> | undefined)
        ?.allowFriendRequests === false
    )
      fail(403, "This user is not accepting friend requests");
    const [low, high] = canonicalPair(userId, target);
    const result = await db.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${low + high},0))`;
      if (
        (
          await tx`SELECT 1 FROM user_blocks WHERE (user_id=${userId} AND blocked_id=${target}) OR (user_id=${target} AND blocked_id=${userId})`
        ).length
      )
        fail(403, "Interaction unavailable");
      if (
        (
          await tx`SELECT 1 FROM friendships WHERE user_low=${low} AND user_high=${high}`
        ).length
      )
        fail(409, "Already friends");
      if (
        (
          await tx`SELECT 1 FROM friend_requests WHERE (sender_id=${userId} AND recipient_id=${target}) OR (sender_id=${target} AND recipient_id=${userId})`
        ).length
      )
        fail(409, "A friend request already exists");
      return (
        await tx`INSERT INTO friend_requests(sender_id,recipient_id) VALUES(${userId},${target}) RETURNING id`
      )[0];
    });
    await notify(
      target,
      userId,
      "friend_request",
      `${user.displayName} sent you a friend request`,
      "/friends",
    );
    await publishEvent({
      type: "friend:request",
      userIds: [target, userId],
      payload: { senderId: userId, recipientId: target },
    });
    return result;
  }
  if (method === "POST" && key && action) {
    const target = uuid(key);
    if (target === userId) fail(400, "Choose another user");
    const [low, high] = canonicalPair(userId, target);
    if (
      ["accept", "decline", "cancel", "remove", "block", "unblock"].includes(
        action,
      )
    ) {
      await existsUser(target);
      await db.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${low + high},0))`;
        if (action === "accept") {
          if (
            (
              await tx`SELECT 1 FROM user_blocks WHERE (user_id=${userId} AND blocked_id=${target}) OR (user_id=${target} AND blocked_id=${userId})`
            ).length
          )
            fail(403, "Interaction unavailable");
          const req =
            await tx`DELETE FROM friend_requests WHERE sender_id=${target} AND recipient_id=${userId} RETURNING id`;
          if (!req.length) fail(404, "Friend request not found");
          await tx`INSERT INTO friendships(user_low,user_high) VALUES(${low},${high}) ON CONFLICT DO NOTHING`;
          await tx`DELETE FROM friend_requests WHERE sender_id=${userId} AND recipient_id=${target}`;
        } else if (action === "decline") {
          const r =
            await tx`DELETE FROM friend_requests WHERE sender_id=${target} AND recipient_id=${userId} RETURNING id`;
          if (!r.length) fail(404, "Friend request not found");
        } else if (action === "cancel") {
          const r =
            await tx`DELETE FROM friend_requests WHERE sender_id=${userId} AND recipient_id=${target} RETURNING id`;
          if (!r.length) fail(404, "Friend request not found");
        } else if (action === "remove")
          await tx`DELETE FROM friendships WHERE user_low=${low} AND user_high=${high}`;
        else if (action === "block") {
          await tx`INSERT INTO user_blocks(user_id,blocked_id) VALUES(${userId},${target}) ON CONFLICT DO NOTHING`;
          await tx`DELETE FROM friendships WHERE user_low=${low} AND user_high=${high}`;
          await tx`DELETE FROM friend_requests WHERE (sender_id=${userId} AND recipient_id=${target}) OR (sender_id=${target} AND recipient_id=${userId})`;
          await tx`DELETE FROM party_invites WHERE (user_id=${userId} AND inviter_id=${target}) OR (user_id=${target} AND inviter_id=${userId})`;
        } else
          await tx`DELETE FROM user_blocks WHERE user_id=${userId} AND blocked_id=${target}`;
      });
      if (action === "accept")
        await notify(
          target,
          userId,
          "friend_accepted",
          `${user.displayName} accepted your friend request`,
          "/friends",
        );
      await publishEvent({
        type: "friend:update",
        userIds: [target, userId],
        payload: { action, userId, targetId: target },
      });
      return { ok: true };
    }
    if (action === "mute" || action === "preferences") {
      await existsUser(target);
      if (action === "preferences" && !(await friends(userId, target)))
        fail(403, "Friendship required");
      const data =
        action === "mute"
          ? parse(z.object({ muted: z.boolean() }).strict(), input)
          : parse(
              z
                .object({
                  favorite: z.boolean().optional(),
                  closeFriend: z.boolean().optional(),
                  muted: z.boolean().optional(),
                  nickname: z.string().max(80).optional(),
                  note: z.string().max(2000).optional(),
                })
                .strict(),
              input,
            );
      const current = (
        await db`SELECT * FROM friend_preferences WHERE user_id=${userId} AND friend_id=${target}`
      )[0];
      const d = data as {
        favorite?: boolean;
        closeFriend?: boolean;
        muted?: boolean;
        nickname?: string;
        note?: string;
      };
      await db`INSERT INTO friend_preferences(user_id,friend_id,favorite,close_friend,muted,nickname,note) VALUES(${userId},${target},${d.favorite ?? current?.favorite ?? false},${d.closeFriend ?? current?.close_friend ?? false},${d.muted ?? current?.muted ?? false},${d.nickname ?? current?.nickname ?? ""},${d.note ?? current?.note ?? ""}) ON CONFLICT(user_id,friend_id) DO UPDATE SET favorite=EXCLUDED.favorite,close_friend=EXCLUDED.close_friend,muted=EXCLUDED.muted,nickname=EXCLUDED.nickname,note=EXCLUDED.note`;
      return { ok: true };
    }
  }
  return undefined;
}

async function handleChat(
  path: string[],
  method: string,
  user: User,
  input: Record<string, unknown>,
  url: URL,
  request: Request,
) {
  const [, key, action, extra] = path;
  const userId = user.id;
  const preview = await handleLinkPreview(path, method, user, input, {
    readMessage: async (actorId, roomId, messageId) => {
      if (
        !(await db`SELECT id FROM users WHERE id=${actorId} AND disabled=false`)
          .length
      )
        fail(401, "Sign in to Tell Aviv");
      await authorizeRoom(actorId, roomId, "view_channel");
      await authorizeRoom(actorId, roomId, "embed_links");
      const message = await messageAccess(actorId, messageId);
      if (message.deleted_at || message.room_id !== roomId)
        fail(404, "Message not found");
      return String(message.content);
    },
  });
  if (preview !== undefined) return preview;
  const organized = await handleThreadOrganization(
    path,
    method,
    user,
    input,
    organizationDeps,
  );
  if (organized !== undefined) return organized;
  const groupUpdate = await handleGroupOrganization(path, method, user, input);
  if (groupUpdate !== undefined) return groupUpdate;
  if (key === "gifs" && !action && method === "GET") {
    await rateLimit(userId, "gif_search", 30, 60);
    return searchGifs(url);
  }
  if (action === "files" && key && method === "POST")
    return uploadChatFile(userId, key, request);
  if (key === "files" && action && method === "DELETE")
    return removeChatFile(userId, action);
  if (key === "files" && action && method === "GET")
    return downloadChatFile(userId, action);
  if (key === "global" && method === "GET" && !action)
    return roomDescriptor(await authorizeRoom(userId, "global"));
  if (key && action === "threads" && extra && method === "GET")
    return roomMessages(userId, key, url, extra);
  if (key && action === "threads" && !extra && method === "GET") {
    const room = await authorizeRoom(userId, key);
    const page = await listThreads(
      userId,
      { id: String(room.id), kind: String(room.kind) },
      url,
    );
    return url.searchParams.get("page") === "true" ? page : page.threads;
  }
  if (key === "rooms") {
    if (method === "GET")
      return db`SELECT r.id,r.kind,r.name,r.icon,r.owner_id AS "ownerId",r.created_at AS "createdAt",(SELECT jsonb_agg(jsonb_build_object('id',u.id,'username',u.username,'displayName',u.display_name,'avatar',u.avatar)) FROM chat_members m JOIN users u ON u.id=m.user_id WHERE m.room_id=r.id) AS members,(SELECT content FROM chat_messages WHERE room_id=r.id AND deleted_at IS NULL AND thread_id IS NULL ORDER BY created_at DESC LIMIT 1) AS "lastMessage",(SELECT count(*)::int FROM chat_messages cm WHERE cm.room_id=r.id AND cm.thread_id IS NULL AND cm.deleted_at IS NULL AND cm.author_id<>${userId} AND cm.created_at>COALESCE((SELECT read_at FROM chat_read_cursors WHERE room_id=r.id AND user_id=${userId}),'epoch'::timestamptz)) AS unread FROM chat_rooms r JOIN chat_members m ON m.room_id=r.id AND m.user_id=${userId} WHERE r.kind IN ('dm','group') AND NOT EXISTS(SELECT 1 FROM chat_members cm JOIN user_blocks b ON (b.user_id=${userId} AND b.blocked_id=cm.user_id) OR (b.blocked_id=${userId} AND b.user_id=cm.user_id) WHERE cm.room_id=r.id) ORDER BY r.created_at DESC`;
    if (method === "POST") {
      const { userIds, name } = parse(
        z
          .object({
            userIds: z.array(id).min(1).max(7),
            name: z.string().trim().max(100).optional(),
          })
          .strict(),
        input,
      );
      await rateLimit(userId, "create_dm", 30, 3600);
      const members = [...new Set([userId, ...userIds])];
      if (members.length < 2) fail(400, "Choose another user");
      for (const target of members)
        if (target !== userId) {
          await requireInteraction(userId, target);
          const t = await existsUser(target);
          const dms = (
            t.settings.privacy as Record<string, unknown> | undefined
          )?.allowDMs;
          if (
            dms === "none" ||
            (dms === "friends" && !(await friends(userId, target)))
          )
            fail(403, "This user restricts direct messages");
        }
      for (let i = 0; i < members.length; i++)
        for (let j = i + 1; j < members.length; j++)
          if (await usersBlocked(members[i], members[j]))
            fail(403, "Direct chat unavailable");
      return db.begin(async (tx) => {
        const kind = members.length === 2 ? "dm" : "group";
        const dmKey =
          kind === "dm"
            ? canonicalPair(members[0], members[1]).join(":")
            : null;
        let room;
        if (dmKey) {
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${dmKey},0))`;
          room = (await tx`SELECT * FROM chat_rooms WHERE dm_key=${dmKey}`)[0];
        }
        if (!room) {
          room = (
            await tx`INSERT INTO chat_rooms(kind,name,owner_id,dm_key) VALUES(${kind},${name || ""},${userId},${dmKey}) RETURNING *`
          )[0];
          for (const member of members)
            await tx`INSERT INTO chat_members(room_id,user_id) VALUES(${room.id},${member})`;
        }
        return roomDescriptor(room);
      });
    }
  }
  if (key && action === "messages") {
    if (method === "GET") return roomMessages(userId, key, url);
    if (method === "POST") {
      const room = await authorizeRoom(userId, key, "send_messages");
      const data = parse(
        z
          .object({
            content: z.string().trim().max(4000).default(""),
            replyTo: id.optional(),
            threadId: id.optional(),
            attachmentIds: z.array(id).max(10).default([]),
            poll: z
              .object({
                question: text(300),
                options: z.array(text(200)).min(2).max(10),
                multiple: z.boolean().default(false),
                closesAt: z.string().datetime().optional(),
              })
              .optional(),
          })
          .strict(),
        input,
      );
      if (!data.content && !data.poll && !data.attachmentIds.length)
        fail(400, "Message cannot be empty");
      if (data.attachmentIds.length)
        await authorizeRoom(userId, room.id, "attach_files");
      if (data.replyTo) {
        const reply = await messageAccess(userId, data.replyTo);
        if (
          reply.room_id !== room.id ||
          reply.deleted_at ||
          (data.threadId
            ? reply.thread_id !== data.threadId && reply.id !== data.threadId
            : !!reply.thread_id)
        )
          fail(400, "Reply must reference an existing message in this chat");
      }
      const thread = data.threadId
        ? await threadAccess(userId, room.id, data.threadId)
        : undefined;
      if (room.kind === "channel" && /@(everyone|here)\b/.test(data.content))
        await requireServerPermission(
          userId,
          room.server_id,
          "mention_everyone",
        );
      const message = await db.begin(async (tx) => {
        // Per-author database lock keeps the durable flood limit correct across web instances.
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"chat:" + userId},0))`;
        // Membership removal and message creation share the room lock, so a
        // request authorized before removal cannot commit afterward as a member.
        const [currentRoom] =
          await tx`SELECT id FROM chat_rooms WHERE id=${room.id} FOR SHARE`;
        if (!currentRoom) fail(404, "Chat room not found");
        if (
          ["dm", "group"].includes(room.kind) &&
          !(
            await tx`SELECT user_id FROM chat_members WHERE room_id=${room.id} AND user_id=${userId}`
          ).length
        )
          fail(403, "Chat membership required");
        const recent =
          await tx`SELECT count(*)::int AS count FROM chat_messages WHERE author_id=${userId} AND created_at>now()-interval '10 seconds'`;
        if (recent[0].count >= 10)
          fail(429, "Slow down before sending more messages");
        if (thread) {
          // Lock the root while creating its thread, preventing a concurrent
          // account removal from leaving a dangling root reference.
          if (thread.rootId) {
            const [root] =
              await tx`SELECT id,author_id FROM chat_messages WHERE id=${thread.rootId} AND room_id=${room.id} AND thread_id IS NULL FOR KEY SHARE`;
            if (!root) fail(409, "Thread root changed. Reopen this thread");
          }
          await tx`INSERT INTO chat_threads(id,room_id,root_message_id,created_by) VALUES(${thread.id},${room.id},${thread.rootId},(SELECT author_id FROM chat_messages WHERE id=${thread.rootId})) ON CONFLICT(id) DO NOTHING`;
          const [currentThread] =
            await tx`SELECT archived_at,created_by FROM chat_threads WHERE id=${thread.id} AND room_id=${room.id} FOR UPDATE`;
          if (!currentThread) fail(409, "Thread changed. Reopen it.");
          if (currentThread.archived_at)
            fail(409, "This thread is archived. A moderator can reopen it.");
          if (currentThread.created_by)
            await tx`INSERT INTO chat_thread_members(thread_id,user_id) VALUES(${thread.id},${currentThread.created_by}) ON CONFLICT DO NOTHING`;
          await tx`INSERT INTO chat_thread_members(thread_id,user_id,following) VALUES(${thread.id},${userId},(SELECT count(*)<1000 FROM chat_thread_members WHERE thread_id=${thread.id} AND following=true)) ON CONFLICT DO NOTHING`;
        }
        const m = (
          await tx`INSERT INTO chat_messages(room_id,author_id,content,reply_to,thread_id) VALUES(${room.id},${userId},${data.content || data.poll?.question || ""},${data.replyTo || null},${thread?.id || null}) RETURNING id,room_id AS "roomId",author_id AS "authorId",content,reply_to AS "replyTo",thread_id AS "threadId",created_at AS "createdAt"`
        )[0];
        if (thread)
          await tx`UPDATE chat_threads SET updated_at=(SELECT created_at FROM chat_messages WHERE id=${m.id}) WHERE id=${thread.id}`;
        for (const attachmentId of [...new Set(data.attachmentIds)]) {
          const attached =
            await tx`UPDATE chat_attachments SET message_id=${m.id} WHERE id=${attachmentId} AND owner_id=${userId} AND room_id=${room.id} AND message_id IS NULL RETURNING id`;
          if (!attached.length)
            fail(400, "Attachment must be your unused upload in this chat");
        }
        if (data.poll) {
          if (data.poll.closesAt && new Date(data.poll.closesAt) <= new Date())
            fail(400, "Poll closing time must be in the future");
          const p = (
            await tx`INSERT INTO chat_polls(message_id,question,multiple,closes_at) VALUES(${m.id},${data.poll.question},${data.poll.multiple},${data.poll.closesAt || null}) RETURNING id`
          )[0];
          for (let i = 0; i < data.poll.options.length; i++)
            await tx`INSERT INTO chat_poll_options(poll_id,label,position) VALUES(${p.id},${data.poll.options[i]},${i})`;
        }
        return m;
      });
      if (thread)
        await notifyThreadSubscribers(
          user,
          {
            id: String(room.id),
            kind: String(room.kind),
            owner_id: room.owner_id,
            server_id: room.server_id,
          },
          thread.id,
          organizationDeps,
        );
      if (!thread && (room.kind === "dm" || room.kind === "group")) {
        const targets =
          await db`SELECT user_id FROM chat_members WHERE room_id=${room.id} AND user_id<>${userId}`;
        for (const t of targets)
          await notify(
            t.user_id,
            userId,
            "dm",
            `${user.displayName} sent a message`,
            "/chat",
          );
      }
      if (data.replyTo) {
        const replied =
          await db`SELECT author_id FROM chat_messages WHERE id=${data.replyTo}`;
        if (replied[0])
          await notify(
            replied[0].author_id,
            userId,
            "reply",
            `${user.displayName} replied to your message`,
            "/chat",
          );
      }
      // Individual mentions notify only people who can currently read this room.
      const mentions = [
        ...new Set(
          [
            ...data.content.matchAll(
              /(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{3,24})\b/g,
            ),
          ].map((match) => match[1].toLowerCase()),
        ),
      ].slice(0, 20);
      for (const mentioned of mentions) {
        const target = (
          await db`SELECT id FROM users WHERE lower(username)=${mentioned} AND disabled=false`
        )[0];
        if (!target || target.id === userId) continue;
        try {
          await authorizeRoom(target.id, room.id);
        } catch {
          continue;
        }
        await notify(
          target.id,
          userId,
          "mention",
          `${user.displayName} mentioned you`,
          "/chat",
        );
      }
      const payload = {
        ...message,
        displayName: user.displayName,
        username: user.username,
        avatar: user.avatar,
        reactions: [],
        pinned: false,
        attachments:
          await db`SELECT id,filename,mime,bytes FROM chat_attachments WHERE message_id=${message.id}`,
      };
      await publishEvent({
        type: "chat:message:create",
        roomId: room.id,
        payload,
      });
      return payload;
    }
  }
  if (key && action === "read" && method === "POST") {
    const room = await authorizeRoom(userId, key);
    const data = parse(z.object({ messageId: id.optional() }).strict(), input);
    if (
      data.messageId &&
      !(
        await db`SELECT 1 FROM chat_messages WHERE id=${data.messageId} AND room_id=${room.id}`
      ).length
    )
      fail(400, "Read message must belong to this chat");
    await db`INSERT INTO chat_read_cursors(room_id,user_id,message_id,read_at) VALUES(${room.id},${userId},${data.messageId || null},COALESCE((SELECT created_at FROM chat_messages WHERE id=${data.messageId || null}),now())) ON CONFLICT(room_id,user_id) DO UPDATE SET message_id=CASE WHEN EXCLUDED.read_at>=chat_read_cursors.read_at THEN EXCLUDED.message_id ELSE chat_read_cursors.message_id END,read_at=GREATEST(chat_read_cursors.read_at,EXCLUDED.read_at)`;
    return { ok: true };
  }
  if (key && action === "members" && method === "POST") {
    const room = await authorizeRoom(userId, key);
    if (room.kind !== "group" || room.owner_id !== userId)
      fail(403, "Group owner required");
    const { userId: target } = parse(z.object({ userId: id }).strict(), input);
    await requireInteraction(userId, target);
    const t = await existsUser(target);
    const dms = (t.settings.privacy as Record<string, unknown> | undefined)
      ?.allowDMs;
    if (
      dms === "none" ||
      (dms === "friends" && !(await friends(userId, target)))
    )
      fail(403, "This user restricts direct messages");
    await db.begin(async (tx) => {
      const [current] =
        await tx`SELECT owner_id FROM chat_rooms WHERE id=${room.id} FOR UPDATE`;
      if (!current || current.owner_id !== userId)
        fail(403, "Group owner required");
      if (
        !(await tx`SELECT id FROM users WHERE id=${target} AND disabled=false`)
          .length
      )
        fail(404, "User not available");
      const members =
        await tx`SELECT user_id FROM chat_members WHERE room_id=${room.id}`;
      if (members.some((member) => member.user_id === target)) return;
      if (members.length >= 8) fail(409, "Group is full");
      for (const m of members)
        if (
          (
            await tx`SELECT 1 FROM user_blocks WHERE (user_id=${m.user_id} AND blocked_id=${target}) OR (user_id=${target} AND blocked_id=${m.user_id})`
          ).length
        )
          fail(403, "Direct chat unavailable");
      await tx`INSERT INTO chat_members(room_id,user_id) VALUES(${room.id},${target}) ON CONFLICT DO NOTHING`;
    });
    await groupChanged(String(room.id));
    return { ok: true };
  }
  if (key && action === "leave" && method === "POST") {
    const room = (
      await db`SELECT r.* FROM chat_rooms r JOIN chat_members m ON m.room_id=r.id AND m.user_id=${userId} WHERE r.id=${uuid(key)} AND r.kind='group'`
    )[0];
    if (!room) fail(403, "Group membership required");
    await db.begin(async (tx) => {
      const [current] =
        await tx`SELECT owner_id FROM chat_rooms WHERE id=${room.id} FOR UPDATE`;
      if (!current) fail(404, "Group not found");
      await tx`DELETE FROM chat_members WHERE room_id=${room.id} AND user_id=${userId}`;
      await tx`DELETE FROM chat_thread_members tm USING chat_threads t WHERE tm.thread_id=t.id AND t.room_id=${room.id} AND tm.user_id=${userId}`;
      const next =
        await tx`SELECT user_id FROM chat_members WHERE room_id=${room.id} ORDER BY joined_at,user_id LIMIT 1`;
      if (!next.length) {
        await queueChatAttachmentCleanup(tx, { kind: "room", id: room.id });
        await tx`DELETE FROM chat_rooms WHERE id=${room.id}`;
      } else if (current.owner_id === userId)
        await tx`UPDATE chat_rooms SET owner_id=${next[0].user_id} WHERE id=${room.id}`;
    });
    await groupChanged(String(room.id), userId);
    requestStorageCleanup();
    return { ok: true };
  }
  if (key === "messages" && action) {
    const message = await messageAccess(
      userId,
      action,
      extra === "reactions" ? "add_reactions" : "view_channel",
    );
    if (!extra && (method === "PATCH" || method === "POST")) {
      if (message.author_id !== userId)
        fail(403, "Only the author can edit this message");
      if (message.deleted_at) fail(409, "Message was deleted");
      const data = parse(z.object({ content: text(4000) }).strict(), input);
      const room = await authorizeRoom(userId, message.room_id);
      if (room.kind === "channel" && /@(everyone|here)\b/.test(data.content))
        await requireServerPermission(
          userId,
          room.server_id,
          "mention_everyone",
        );
      const edited =
        await db`UPDATE chat_messages SET content=${data.content},edited_at=now() WHERE id=${message.id} AND deleted_at IS NULL RETURNING id`;
      if (!edited.length) fail(409, "Message was deleted");
      await publishEvent({
        type: "chat:message:update",
        roomId: message.room_id,
        payload: {
          id: message.id,
          authorId: message.author_id,
          content: data.content,
        },
      });
      return { ok: true };
    }
    if (!extra && method === "DELETE") {
      await manageMessage(userId, message);
      await db.begin(async (tx) => {
        await queueChatAttachmentCleanup(tx, {
          kind: "message",
          id: message.id,
        });
        await tx`UPDATE chat_messages SET content='',deleted_at=coalesce(deleted_at,now()) WHERE id=${message.id}`;
        await tx`DELETE FROM chat_attachments WHERE message_id=${message.id}`;
        await tx`DELETE FROM chat_reactions WHERE message_id=${message.id}`;
        await tx`DELETE FROM chat_pins WHERE message_id=${message.id}`;
        await tx`DELETE FROM chat_polls WHERE message_id=${message.id}`;
      });
      await publishEvent({
        type: "chat:message:delete",
        roomId: message.room_id,
        payload: { id: message.id, authorId: message.author_id },
      });
      requestStorageCleanup();
      return { ok: true };
    }
    if (extra === "reactions" && (method === "POST" || method === "DELETE")) {
      if (message.deleted_at) fail(409, "Message was deleted");
      const { emoji } = parse(z.object({ emoji: text(40) }).strict(), input);
      if (method === "POST")
        await db`INSERT INTO chat_reactions(message_id,user_id,emoji) VALUES(${message.id},${userId},${emoji}) ON CONFLICT DO NOTHING`;
      else
        await db`DELETE FROM chat_reactions WHERE message_id=${message.id} AND user_id=${userId} AND emoji=${emoji}`;
      await publishEvent({
        type: "chat:reaction:update",
        roomId: message.room_id,
        payload: {
          messageId: message.id,
          authorId: message.author_id,
          emoji,
          userId,
          added: method === "POST",
        },
      });
      return { ok: true };
    }
    if (extra === "pin" && (method === "POST" || method === "DELETE")) {
      const room = await authorizeRoom(userId, message.room_id);
      if (room.kind === "channel")
        await requireServerPermission(
          userId,
          room.server_id,
          "manage_messages",
        );
      else if (room.kind === "global") {
        if (!["admin", "owner"].includes(user.role))
          fail(403, "Administrator required");
      } else if (room.kind === "party")
        await requirePartyLeader(userId, room.party_id);
      else if (room.owner_id !== userId) fail(403, "Chat owner required");
      if (message.deleted_at) fail(409, "Message was deleted");
      if (method === "POST")
        await db`INSERT INTO chat_pins(message_id,pinned_by) VALUES(${message.id},${userId}) ON CONFLICT DO NOTHING`;
      else await db`DELETE FROM chat_pins WHERE message_id=${message.id}`;
      await publishEvent({
        type: "chat:pin:update",
        roomId: message.room_id,
        payload: {
          messageId: message.id,
          authorId: message.author_id,
          pinned: method === "POST",
        },
      });
      return { ok: true };
    }
  }
  if (key === "polls" && action && extra === "vote" && method === "POST") {
    const { optionIds } = parse(
      z.object({ optionIds: z.array(id).max(10) }).strict(),
      input,
    );
    const poll = (
      await db`SELECT message_id FROM chat_polls WHERE id=${uuid(action)}`
    )[0];
    if (!poll) fail(404, "Poll not found");
    const message = await messageAccess(userId, poll.message_id);
    await db.begin(async (tx) => {
      const polls =
        await tx`SELECT p.*,m.deleted_at FROM chat_polls p JOIN chat_messages m ON m.id=p.message_id WHERE p.id=${action} FOR UPDATE OF p`;
      const p = polls[0];
      if (!p) fail(404, "Poll not found");
      if (p.deleted_at) fail(409, "Message was deleted");
      if (p.closes_at && new Date(p.closes_at) <= new Date())
        fail(409, "Poll is closed");
      const selected = [...new Set(optionIds)];
      if (!p.multiple && selected.length > 1)
        fail(400, "Select only one option");
      for (const option of selected)
        if (
          !(
            await tx`SELECT 1 FROM chat_poll_options WHERE id=${option} AND poll_id=${p.id}`
          ).length
        )
          fail(400, "Option does not belong to this poll");
      await tx`DELETE FROM chat_poll_votes WHERE poll_id=${p.id} AND user_id=${userId}`;
      for (const option of selected)
        await tx`INSERT INTO chat_poll_votes(poll_id,option_id,user_id) VALUES(${p.id},${option},${userId})`;
    });
    await publishEvent({
      type: "chat:poll:update",
      roomId: message.room_id,
      payload: { messageId: message.id, authorId: message.author_id },
    });
    return { ok: true };
  }
  return undefined;
}

function serverDescriptor(s: Record<string, unknown>) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    icon: s.icon,
    banner: s.banner,
    ownerId: s.owner_id,
    discoverable: s.discoverable,
    tags: s.tags,
    memberCount: Number(s.member_count || 0),
  };
}
function roleDescriptor(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    position: r.position,
    permissions: r.permissions,
    isDefault: r.is_default,
  };
}
async function roleControl(
  userId: string,
  serverId: string,
  role: Record<string, unknown>,
  desired: string[] = (role.permissions as string[] | undefined) || [],
) {
  const access = await requireServerPermission(
    userId,
    serverId,
    "manage_roles",
  );
  if (!canGrant(desired, access.permissions, access.owner))
    fail(403, "Cannot grant permissions you do not hold");
  const highest = Math.max(0, ...access.roles.map((r) => Number(r.position)));
  if (
    !access.owner &&
    (role?.is_default || Number(role?.position || 0) >= highest)
  )
    fail(403, "Cannot manage a role at or above your highest role");
  return access;
}
async function handleServers(
  path: string[],
  method: string,
  user: User,
  input: Record<string, unknown>,
  url: URL,
  request: Request,
) {
  const [root, key, action, extra] = path;
  const userId = user.id;
  if (root === "servers") {
    const media = await handleServerEmoji(path, method, user, request, {
      serverAccess,
    });
    if (media !== undefined) return media;
  }
  if (root === "invites" && key) {
    const code = parse(z.string().regex(/^[A-Za-z0-9_-]{8,32}$/), key);
    const invite = (
      await db`SELECT i.*,s.name,s.description,s.icon,s.discoverable FROM server_invites i JOIN servers s ON s.id=i.server_id WHERE i.code=${code}`
    )[0];
    if (
      !invite ||
      (invite.expires_at && new Date(invite.expires_at) <= new Date()) ||
      (invite.max_uses && invite.uses >= invite.max_uses)
    )
      fail(404, "Invite is expired or unavailable");
    if (method === "GET")
      return {
        code: invite.code,
        serverId: invite.server_id,
        name: invite.name,
        description: invite.description,
        icon: invite.icon,
      };
    if (method === "POST" && action === "join") {
      await db.begin(async (tx) => {
        const inv = (
          await tx`SELECT * FROM server_invites WHERE code=${code} FOR UPDATE`
        )[0];
        if (
          !inv ||
          (inv.expires_at && new Date(inv.expires_at) <= new Date()) ||
          (inv.max_uses && inv.uses >= inv.max_uses)
        )
          fail(404, "Invite is expired or unavailable");
        const added =
          await tx`INSERT INTO server_members(server_id,user_id) VALUES(${inv.server_id},${userId}) ON CONFLICT DO NOTHING RETURNING user_id`;
        if (added.length)
          await tx`UPDATE server_invites SET uses=uses+1 WHERE code=${code}`;
      });
      return { serverId: invite.server_id };
    }
    return undefined;
  }
  if (method === "GET" && !key) {
    const list =
      await db`SELECT s.*,(SELECT count(*) FROM server_members sm WHERE sm.server_id=s.id) AS member_count FROM servers s JOIN server_members m ON m.server_id=s.id WHERE m.user_id=${userId} ORDER BY s.name`;
    return list.map(serverDescriptor);
  }
  if (method === "GET" && key === "discover") {
    const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
    const list =
      await db`SELECT s.*,(SELECT count(*) FROM server_members sm WHERE sm.server_id=s.id) AS member_count FROM servers s WHERE discoverable AND (${!q} OR name ILIKE ${"%" + q + "%"} OR description ILIKE ${"%" + q + "%"} OR array_to_string(tags,' ') ILIKE ${"%" + q + "%"}) ORDER BY name LIMIT 50`;
    return list.map(serverDescriptor);
  }
  if (method === "POST" && !key) {
    const data = parse(
      z
        .object({
          name: text(80),
          description: z.string().max(1000).default(""),
          discoverable: z.boolean().default(false),
          tags: z.array(text(30)).max(8).default([]),
        })
        .strict(),
      input,
    );
    await rateLimit(userId, "create_server", 10, 3600);
    return db.begin(async (tx) => {
      const s = (
        await tx`INSERT INTO servers(owner_id,name,description,discoverable,tags) VALUES(${userId},${data.name},${data.description},${data.discoverable},${data.tags}) RETURNING id`
      )[0];
      await tx`INSERT INTO server_members(server_id,user_id) VALUES(${s.id},${userId})`;
      await tx`INSERT INTO server_roles(server_id,name,permissions,is_default) VALUES(${s.id},'Members',${defaultPermissions},true)`;
      await tx`INSERT INTO chat_rooms(kind,name,server_id,owner_id) VALUES('channel','general',${s.id},${userId})`;
      return s;
    });
  }
  if (!key) return undefined;
  const serverId = uuid(key);
  if (action === "join" && method === "POST") {
    const s = (
      await db`SELECT id FROM servers WHERE id=${serverId} AND discoverable`
    )[0];
    if (!s) fail(404, "Discoverable server not found");
    await db`INSERT INTO server_members(server_id,user_id) VALUES(${serverId},${userId}) ON CONFLICT DO NOTHING`;
    return { serverId };
  }
  const access = await serverAccess(userId, serverId);
  if (method === "GET" && !action) {
    const channels =
      await db`SELECT * FROM chat_rooms WHERE server_id=${serverId} ORDER BY position,name`;
    const visible = access.permissions.includes("view_channel")
      ? channels.filter(
          (r) =>
            !r.restricted_role_id ||
            access.owner ||
            access.roles.some((role) => role.id === r.restricted_role_id),
        )
      : [];
    return {
      ...serverDescriptor(access.server),
      channels: visible.map(roomDescriptor),
      roles: (
        await db`SELECT * FROM server_roles WHERE server_id=${serverId} ORDER BY position DESC`
      ).map(roleDescriptor),
      members:
        await db`SELECT u.id,u.username,u.display_name AS "displayName",u.avatar,COALESCE((SELECT jsonb_agg(mr.role_id) FROM server_member_roles mr WHERE mr.server_id=${serverId} AND mr.user_id=u.id),'[]'::jsonb) AS "roleIds" FROM server_members m JOIN users u ON u.id=m.user_id WHERE m.server_id=${serverId} ORDER BY u.display_name LIMIT 500`,
      permissions: access.permissions,
    };
  }
  if ((method === "PATCH" || method === "POST") && !action) {
    await requireServerPermission(userId, serverId, "manage_server");
    const d = parse(
      z
        .object({
          name: text(80).optional(),
          description: z.string().max(1000).optional(),
          icon: media.optional(),
          banner: media.optional(),
          discoverable: z.boolean().optional(),
          tags: z.array(text(30)).max(8).optional(),
        })
        .strict(),
      input,
    );
    const s = access.server;
    await db`UPDATE servers SET name=${d.name ?? s.name},description=${d.description ?? s.description},icon=${d.icon === undefined ? s.icon : d.icon || null},banner=${d.banner === undefined ? s.banner : d.banner || null},discoverable=${d.discoverable ?? s.discoverable},tags=${d.tags ?? s.tags} WHERE id=${serverId}`;
    return { ok: true };
  }
  if (method === "DELETE" && !action) {
    if (!access.owner) fail(403, "Server owner required");
    await db.begin(async (tx) => {
      const [current] =
        await tx`SELECT owner_id FROM servers WHERE id=${serverId} FOR UPDATE`;
      if (!current) fail(404, "Server not found");
      if (current.owner_id !== userId) fail(403, "Server owner required");
      await queueChatAttachmentCleanup(tx, { kind: "server", id: serverId });
      await tx`DELETE FROM servers WHERE id=${serverId}`;
    });
    requestStorageCleanup();
    return { ok: true };
  }
  if (action === "owner" && method === "POST") {
    if (!access.owner) fail(403, "Server owner required");
    const { userId: target } = parse(z.object({ userId: id }).strict(), input);
    if (
      !(
        await db`SELECT 1 FROM server_members WHERE server_id=${serverId} AND user_id=${target}`
      ).length
    )
      fail(400, "New owner must be a member");
    await db`UPDATE servers SET owner_id=${target} WHERE id=${serverId}`;
    return { ok: true };
  }
  if (action === "leave" && method === "POST") {
    if (access.owner) fail(400, "Transfer ownership before leaving");
    await db`DELETE FROM server_members WHERE server_id=${serverId} AND user_id=${userId}`;
    return { ok: true };
  }
  if (action === "channels") {
    if (method === "POST" && !extra) {
      await requireServerPermission(userId, serverId, "manage_channels");
      const d = parse(
        z
          .object({
            name: text(100),
            type: z.enum(["text", "announcement"]).default("text"),
            restrictedRoleId: id.nullable().optional(),
            position: z.number().int().min(0).max(1000).default(0),
          })
          .strict(),
        input,
      );
      if (
        d.restrictedRoleId &&
        !(
          await db`SELECT 1 FROM server_roles WHERE server_id=${serverId} AND id=${d.restrictedRoleId}`
        ).length
      )
        fail(400, "Channel role must belong to this server");
      return roomDescriptor(
        (
          await db`INSERT INTO chat_rooms(kind,name,server_id,owner_id,channel_type,restricted_role_id,position) VALUES('channel',${d.name},${serverId},${userId},${d.type},${d.restrictedRoleId || null},${d.position}) RETURNING *`
        )[0],
      );
    }
    if (extra && (method === "PATCH" || method === "DELETE")) {
      await requireServerPermission(userId, serverId, "manage_channels");
      const r = (
        await db`SELECT * FROM chat_rooms WHERE id=${uuid(extra)} AND server_id=${serverId}`
      )[0];
      if (!r) fail(404, "Channel not found");
      if (method === "DELETE") {
        await db.begin(async (tx) => {
          await queueChatAttachmentCleanup(tx, { kind: "room", id: r.id });
          await tx`DELETE FROM chat_rooms WHERE id=${r.id} AND server_id=${serverId}`;
        });
        requestStorageCleanup();
        return { ok: true };
      }
      const d = parse(
        z
          .object({
            name: text(100).optional(),
            type: z.enum(["text", "announcement"]).optional(),
            restrictedRoleId: id.nullable().optional(),
            position: z.number().int().min(0).max(1000).optional(),
          })
          .strict(),
        input,
      );
      if (
        d.restrictedRoleId &&
        !(
          await db`SELECT 1 FROM server_roles WHERE server_id=${serverId} AND id=${d.restrictedRoleId}`
        ).length
      )
        fail(400, "Channel role must belong to this server");
      await db`UPDATE chat_rooms SET name=${d.name ?? r.name},channel_type=${d.type ?? r.channel_type},restricted_role_id=${d.restrictedRoleId === undefined ? r.restricted_role_id : d.restrictedRoleId},position=${d.position ?? r.position} WHERE id=${r.id}`;
      return { ok: true };
    }
  }
  if (action === "roles") {
    if (method === "POST" && !extra) {
      const d = parse(
        z
          .object({
            name: text(80),
            color: z
              .string()
              .regex(/^#[0-9a-f]{6}$/i)
              .default("#7c6cff"),
            position: z.number().int().min(0).max(1000).default(1),
            permissions: z
              .array(z.enum(permissions))
              .max(permissions.length)
              .default([]),
          })
          .strict(),
        input,
      );
      await roleControl(
        userId,
        serverId,
        { position: d.position },
        d.permissions,
      );
      return roleDescriptor(
        (
          await db`INSERT INTO server_roles(server_id,name,color,position,permissions) VALUES(${serverId},${d.name},${d.color},${d.position},${[...new Set(d.permissions)]}) RETURNING *`
        )[0],
      );
    }
    if (extra && (method === "PATCH" || method === "DELETE")) {
      const role = (
        await db`SELECT * FROM server_roles WHERE id=${uuid(extra)} AND server_id=${serverId}`
      )[0];
      if (!role) fail(404, "Role not found");
      if (method === "DELETE") {
        await roleControl(userId, serverId, role);
        if (role.is_default) fail(400, "Default role cannot be deleted");
        if (
          (
            await db`SELECT 1 FROM chat_rooms WHERE restricted_role_id=${role.id} LIMIT 1`
          ).length
        )
          fail(
            409,
            "Reconfigure restricted channels before deleting this role",
          );
        await db`DELETE FROM server_roles WHERE id=${role.id}`;
        return { ok: true };
      }
      const d = parse(
        z
          .object({
            name: text(80).optional(),
            color: z
              .string()
              .regex(/^#[0-9a-f]{6}$/i)
              .optional(),
            position: z.number().int().min(0).max(1000).optional(),
            permissions: z
              .array(z.enum(permissions))
              .max(permissions.length)
              .optional(),
          })
          .strict(),
        input,
      );
      await roleControl(
        userId,
        serverId,
        role,
        d.permissions || role.permissions,
      );
      if (d.position !== undefined)
        await roleControl(
          userId,
          serverId,
          { position: d.position },
          d.permissions || role.permissions,
        );
      await db`UPDATE server_roles SET name=${d.name ?? role.name},color=${d.color ?? role.color},position=${d.position ?? role.position},permissions=${d.permissions ? [...new Set(d.permissions)] : role.permissions} WHERE id=${role.id}`;
      return { ok: true };
    }
  }
  if (action === "members" && extra) {
    const target = uuid(extra);
    if (
      !(
        await db`SELECT 1 FROM server_members WHERE server_id=${serverId} AND user_id=${target}`
      ).length
    )
      fail(404, "Member not found");
    if (method === "DELETE") {
      await requireServerPermission(userId, serverId, "manage_server");
      if (target === access.server.owner_id)
        fail(403, "Cannot remove the server owner");
      if (!access.owner) {
        const targetAccess = await serverAccess(target, serverId);
        if (
          Math.max(0, ...targetAccess.roles.map((r) => r.position)) >=
          Math.max(0, ...access.roles.map((r) => r.position))
        )
          fail(403, "Cannot remove a member with an equal or higher role");
      }
      await db`DELETE FROM server_members WHERE server_id=${serverId} AND user_id=${target}`;
      return { ok: true };
    }
    if (method === "POST" || method === "PATCH") {
      await requireServerPermission(userId, serverId, "manage_roles");
      const { roleIds } = parse(
        z.object({ roleIds: z.array(id).max(20) }).strict(),
        input,
      );
      if (!access.owner) {
        if (target === userId || target === access.server.owner_id)
          fail(403, "Cannot change your own roles or the owner roles");
        const targetAccess = await serverAccess(target, serverId);
        if (
          Math.max(0, ...targetAccess.roles.map((r) => r.position)) >=
          Math.max(0, ...access.roles.map((r) => r.position))
        )
          fail(403, "Cannot manage a member with an equal or higher role");
      }
      const existing =
        await db`SELECT r.* FROM server_roles r JOIN server_member_roles mr ON mr.role_id=r.id WHERE mr.server_id=${serverId} AND mr.user_id=${target}`;
      for (const r of existing) await roleControl(userId, serverId, r);
      const requested: Record<string, unknown>[] = [];
      for (const roleId of [...new Set(roleIds)]) {
        const r = (
          await db`SELECT * FROM server_roles WHERE id=${roleId} AND server_id=${serverId}`
        )[0];
        if (!r || r.is_default)
          fail(400, "Choose an assignable role in this server");
        await roleControl(userId, serverId, r);
        requested.push(r);
      }
      await db.begin(async (tx) => {
        await tx`DELETE FROM server_member_roles WHERE server_id=${serverId} AND user_id=${target}`;
        for (const r of requested)
          await tx`INSERT INTO server_member_roles(server_id,user_id,role_id) VALUES(${serverId},${target},${String(r.id)})`;
      });
      return { ok: true };
    }
  }
  if (action === "invites") {
    await requireServerPermission(userId, serverId, "create_invite");
    if (method === "GET")
      return db`SELECT code,server_id AS "serverId",expires_at AS "expiresAt",max_uses AS "maxUses",uses FROM server_invites WHERE server_id=${serverId} ORDER BY created_at DESC LIMIT 100`;
    if (method === "POST" && !extra) {
      const d = parse(
        z
          .object({
            expiresInHours: z.number().min(0.1).max(8760).nullable().optional(),
            maxUses: z.number().int().min(1).max(100000).nullable().optional(),
          })
          .strict(),
        input,
      );
      await rateLimit(userId, "server_invite", 20, 3600);
      const code = randomBytes(9).toString("base64url");
      return (
        await db`INSERT INTO server_invites(code,server_id,creator_id,expires_at,max_uses) VALUES(${code},${serverId},${userId},${d.expiresInHours ? new Date(Date.now() + d.expiresInHours * 3600000) : null},${d.maxUses || null}) RETURNING code,server_id AS "serverId",expires_at AS "expiresAt",max_uses AS "maxUses",uses`
      )[0];
    }
    if (method === "DELETE" && extra) {
      if (!access.owner && !access.permissions.includes("manage_server")) {
        const r =
          await db`DELETE FROM server_invites WHERE code=${extra} AND server_id=${serverId} AND creator_id=${userId} RETURNING code`;
        if (!r.length) fail(403, "Can only revoke your own invites");
      } else
        await db`DELETE FROM server_invites WHERE code=${extra} AND server_id=${serverId}`;
      return { ok: true };
    }
  }
  return undefined;
}

async function announceParty(partyId: string, additional: string[] = []) {
  const members =
    await db`SELECT user_id FROM party_members WHERE party_id=${partyId}`;
  await publishEvent({
    type: "party:update",
    userIds: [
      ...new Set([...members.map((m) => m.user_id as string), ...additional]),
    ],
    payload: { partyId },
  });
}
async function handleParties(
  path: string[],
  method: string,
  user: User,
  input: Record<string, unknown>,
) {
  const [, key, action] = path;
  const userId = user.id;
  if (method === "GET" && !key)
    return {
      party: await partyState(userId),
      invites:
        await db`SELECT i.party_id AS "partyId",i.inviter_id AS "inviterId",u.display_name AS "inviterName",u.avatar,i.expires_at AS "expiresAt",p.game_id AS "gameId" FROM party_invites i JOIN users u ON u.id=i.inviter_id JOIN parties p ON p.id=i.party_id WHERE i.user_id=${userId} AND i.expires_at>now() AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=${userId} AND b.blocked_id=i.inviter_id) OR (b.blocked_id=${userId} AND b.user_id=i.inviter_id)) ORDER BY i.expires_at`,
    };
  if (method === "POST" && !key) {
    if (await partyState(userId)) fail(409, "Leave your current party first");
    const p = await db.begin(async (tx) => {
      await tx`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
      if (
        (await tx`SELECT 1 FROM party_members WHERE user_id=${userId}`).length
      )
        fail(409, "Leave your current party first");
      const p = (
        await tx`INSERT INTO parties(leader_id) VALUES(${userId}) RETURNING id`
      )[0];
      await tx`INSERT INTO party_members(party_id,user_id) VALUES(${p.id},${userId})`;
      await tx`INSERT INTO chat_rooms(kind,name,party_id,owner_id) VALUES('party','Party chat',${p.id},${userId})`;
      return p;
    });
    await announceParty(p.id);
    return partyState(userId, p.id);
  }
  if (!key) return undefined;
  const partyId = uuid(key);
  if (method === "GET" && !action) {
    const p = await partyState(userId, partyId);
    if (!p) fail(403, "Party membership required");
    return p;
  }
  if (method !== "POST" || !action) return undefined;
  if (action === "join") {
    await db.begin(async (tx) => {
      await tx`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
      const p = (
        await tx`SELECT * FROM parties WHERE id=${partyId} FOR UPDATE`
      )[0];
      if (!p) fail(404, "Party not found");
      const current =
        await tx`SELECT party_id FROM party_members WHERE user_id=${userId}`;
      if (current[0]?.party_id === partyId) return;
      if (current.length) fail(409, "Leave your current party first");
      if (
        !(
          await tx`SELECT 1 FROM party_invites WHERE party_id=${partyId} AND user_id=${userId} AND expires_at>now()`
        ).length
      )
        fail(403, "A valid party invitation is required");
      const members =
        await tx`SELECT user_id FROM party_members WHERE party_id=${partyId}`;
      if (members.length >= 8) fail(409, "Party is full");
      for (const m of members)
        if (
          (
            await tx`SELECT 1 FROM user_blocks WHERE (user_id=${userId} AND blocked_id=${m.user_id}) OR (blocked_id=${userId} AND user_id=${m.user_id})`
          ).length
        )
          fail(403, "Party interaction unavailable");
      await tx`INSERT INTO party_members(party_id,user_id) VALUES(${partyId},${userId})`;
      await tx`DELETE FROM party_invites WHERE party_id=${partyId} AND user_id=${userId}`;
      await tx`UPDATE party_members SET ready=false WHERE party_id=${partyId}`;
      await tx`UPDATE parties SET launched_at=null WHERE id=${partyId}`;
    });
    await announceParty(partyId);
    return partyState(userId, partyId);
  }
  if (action === "decline") {
    await db`DELETE FROM party_invites WHERE party_id=${partyId} AND user_id=${userId}`;
    return { ok: true };
  }
  const p = await partyState(userId, partyId);
  if (!p) fail(403, "Party membership required");
  if (action === "invite") {
    await rateLimit(userId, "party_invite", 20, 60);
    const { userId: target } = parse(z.object({ userId: id }).strict(), input);
    await requireInteraction(userId, target);
    if (p.members.length >= 8) fail(409, "Party is full");
    if (p.members.some((m) => m.id === target))
      fail(409, "User is already in the party");
    for (const m of p.members)
      if (await usersBlocked(m.id, target))
        fail(403, "Party interaction unavailable");
    await db`INSERT INTO party_invites(party_id,user_id,inviter_id) VALUES(${partyId},${target},${userId}) ON CONFLICT(party_id,user_id) DO UPDATE SET inviter_id=EXCLUDED.inviter_id,expires_at=now()+interval '1 day'`;
    await notify(
      target,
      userId,
      "party_invite",
      `${user.displayName} invited you to a party`,
      "/parties",
    );
    await publishEvent({
      type: "party:invite",
      userIds: [target],
      payload: { partyId, inviterId: userId, inviterName: user.displayName },
    });
    return { ok: true };
  }
  if (action === "ready") {
    const { ready } = parse(z.object({ ready: z.boolean() }).strict(), input);
    await db`UPDATE party_members SET ready=${ready} WHERE party_id=${partyId} AND user_id=${userId}`;
    await announceParty(partyId);
    return partyState(userId, partyId);
  }
  if (action === "leave" || action === "kick") {
    let target = userId;
    if (action === "kick") {
      await requirePartyLeader(userId, partyId);
      target = parse(z.object({ userId: id }).strict(), input).userId;
      if (target === userId) fail(400, "Use leave to leave the party");
      if (!p.members.some((m) => m.id === target))
        fail(404, "Party member not found");
    }
    await db.begin(async (tx) => {
      const current = (
        await tx`SELECT * FROM parties WHERE id=${partyId} FOR UPDATE`
      )[0];
      if (!current) return;
      if (action === "kick" && current.leader_id !== userId)
        fail(403, "Party leader required");
      await tx`DELETE FROM party_members WHERE party_id=${partyId} AND user_id=${target}`;
      const next =
        await tx`SELECT user_id FROM party_members WHERE party_id=${partyId} ORDER BY joined_at,user_id LIMIT 1`;
      if (!next.length) {
        await queueChatAttachmentCleanup(tx, { kind: "party", id: partyId });
        await tx`DELETE FROM parties WHERE id=${partyId}`;
      } else {
        if (current.leader_id === target) {
          await tx`UPDATE parties SET leader_id=${next[0].user_id} WHERE id=${partyId}`;
          await tx`UPDATE chat_rooms SET owner_id=${next[0].user_id} WHERE party_id=${partyId}`;
        }
        await tx`UPDATE parties SET launched_at=null WHERE id=${partyId}`;
        await tx`UPDATE party_members SET ready=false WHERE party_id=${partyId}`;
      }
    });
    requestStorageCleanup();
    await announceParty(partyId, [target]);
    return { ok: true };
  }
  await requirePartyLeader(userId, partyId);
  if (action === "leader") {
    const { userId: target } = parse(z.object({ userId: id }).strict(), input);
    if (!p.members.some((m) => m.id === target))
      fail(400, "Leader must be a party member");
    await db.begin(async (tx) => {
      const rows =
        await tx`UPDATE parties SET leader_id=${target} WHERE id=${partyId} AND leader_id=${userId} RETURNING id`;
      if (!rows.length) fail(403, "Party leadership changed");
      await tx`UPDATE chat_rooms SET owner_id=${target} WHERE party_id=${partyId}`;
    });
    await announceParty(partyId);
    return partyState(userId, partyId);
  }
  if (action === "game") {
    const { gameId } = parse(
      z.object({ gameId: z.string().max(80).nullable() }).strict(),
      input,
    );
    if (gameId && !gameById(gameId)) fail(404, "Game not found");
    await db.begin(async (tx) => {
      const rows =
        await tx`UPDATE parties SET game_id=${gameId},launched_at=null WHERE id=${partyId} AND leader_id=${userId} RETURNING id`;
      if (!rows.length) fail(403, "Party leadership changed");
      await tx`UPDATE party_members SET ready=false WHERE party_id=${partyId}`;
    });
    await announceParty(partyId);
    return partyState(userId, partyId);
  }
  if (action === "launch") {
    const result = await db.begin(async (tx) => {
      const current = (
        await tx`SELECT * FROM parties WHERE id=${partyId} FOR UPDATE`
      )[0];
      if (!current || current.leader_id !== userId)
        fail(403, "Party leader required");
      const game = current.game_id ? gameById(current.game_id) : undefined;
      if (!game) fail(400, "Choose a game first");
      if (
        (
          await tx`SELECT 1 FROM platform_flags WHERE key=${"games." + game.id} AND enabled=false`
        ).length
      )
        fail(503, "This game is temporarily disabled");
      const members =
        await tx`SELECT user_id,ready FROM party_members WHERE party_id=${partyId}`;
      if (members.length < game.players[0] || members.length > game.players[1])
        fail(
          400,
          `This game supports ${game.players[0]}–${game.players[1]} players`,
        );
      if (members.some((m) => !m.ready)) fail(409, "All members must be ready");
      await tx`UPDATE parties SET launched_at=now() WHERE id=${partyId}`;
      return {
        partyId,
        gameId: game.id,
        route: game.route,
        multiplayer: game.multiplayer,
      };
    });
    await announceParty(partyId);
    return result;
  }
  return undefined;
}

async function uploadChatFile(
  userId: string,
  roomId: string,
  request: Request,
) {
  const room = await authorizeRoom(userId, roomId, "attach_files");
  await authorizeRoom(userId, room.id, "send_messages");
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
    fail(415, "Use a multipart file upload");
  await rateLimit(userId, "chat_upload", 20, 3600);
  const configured = Number(
    process.env.MAX_CHAT_FILE_BYTES || 25 * 1024 * 1024,
  );
  const fileLimit = Math.min(
    MAX_FILE_BYTES,
    Number.isSafeInteger(configured) && configured > 0
      ? configured
      : 25 * 1024 * 1024,
  );
  const bodyLimit = fileLimit + 65536;
  if (Number(request.headers.get("content-length")) > bodyLimit)
    fail(413, "Upload exceeds the chat file limit");
  if (!request.body) fail(400, "Choose a file");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > bodyLimit) {
      await reader.cancel();
      fail(413, "Upload exceeds the chat file limit");
    }
    chunks.push(value);
  }
  const form = await new Response(
    new Uint8Array(Buffer.concat(chunks)).buffer,
    { headers: { "Content-Type": request.headers.get("content-type")! } },
  ).formData();
  const file = form.get("file");
  if (!(file instanceof File)) fail(400, "Choose a file");
  if (file.size > fileLimit) fail(413, "File exceeds the chat file limit");
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateFile({ name: file.name, type: file.type, size: file.size }, bytes);
  const imageConfigured = Number(
    process.env.MAX_CHAT_IMAGE_BYTES || 10 * 1024 * 1024,
  );
  const imageLimit =
    Number.isSafeInteger(imageConfigured) && imageConfigured > 0
      ? imageConfigured
      : 10 * 1024 * 1024;
  if (file.type.startsWith("image/") && file.size > imageLimit)
    fail(413, "Image exceeds the image upload limit");
  const key = await storeFile(bytes);
  try {
    return await db.begin(async (tx) => {
      await tx`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
      const usage = await storageUsage(tx, userId);
      if (usage.usageBytes + file.size > usage.quotaBytes)
        fail(413, "Your attachment storage quota is full");
      await assertUploadBindable(tx, key);
      return (
        await tx`INSERT INTO chat_attachments(room_id,owner_id,storage_key,filename,mime,bytes) VALUES(${room.id},${userId},${key},${file.name},${file.type},${file.size}) RETURNING id,filename,mime,bytes`
      )[0];
    });
  } catch (error) {
    await removeUncommittedFile(key);
    throw error;
  }
}
async function downloadChatFile(userId: string, fileId: string) {
  const attachment = (
    await db`SELECT a.*,m.deleted_at FROM chat_attachments a LEFT JOIN chat_messages m ON m.id=a.message_id WHERE a.id=${uuid(fileId)}`
  )[0];
  if (!attachment) fail(404, "Attachment not found");
  await authorizeRoom(userId, attachment.room_id);
  if (
    (attachment.message_id && attachment.deleted_at) ||
    (!attachment.message_id && attachment.owner_id !== userId) ||
    (await usersBlocked(userId, attachment.owner_id))
  )
    fail(404, "Attachment not found");
  const bytes = await readFile(attachment.storage_key);
  return new Response(new Uint8Array(bytes).buffer, {
    headers: {
      "Content-Type": attachment.mime,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}

async function removeChatFile(userId: string, fileId: string) {
  await db.begin(async (tx) => {
    const [file] =
      await tx`SELECT * FROM chat_attachments WHERE id=${uuid(fileId)} FOR UPDATE`;
    if (!file || file.owner_id !== userId) fail(404, "Attachment not found");
    await authorizeRoom(userId, file.room_id);
    if (file.message_id)
      fail(409, "Published attachments are managed through their message");
    await tx`INSERT INTO storage_cleanup_jobs(storage_key) VALUES(${file.storage_key}) ON CONFLICT DO NOTHING`;
    await tx`DELETE FROM chat_attachments WHERE id=${file.id}`;
  });
  requestStorageCleanup();
  return { deleted: true };
}
