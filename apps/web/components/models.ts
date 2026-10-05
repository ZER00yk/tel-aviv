import type { User } from "@tell-aviv/shared";
import type { GameManifest } from "@tell-aviv/games";
export interface Person {
  id: string;
  userId?: string;
  username: string;
  displayName: string;
  avatar?: string | null;
  status?: string;
  xp?: number;
  nickname?: string;
  note?: string;
  favorite?: boolean;
  closeFriend?: boolean;
  muted?: boolean;
  ready?: boolean;
  roleIds?: string[];
}
export interface Activity extends Person {
  title: string;
  link: string;
  createdAt: string;
}
export interface Notification {
  id: string;
  kind: string;
  title: string;
  link: string;
  readAt: string | null;
  createdAt: string;
  actorName?: string;
  avatar?: string | null;
}
export interface FriendsData {
  friends: Person[];
  incoming: Person[];
  outgoing: Person[];
  blocked: Person[];
}
export interface HomeData {
  friends: Person[];
  notifications: Notification[];
  activity: Activity[];
}
export interface Announcement {
  id: string;
  title: string;
  body: string;
  created_at: string;
}
export interface HistoryEntry {
  gameId: string;
  game_id?: string;
  lastPlayed: string;
  sessions: number;
}
export interface CatalogGame extends GameManifest {
  favorite: boolean;
  livePlayers: number;
  enabled?: boolean;
}
export interface GamesData {
  games: CatalogGame[];
  history: HistoryEntry[];
  favorites?: string[];
}
export interface Achievement {
  id: string;
  name: string;
  title?: string;
  description: string;
  unlockedAt: string | null;
  points: number;
}
export interface Changelog {
  version: string;
  title?: string;
  body?: string;
  notes?: string;
}
export interface GameDetailData {
  game: GameManifest;
  favorite: boolean;
  enabled?: boolean;
  stats: Record<string, string | number | null>;
  achievements: Achievement[];
  changelog: Changelog[];
}
export interface LeaderboardEntry {
  userId: string;
  user_id?: string;
  username: string;
  displayName: string;
  display_name?: string;
  avatar: string | null;
  score: number;
}
export interface LeaderboardData {
  entries: LeaderboardEntry[];
  ranked: boolean;
  reason?: string;
}
export interface ChatRoomData {
  id: string;
  kind: string;
  name: string;
  members?: Person[];
  lastMessage?: string;
  unread?: number;
  ownerId?: string | null;
  icon?: string | null;
  serverId?: string | null;
}
export interface Reaction {
  emoji: string;
  userId: string;
}
export interface PollOption {
  id: string;
  label: string;
  votes: number;
  voted: boolean;
}
export interface Poll {
  id: string;
  question: string;
  multiple: boolean;
  closesAt: string | null;
  options: PollOption[];
}
export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
}
export interface ChatMessage extends Person {
  authorId: string;
  content: string;
  replyTo: string | null;
  threadId?: string | null;
  threadReplyCount?: number;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  pinned: boolean;
  reactions: Reaction[];
  poll?: Poll | null;
  attachments?: Attachment[];
}
export interface ChatData {
  room: ChatRoomData;
  messages: ChatMessage[];
  nextCursor: string | null;
  thread?: {
    id: string;
    root: ChatMessage | null;
    name?: string;
    archivedAt?: string | null;
    following?: boolean;
    unread?: number;
    canManage?: boolean;
  };
}
export interface ServerRole {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: string[];
  isDefault: boolean;
}
export interface ServerData {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  icon: string | null;
  banner: string | null;
  discoverable: boolean;
  tags: string[];
  memberCount: number;
  channels: ChatRoomData[];
  roles: ServerRole[];
  members: Person[];
  permissions: string[];
}
export interface Party {
  id: string;
  leaderId: string;
  gameId: string | null;
  roomId: string | null;
  members: Person[];
}
export interface PartyData {
  party: Party | null;
  invites: { partyId: string; inviterName: string }[];
}
export interface MutationResult {
  id?: string;
  code?: string;
  serverId?: string;
  gameId?: string;
}
export interface ProfileData extends Omit<User, "settings"> {
  level: number;
  friends: Person[];
  activity: Activity[];
  isFriend: boolean;
}
export interface SessionData {
  id: string;
  user_agent: string;
  created_at: string;
  expires_at: string;
}
export interface UiSettings {
  appearance?: string;
  presence?: string;
  privacy?: {
    [key: string]: boolean | string | undefined;
    showFriends?: boolean;
    showActivity?: boolean;
    allowFriendRequests?: boolean;
    allowDMs?: string;
  };
  notifications?: Record<string, boolean>;
  accessibility?: {
    reducedMotion?: boolean;
    highContrast?: boolean;
    fontScale?: number;
  };
  games?: {
    volume?: number;
    music?: boolean;
    effects?: boolean;
    quality?: string;
    movementKeys?: import("../../../packages/shared/src/movement").MovementKeys;
  };
}
export interface AdminStatus {
  operations?: {
    api?: {
      scope: string;
      startedAt: string;
      routes: {
        route: string;
        requests: number;
        errors: number;
        serverErrors: number;
        averageMs: number;
        maxMs: number;
      }[];
    };
    realtime: string;
    realtimeMetrics?:
      | import("../../../apps/realtime/src/metrics").RealtimeMetricsSnapshot
      | null;
    storage: { provider: string; status: string };
    storageOperations: {
      cleanup: {
        pending: number;
        retrying: number;
        highest_attempts: number | null;
        oldest_pending_at: string | null;
      };
      integrity: {
        orphan_objects: number;
        missing_objects: number;
        size_mismatches: number;
      };
    } | null;
    recovery: {
      recoverable_matches: number;
      oldest_checkpoint: string | null;
    } | null;
    maintenance: {
      name: string;
      data: Record<string, unknown>;
      updated_at: string;
    }[];
    backups?: ReturnType<
      typeof import("../../../packages/platform/src/backupStatus").projectBackupStatus
    > | null;
  };
  database: string;
  redis: string;
  totals: { users: number; sessions: number };
  flags: { key: string; enabled: boolean }[];
  errors: {
    id: string;
    component: string;
    message: string;
    created_at: string;
  }[];
}
export interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  role: string;
  disabled: boolean;
}
