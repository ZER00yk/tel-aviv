import Redis from "ioredis";

export interface DomainEvent {
  type: string;
  roomId?: string;
  userIds?: string[];
  payload: unknown;
}
export interface Activity {
  gameId?: string;
  mode?: string;
  lobbyCode?: string;
  joinable?: boolean;
}
export interface Presence extends Activity {
  status: string;
  since: number;
  updatedAt: number;
  lobbyActive?: boolean;
  lastActivityAt?: number;
}
export const eventChannel = "tell-aviv:events";
export const presenceKey = (userId: string) => `tell-aviv:presence:${userId}`;
let publisher: Redis | undefined;
function connection() {
  if (!process.env.REDIS_URL) return undefined;
  if (!publisher) {
    publisher = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    publisher.on("error", () => undefined);
  }
  return publisher;
}
export async function publishEvent(event: DomainEvent) {
  const redis = connection();
  if (redis)
    await redis
      .publish(eventChannel, JSON.stringify(event))
      .catch(() => undefined);
}
export async function setActivity(
  userId: string,
  activity: Activity,
  preserveRoom = false,
) {
  const redis = connection();
  if (!redis) return;
  const raw = await redis.get(presenceKey(userId)).catch(() => null);
  if (!raw) return;
  const old = JSON.parse(raw) as Presence;
  let roomActivity: Activity = {},
    lobbyActive = false;
  if (preserveRoom) {
    const code = await redis
      .get(`tell-aviv:user-lobby:${userId}`)
      .catch(() => null);
    const room = code
      ? await redis.get(`tell-aviv:lobby:${code}`).catch(() => null)
      : null;
    if (room) {
      lobbyActive = true;
      const lobby = JSON.parse(room) as {
        gameId: string;
        visibility: string;
        status: string;
      };
      roomActivity = {
        gameId: lobby.gameId,
        lobbyCode: lobby.visibility === "public" ? code! : undefined,
        joinable: lobby.visibility === "public" && lobby.status !== "playing",
      };
    }
  }
  const presence: Presence = {
    status: old.status,
    since: old.since,
    lastActivityAt: old.lastActivityAt,
    ...activity,
    ...roomActivity,
    lobbyActive,
    updatedAt: Date.now(),
  };
  await redis
    .set(presenceKey(userId), JSON.stringify(presence), "EX", 90)
    .catch(() => undefined);
  await publishEvent({
    type: "presence:changed",
    userIds: [userId],
    payload: { userId },
  });
}
