"use client";
import type {
  Person,
  FriendsData,
  ChatRoomData,
  ChatData,
  ChatMessage,
  Notification,
  Attachment,
} from "./models";
import { GroupManager, ThreadDirectory, ThreadTools } from "./ChatOrganization";
import {
  CustomEmoji,
  EmojiPicker,
  GifPicker,
  isGifImageUrl,
} from "./ChatMedia";
import { LinkPreview } from "./LinkPreview";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getGameSocket } from "../../../packages/game-runtime/src/socket";
import {
  MessageCircle,
  UserPlus,
  Check,
  X,
  Search,
  Send,
  Reply,
  Smile,
  Pencil,
  Trash2,
  Pin,
  Copy,
  BarChart3,
  Hash,
  Plus,
  RefreshCw,
  Heart,
  VolumeX,
  Paperclip,
  Mic,
  Square,
  MessagesSquare,
} from "lucide-react";
import {
  api,
  Avatar,
  Empty,
  field,
  Heading,
  Notice,
  Panel,
  ResourceState,
  time,
  useResource,
  useSession,
} from "./ui";

interface PresenceUpdate {
  userId: string;
  status: string;
  gameId?: string;
}
interface RealtimeResponse<T> {
  data?: T;
  error?: string;
}
interface TypingUpdate {
  roomId: string;
  userId: string;
  username: string;
  expiresAt: number;
}
interface PendingAttachment {
  clientId: string;
  filename: string;
  bytes: number;
  progress: number;
  status: "uploading" | "ready" | "error";
  attachment?: Attachment;
  error?: string;
}
interface VoiceCapture {
  recorder: MediaRecorder;
  stream: MediaStream;
  interval: ReturnType<typeof setInterval>;
  deadline: ReturnType<typeof setTimeout>;
  discard: boolean;
}

function fileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.ceil(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ChatAttachment({ attachment }: { attachment: Attachment }) {
  const url = `/api/chat/files/${attachment.id}`;
  return (
    <div className="chat-attachment" style={{ marginTop: 10, maxWidth: 420 }}>
      {attachment.mime.startsWith("image/") && (
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={attachment.filename}
            loading="lazy"
            style={{
              display: "block",
              maxWidth: "100%",
              maxHeight: 300,
              objectFit: "contain",
              borderRadius: 8,
            }}
          />
        </a>
      )}
      {attachment.mime.startsWith("audio/") && (
        <audio
          controls
          preload="none"
          src={url}
          aria-label={`Play ${attachment.filename}`}
          style={{ width: "100%" }}
        />
      )}
      {attachment.mime.startsWith("video/") && (
        <video
          controls
          preload="metadata"
          src={url}
          aria-label={`Play ${attachment.filename}`}
          style={{ width: "100%", maxHeight: 300, borderRadius: 8 }}
        />
      )}
      <a className="text-link" href={url} download={attachment.filename}>
        <Paperclip size={13} /> {attachment.filename}{" "}
        <small className="muted">{fileSize(attachment.bytes)}</small>
      </a>
    </div>
  );
}

function useLiveRefresh(
  refresh: () => Promise<void>,
  events: readonly string[],
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const socket = getGameSocket();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refreshRef.current(), 150);
    };
    for (const event of events) socket.on(event, update);
    socket.on("connect", update);
    return () => {
      clearTimeout(timer);
      for (const event of events) socket.off(event, update);
      socket.off("connect", update);
    };
  }, [events]);
}

const friendEvents = ["friend:request", "friend:update"] as const;
const notificationEvents = ["notification:create"] as const;
const roomListEvents = [
  "notification:create",
  "chat:message:create",
  "chat:message:update",
  "chat:message:delete",
  "chat:thread:update",
  "chat:thread:read",
  "chat:room:update",
  "chat:room:removed",
] as const;
// Several views can use the shared connection. Keep a room subscribed until
// its final view closes, including React Strict Mode's effect replay.
const roomSubscriptions = new Map<string, number>();

function useLivePresence() {
  const [presence, setPresence] = useState<Record<string, PresenceUpdate>>({});
  useEffect(() => {
    const socket = getGameSocket();
    let active = true;
    let updateSequence = 0;
    const latestUpdates = new Map<string, number>();
    const update = (value: PresenceUpdate) => {
      if (
        active &&
        typeof value?.userId === "string" &&
        typeof value.status === "string"
      ) {
        latestUpdates.set(value.userId, ++updateSequence);
        setPresence((current) => ({ ...current, [value.userId]: value }));
      }
    };
    const snapshot = () => {
      const startedAt = updateSequence;
      socket
        .timeout(5000)
        .emit(
          "presence:snapshot",
          {},
          (
            timeout: Error | null,
            response?: RealtimeResponse<PresenceUpdate[]>,
          ) => {
            if (!active || timeout || !Array.isArray(response?.data)) return;
            const values = response.data;
            // A status update received while the snapshot is in flight is newer
            // than that snapshot, including a friend's switch to invisible.
            setPresence((current) =>
              Object.fromEntries(
                values.map((value) => [
                  value.userId,
                  (latestUpdates.get(value.userId) || 0) > startedAt
                    ? current[value.userId] || value
                    : value,
                ]),
              ),
            );
          },
        );
    };
    const disconnect = () => setPresence({});
    socket.on("presence:update", update);
    socket.on("connect", snapshot);
    socket.on("friend:update", snapshot);
    socket.on("disconnect", disconnect);
    if (socket.connected) snapshot();
    return () => {
      active = false;
      socket.off("presence:update", update);
      socket.off("connect", snapshot);
      socket.off("friend:update", snapshot);
      socket.off("disconnect", disconnect);
    };
  }, []);
  return presence;
}

function presenceLabel(value: PresenceUpdate) {
  return (
    (
      {
        online: "Online",
        idle: "Away",
        dnd: "Do not disturb",
        offline: "Offline",
        invisible: "Invisible",
      } as Record<string, string>
    )[value.status] || value.status
  );
}

export function FriendsPage() {
  const resource = useResource<FriendsData>("friends"),
    [tab, setTab] = useState("Friends"),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<Person[] | null>(null),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false),
    router = useRouter();
  const presence = useLivePresence();
  useLiveRefresh(resource.refresh, friendEvents);
  async function act(id: string, action: string, body = {}) {
    setError("");
    setSuccess("");
    try {
      await api(`friends/${id}/${action}`, "POST", body);
      await resource.refresh();
      setSuccess("Your circle is up to date.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function message(id: string) {
    try {
      const room = await api<ChatRoomData>("chat/rooms", "POST", {
        userIds: [id],
      });
      router.push(`/chat?room=${room.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const list =
    resource.data?.[
      tab === "Friends"
        ? "friends"
        : tab === "Incoming"
          ? "incoming"
          : tab === "Sent"
            ? "outgoing"
            : "blocked"
    ] || [];
  return (
    <>
      <Heading
        eyebrow="YOUR CIRCLE"
        title="Good company."
        description="The people who make your space feel like home."
      />
      <Panel className="friend-search">
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              setResults(
                await api<Person[]>(`users?q=${encodeURIComponent(query)}`),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Search size={19} />
          <input
            aria-label="Find a friend"
            placeholder="Find someone by username or display name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            required
          />
          <button className="button" disabled={busy}>
            {busy ? "Finding…" : "Find your people"}
          </button>
        </form>
        {results && (
          <div className="search-person-results">
            {results.length ? (
              results.map((person) => (
                <div className="person-row" key={person.id}>
                  <Avatar user={person} />
                  <Link href={`/profile/${person.id}`}>
                    <strong>{person.displayName}</strong>
                    <small>@{person.username}</small>
                  </Link>
                  <button
                    className="button secondary small"
                    onClick={async () => {
                      try {
                        await api("friends/request", "POST", {
                          userId: person.id,
                        });
                        setSuccess(`Request sent to ${person.displayName}.`);
                        await resource.refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <UserPlus size={15} /> Add friend
                  </button>
                </div>
              ))
            ) : (
              <Empty title="No one by that name">
                Try their Tell Aviv username.
              </Empty>
            )}
          </div>
        )}
      </Panel>
      <Notice>{error}</Notice>
      <Notice success>{success}</Notice>
      <div className="tabs">
        {["Friends", "Incoming", "Sent", "Blocked"].map((value) => (
          <button
            onClick={() => setTab(value)}
            className={tab === value ? "active" : ""}
            key={value}
          >
            {value}
            {value === "Incoming" && !!resource.data?.incoming.length && (
              <span className="count">{resource.data.incoming.length}</span>
            )}
          </button>
        ))}
      </div>
      <ResourceState
        loading={resource.loading}
        error={resource.error}
        retry={resource.refresh}
      />
      {list.length ? (
        <div className="friend-grid">
          {list.map((friend) => (
            <article
              className="panel friend-card"
              key={friend.userId || friend.id}
            >
              <div className="friend-card-top">
                <Avatar user={friend} size="large-avatar" />
                <Link href={`/profile/${friend.userId || friend.id}`}>
                  <h3>{friend.nickname || friend.displayName}</h3>
                  <span className="muted">@{friend.username}</span>
                </Link>
                {friend.favorite && (
                  <Heart size={16} className="accent" fill="currentColor" />
                )}
              </div>
              {friend.status && (
                <p className="friend-status">{friend.status}</p>
              )}
              {presence[friend.userId || friend.id] && (
                <p
                  className="friend-status"
                  aria-label={`Presence of ${friend.displayName}`}
                >
                  {presenceLabel(presence[friend.userId || friend.id])}
                </p>
              )}
              <div className="button-row">
                {tab === "Friends" ? (
                  <>
                    <button
                      className="button secondary small"
                      onClick={() => void message(friend.id)}
                    >
                      <MessageCircle size={14} /> Message
                    </button>
                    <button
                      className="icon-button"
                      title="Favorite"
                      aria-label="Toggle favorite friend"
                      onClick={() =>
                        void act(friend.id, "preferences", {
                          favorite: !friend.favorite,
                        })
                      }
                    >
                      <Heart
                        size={16}
                        fill={friend.favorite ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      className="icon-button"
                      title="Mute"
                      aria-label="Toggle mute friend"
                      onClick={() =>
                        void act(friend.id, "preferences", {
                          muted: !friend.muted,
                        })
                      }
                    >
                      <VolumeX size={16} />
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() => void act(friend.id, "remove")}
                    >
                      Remove
                    </button>
                  </>
                ) : tab === "Incoming" ? (
                  <>
                    <button
                      className="button small"
                      onClick={() =>
                        void act(friend.userId ?? friend.id, "accept")
                      }
                    >
                      <Check size={15} /> Accept
                    </button>
                    <button
                      className="button secondary small"
                      onClick={() =>
                        void act(friend.userId ?? friend.id, "decline")
                      }
                    >
                      Decline
                    </button>
                  </>
                ) : tab === "Sent" ? (
                  <button
                    className="button secondary small"
                    onClick={() =>
                      void act(friend.userId ?? friend.id, "cancel")
                    }
                  >
                    Cancel request
                  </button>
                ) : (
                  <button
                    className="button secondary small"
                    onClick={() => void act(friend.id, "unblock")}
                  >
                    Unblock
                  </button>
                )}
              </div>
              {tab === "Friends" && (
                <details>
                  <summary>Private friend preferences</summary>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(friend.id, "preferences", {
                        nickname: field(e.currentTarget, "nickname"),
                        note: field(e.currentTarget, "note"),
                        closeFriend:
                          new FormData(e.currentTarget).get("closeFriend") ===
                          "on",
                      });
                    }}
                  >
                    <label>
                      Nickname
                      <input
                        name="nickname"
                        maxLength={60}
                        defaultValue={friend.nickname}
                      />
                    </label>
                    <label>
                      Private note
                      <textarea
                        name="note"
                        maxLength={500}
                        defaultValue={friend.note}
                      />
                    </label>
                    <label className="checkbox">
                      <input
                        name="closeFriend"
                        type="checkbox"
                        defaultChecked={friend.closeFriend}
                      />{" "}
                      Close friend
                    </label>
                    <button className="button secondary small">
                      Save preferences
                    </button>
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() => void act(friend.id, "block")}
                    >
                      Block user
                    </button>
                  </form>
                </details>
              )}
            </article>
          ))}
        </div>
      ) : (
        !resource.loading && (
          <Panel>
            <Empty
              title={
                tab === "Friends"
                  ? "Everyone starts somewhere"
                  : tab === "Incoming"
                    ? "All caught up"
                    : tab === "Sent"
                      ? "No pending requests"
                      : "Your blocked list is clear"
              }
              icon="☺"
            >
              {tab === "Friends"
                ? "Search for a friend above. A good conversation is one request away."
                : "You’re up to date with your circle."}
            </Empty>
          </Panel>
        )
      )}
    </>
  );
}
function MessageText({
  text,
  serverId,
}: {
  text: string;
  serverId?: string | null;
}) {
  const lines = text.split("\n");
  return (
    <div className="message-text">
      {lines.map((line, index) => (
        <div key={index}>
          {line
            .split(
              /(:emoji:[a-f0-9-]{36}:|https:\/\/[^\s]+|\*\*[^*]+\*\*|`[^`]+`)/g,
            )
            .map((part, i) =>
              part.startsWith(":emoji:") ? (
                <CustomEmoji
                  key={i}
                  id={part.slice(7, -1)}
                  serverId={serverId}
                />
              ) : part.startsWith("https://") ? (
                <a
                  href={part}
                  target="_blank"
                  rel="noreferrer noopener"
                  key={i}
                >
                  {isGifImageUrl(part) ? (
                    <img
                      src={part}
                      alt="GIF"
                      loading="lazy"
                      style={{
                        display: "block",
                        maxWidth: 260,
                        maxHeight: 220,
                        objectFit: "contain",
                        borderRadius: 8,
                      }}
                    />
                  ) : (
                    part
                  )}
                </a>
              ) : part.startsWith("**") ? (
                <strong key={i}>{part.slice(2, -2)}</strong>
              ) : part.startsWith("`") ? (
                <code key={i}>{part.slice(1, -1)}</code>
              ) : (
                part || <br key={i} />
              ),
            )}
        </div>
      ))}
    </div>
  );
}
export function ChatRoom({
  roomId = "global",
  title,
  compact = false,
  threadId,
  onClose,
}: {
  roomId?: string;
  title?: string;
  compact?: boolean;
  threadId?: string;
  onClose?: () => void;
}) {
  const { user } = useSession(),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [pinned, setPinned] = useState(false),
    [openThread, setOpenThread] = useState<string | null>(null),
    [browseThreads, setBrowseThreads] = useState(false),
    [showEmoji, setShowEmoji] = useState(false),
    [showGifs, setShowGifs] = useState(false),
    resource = useResource<ChatData>(
      `chat/${roomId}/${threadId ? `threads/${threadId}` : "messages"}${search || pinned ? `?q=${encodeURIComponent(search)}&pinned=${pinned}` : ""}`,
    );
  const [content, setContent] = useState(""),
    [reply, setReply] = useState<ChatMessage | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [editText, setEditText] = useState(""),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false),
    [poll, setPoll] = useState(false),
    [pollQuestion, setPollQuestion] = useState(""),
    [pollOptions, setPollOptions] = useState(""),
    [older, setOlder] = useState<ChatMessage[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    end = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false),
    [liveError, setLiveError] = useState(""),
    [typing, setTyping] = useState<Record<string, TypingUpdate>>({}),
    lastTyping = useRef(0),
    liveRoom = useRef<string | null>(null),
    refreshRef = useRef(resource.refresh);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]),
    [canRecord, setCanRecord] = useState(false),
    [askingMicrophone, setAskingMicrophone] = useState(false),
    [recording, setRecording] = useState(false),
    [recordSeconds, setRecordSeconds] = useState(0),
    uploads = useRef(new Map<string, XMLHttpRequest>()),
    uploadEpoch = useRef(0),
    voice = useRef<VoiceCapture | null>(null),
    pendingRef = useRef(attachments),
    fileInput = useRef<HTMLInputElement>(null);
  pendingRef.current = attachments;
  const uploading = attachments.some((item) => item.status === "uploading");
  const readyAttachments = attachments.filter(
    (item) => item.status === "ready" && item.attachment,
  );
  useEffect(() => {
    setCanRecord(
      typeof MediaRecorder !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].some((type) =>
          MediaRecorder.isTypeSupported(type),
        ),
    );
  }, []);
  useEffect(() => {
    uploadEpoch.current++;
    setAttachments([]);
    setRecording(false);
    setAskingMicrophone(false);
    setRecordSeconds(0);
    return () => {
      uploadEpoch.current++;
      for (const request of uploads.current.values()) request.abort();
      uploads.current.clear();
      if (voice.current) {
        const capture = voice.current;
        capture.discard = true;
        clearInterval(capture.interval);
        clearTimeout(capture.deadline);
        if (capture.recorder.state !== "inactive") capture.recorder.stop();
        capture.stream.getTracks().forEach((track) => track.stop());
        voice.current = null;
      }
    };
  }, [roomId]);
  refreshRef.current = resource.refresh;
  const messages = [
    ...new Map(
      [
        ...(resource.data?.thread?.root ? [resource.data.thread.root] : []),
        ...older,
        ...(resource.data?.messages || []),
      ].map((message) => [message.id, message]),
    ).values(),
  ];
  const typingPeople = Object.values(typing).filter(
    (value) => value.expiresAt > Date.now() && value.userId !== user.id,
  );
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (threadId) panel.current?.scrollIntoView({ block: "start" });
  }, [threadId]);
  useEffect(() => {
    const socket = getGameSocket();
    roomSubscriptions.set(roomId, (roomSubscriptions.get(roomId) || 0) + 1);
    let active = true;
    let subscribedRoom: string | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshing = false;
    let refreshAgain = false;
    const refresh = async () => {
      if (!active) return;
      if (refreshing) {
        refreshAgain = true;
        return;
      }
      refreshing = true;
      do {
        refreshAgain = false;
        await refreshRef.current();
      } while (refreshAgain && active);
      refreshing = false;
    };
    const changed = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refresh(), 100);
    };
    const created = (payload: { authorId?: string }) => {
      if (payload?.authorId)
        setTyping((current) => {
          const next = { ...current };
          delete next[payload.authorId!];
          return next;
        });
      changed();
    };
    const edited = (payload: { id?: string; content?: string }) => {
      if (
        typeof payload?.id === "string" &&
        typeof payload.content === "string"
      )
        setOlder((current) =>
          current.map((message) =>
            message.id === payload.id
              ? {
                  ...message,
                  content: payload.content!,
                  editedAt: new Date().toISOString(),
                }
              : message,
          ),
        );
      changed();
    };
    const deleted = (payload: { id?: string }) => {
      if (typeof payload?.id === "string")
        setOlder((current) =>
          current.map((message) =>
            message.id === payload.id
              ? {
                  ...message,
                  content: "",
                  deletedAt: new Date().toISOString(),
                  reactions: [],
                  poll: null,
                  attachments: [],
                  pinned: false,
                }
              : message,
          ),
        );
      changed();
    };
    const reacted = (payload: {
      messageId?: string;
      userId?: string;
      emoji?: string;
      added?: boolean;
    }) => {
      const { messageId, userId: reactingUser, emoji, added } = payload || {};
      if (
        typeof messageId === "string" &&
        typeof reactingUser === "string" &&
        typeof emoji === "string"
      )
        setOlder((current) =>
          current.map((message) => {
            if (message.id !== messageId) return message;
            const reactions = message.reactions.filter(
              (reaction) =>
                reaction.userId !== reactingUser || reaction.emoji !== emoji,
            );
            if (added) reactions.push({ userId: reactingUser, emoji });
            return { ...message, reactions };
          }),
        );
      changed();
    };
    const receiveTyping = (value: TypingUpdate) => {
      if (
        value?.roomId !== subscribedRoom ||
        typeof value.userId !== "string" ||
        typeof value.username !== "string" ||
        typeof value.expiresAt !== "number"
      )
        return;
      setTyping((current) => ({ ...current, [value.userId]: value }));
    };
    const pinChanged = (value: { messageId?: string; pinned?: boolean }) => {
      if (
        typeof value?.messageId === "string" &&
        typeof value.pinned === "boolean"
      )
        setOlder((current) =>
          current.map((message) =>
            message.id === value.messageId
              ? { ...message, pinned: value.pinned! }
              : message,
          ),
        );
      changed();
    };
    const connect = () => {
      setLiveError("");
      socket
        .timeout(5000)
        .emit(
          "room:subscribe",
          { roomId },
          (
            timeout: Error | null,
            response?: RealtimeResponse<{ roomId: string }>,
          ) => {
            if (!active) {
              if (response?.data?.roomId && !roomSubscriptions.has(roomId))
                socket.emit("room:unsubscribe", {
                  roomId: response.data.roomId,
                });
              return;
            }
            if (timeout || response?.error || !response?.data?.roomId) {
              setLive(false);
              setLiveError(
                response?.error ||
                  "Live updates are unavailable. Refresh messages to catch up.",
              );
              return;
            }
            subscribedRoom = response.data.roomId;
            liveRoom.current = subscribedRoom;
            setLive(true);
            // Fetch durable history again after reconnecting to recover missed events.
            void refresh();
          },
        );
    };
    const disconnected = () => {
      setLive(false);
      setTyping({});
      liveRoom.current = null;
    };
    const failed = () => {
      disconnected();
      setLiveError(
        "Live updates are unavailable. Refresh messages to catch up.",
      );
    };
    socket.on("connect", connect);
    socket.on("disconnect", disconnected);
    socket.on("connect_error", failed);
    socket.on("chat:message:create", created);
    socket.on("chat:message:update", edited);
    socket.on("chat:message:delete", deleted);
    socket.on("chat:reaction:update", reacted);
    socket.on("chat:pin:update", pinChanged);
    socket.on("chat:poll:update", changed);
    socket.on("chat:thread:update", changed);
    socket.on("chat:typing", receiveTyping);
    if (socket.connected) connect();
    const expiry = setInterval(
      () =>
        setTyping((current) => {
          const entries = Object.entries(current);
          const retained = entries.filter(
            ([, value]) => value.expiresAt > Date.now(),
          );
          return retained.length === entries.length
            ? current
            : Object.fromEntries(retained);
        }),
      1000,
    );
    return () => {
      active = false;
      const subscribers = (roomSubscriptions.get(roomId) || 1) - 1;
      if (subscribers) roomSubscriptions.set(roomId, subscribers);
      else roomSubscriptions.delete(roomId);
      clearTimeout(refreshTimer);
      clearInterval(expiry);
      liveRoom.current = null;
      if (subscribedRoom && !subscribers)
        socket.emit("room:unsubscribe", { roomId: subscribedRoom });
      socket.off("connect", connect);
      socket.off("disconnect", disconnected);
      socket.off("connect_error", failed);
      socket.off("chat:message:create", created);
      socket.off("chat:message:update", edited);
      socket.off("chat:message:delete", deleted);
      socket.off("chat:reaction:update", reacted);
      socket.off("chat:pin:update", pinChanged);
      socket.off("chat:poll:update", changed);
      socket.off("chat:thread:update", changed);
      socket.off("chat:typing", receiveTyping);
    };
  }, [roomId]);
  function compose(value: string) {
    setContent(value);
    const now = Date.now();
    if (value.trim() && liveRoom.current && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      getGameSocket().emit(
        "chat:typing:start",
        { roomId: liveRoom.current },
        () => {},
      );
    }
  }
  async function uploadFiles(files: readonly File[]) {
    if (!files.length) return;
    if (pendingRef.current.length + files.length > 10) {
      setError(
        "A message can include up to 10 files. Remove an attachment before adding more.",
      );
      return;
    }
    const epoch = uploadEpoch.current;
    const items = files.map((file) => ({
      clientId: crypto.randomUUID(),
      filename: file.name,
      bytes: file.size,
      progress: 0,
      status: "uploading" as const,
    }));
    pendingRef.current = [...pendingRef.current, ...items];
    setAttachments((current) => [...current, ...items]);
    setError("");
    await Promise.all(
      items.map(async (item, index) => {
        try {
          const attachment = await new Promise<Attachment>(
            (resolve, reject) => {
              const request = new XMLHttpRequest();
              uploads.current.set(item.clientId, request);
              request.open("POST", `/api/chat/${roomId}/files`);
              request.withCredentials = true;
              request.timeout = 120_000;
              request.upload.onprogress = (event) => {
                if (epoch === uploadEpoch.current && event.lengthComputable)
                  setAttachments((current) =>
                    current.map((entry) =>
                      entry.clientId === item.clientId
                        ? {
                            ...entry,
                            progress: Math.round(
                              (event.loaded / event.total) * 100,
                            ),
                          }
                        : entry,
                    ),
                  );
              };
              request.onload = () => {
                try {
                  const result = JSON.parse(
                    request.responseText,
                  ) as RealtimeResponse<Attachment>;
                  if (
                    request.status < 200 ||
                    request.status >= 300 ||
                    result.error ||
                    !result.data
                  )
                    reject(
                      new Error(
                        result.error || "The file could not be uploaded.",
                      ),
                    );
                  else resolve(result.data);
                } catch {
                  reject(
                    new Error("The upload returned an unreadable response."),
                  );
                }
              };
              request.onerror = () =>
                reject(
                  new Error(
                    "The upload could not finish. Check your connection and try again.",
                  ),
                );
              request.ontimeout = () =>
                reject(
                  new Error(
                    "The upload timed out. Try uploading the file again.",
                  ),
                );
              request.onabort = () => reject(new Error("Upload cancelled."));
              const form = new FormData();
              form.append("file", files[index]);
              request.send(form);
            },
          );
          if (epoch === uploadEpoch.current)
            setAttachments((current) =>
              current.map((entry) =>
                entry.clientId === item.clientId
                  ? { ...entry, attachment, progress: 100, status: "ready" }
                  : entry,
              ),
            );
        } catch (reason) {
          if (epoch === uploadEpoch.current)
            setAttachments((current) =>
              current.map((entry) =>
                entry.clientId === item.clientId
                  ? {
                      ...entry,
                      status: "error",
                      error:
                        reason instanceof Error
                          ? reason.message
                          : "The upload failed.",
                    }
                  : entry,
              ),
            );
        } finally {
          uploads.current.delete(item.clientId);
        }
      }),
    );
  }
  async function removeAttachment(item: PendingAttachment) {
    setError("");
    if (item.status === "ready" && item.attachment) {
      try {
        await api(`chat/files/${item.attachment.id}`, "DELETE", {});
      } catch (reason) {
        setError((reason as Error).message);
        return;
      }
    }
    uploads.current.get(item.clientId)?.abort();
    setAttachments((current) =>
      current.filter((entry) => entry.clientId !== item.clientId),
    );
  }
  function stopVoice(discard = false) {
    const capture = voice.current;
    if (!capture) return;
    capture.discard = discard;
    if (capture.recorder.state !== "inactive") capture.recorder.stop();
  }
  async function startVoice() {
    if (
      askingMicrophone ||
      recording ||
      uploading ||
      sending ||
      attachments.length >= 10
    )
      return;
    const epoch = uploadEpoch.current;
    setError("");
    setAskingMicrophone(true);
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (epoch !== uploadEpoch.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
        (type) => MediaRecorder.isTypeSupported(type),
      );
      if (!mime)
        throw new Error(
          "Voice recording is unavailable in this browser. You can attach an audio file.",
        );
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks: Blob[] = [],
        startedAt = Date.now();
      const capture: VoiceCapture = {
        recorder,
        stream,
        discard: false,
        interval: setInterval(
          () =>
            setRecordSeconds(
              Math.min(60, Math.floor((Date.now() - startedAt) / 1000)),
            ),
          250,
        ),
        deadline: setTimeout(() => stopVoice(), 60_000),
      };
      voice.current = capture;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        capture.discard = true;
        setError("The voice recording stopped unexpectedly. Please try again.");
      };
      recorder.onstop = () => {
        clearInterval(capture.interval);
        clearTimeout(capture.deadline);
        capture.stream.getTracks().forEach((track) => track.stop());
        if (voice.current === capture) voice.current = null;
        if (epoch !== uploadEpoch.current) return;
        setRecording(false);
        if (capture.discard) return;
        const type = recorder.mimeType.split(";")[0];
        const blob = new Blob(chunks, { type });
        if (!blob.size) {
          setError("The recording was empty. Please try again.");
          return;
        }
        const extension = type === "audio/mp4" ? "m4a" : "webm";
        void uploadFiles([
          new File([blob], `voice-${Date.now()}.${extension}`, { type }),
        ]);
      };
      recorder.start(1000);
      setRecordSeconds(0);
      setRecording(true);
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      const failedCapture = voice.current;
      if (failedCapture && failedCapture.stream === stream) {
        clearInterval(failedCapture.interval);
        clearTimeout(failedCapture.deadline);
        failedCapture.discard = true;
        if (failedCapture.recorder.state !== "inactive")
          failedCapture.recorder.stop();
        voice.current = null;
      }
      if (epoch === uploadEpoch.current)
        setError(
          reason instanceof DOMException && reason.name === "NotAllowedError"
            ? "Microphone permission was not granted. You can attach an audio file instead."
            : reason instanceof Error
              ? reason.message
              : "The microphone could not be opened.",
        );
    } finally {
      if (epoch === uploadEpoch.current) setAskingMicrophone(false);
    }
  }
  useEffect(() => {
    setOlder([]);
    setCursor(null);
    setReply(null);
    setError("");
    setOpenThread(null);
    setBrowseThreads(false);
    const location = new URLSearchParams(window.location.search);
    if (!threadId && location.get("room") === roomId && location.get("thread"))
      setOpenThread(location.get("thread"));
  }, [roomId, threadId, search, pinned]);
  useEffect(() => {
    const latest = resource.data?.messages?.at(-1);
    if (latest && !search && !pinned)
      void api(
        `chat/${roomId}/${threadId ? `threads/${threadId}/read` : "read"}`,
        "POST",
        { messageId: latest.id },
      ).catch(() => {});
  }, [resource.data, roomId, threadId, search, pinned]);
  async function change(path: string, method = "POST", body: unknown = {}) {
    setError("");
    try {
      await api(path, method, body);
      await resource.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (
      sending ||
      uploading ||
      recording ||
      askingMicrophone ||
      resource.data?.thread?.archivedAt
    )
      return;
    setSending(true);
    setError("");
    try {
      await api(`chat/${roomId}/messages`, "POST", {
        content,
        attachmentIds: readyAttachments.map((item) => item.attachment!.id),
        ...(reply ? { replyTo: reply.id } : {}),
        ...(threadId ? { threadId } : {}),
        ...(poll
          ? {
              poll: {
                question: pollQuestion,
                options: pollOptions
                  .split("\n")
                  .map((v) => v.trim())
                  .filter(Boolean),
              },
            }
          : {}),
      });
      setContent("");
      setAttachments([]);
      setReply(null);
      setPoll(false);
      setPollQuestion("");
      setPollOptions("");
      await resource.refresh();
      end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <div
      style={{ minWidth: 0, display: "grid", gap: 16, alignContent: "start" }}
    >
      <section
        ref={panel}
        className={`chat-room panel ${compact ? "compact-chat" : ""}`}
        aria-label={threadId ? "Chat thread" : "Chat conversation"}
      >
        <div className="chat-room-heading">
          <div>
            <span className="channel-mark">
              <Hash size={21} />
            </span>
            <span>
              <h2>
                {threadId
                  ? resource.data?.thread?.name || "Thread"
                  : title || resource.data?.room?.name || "Global chat"}
              </h2>
              <small>
                {threadId
                  ? "Replies stay together in this conversation."
                  : resource.data?.room?.kind === "global"
                    ? "The place where everyone meets."
                    : "Your conversation, all in one place."}
                {live ? " · Live" : " · Connecting…"}
              </small>
            </span>
          </div>
          {threadId ? (
            <button
              className="icon-button"
              aria-label="Close thread"
              onClick={onClose}
            >
              <X size={17} />
            </button>
          ) : (
            <button
              className={`icon-button ${browseThreads ? "selected" : ""}`}
              aria-label="Browse threads"
              title="Browse threads"
              onClick={() => setBrowseThreads(!browseThreads)}
            >
              <MessagesSquare size={17} />
            </button>
          )}
          <button
            className={`icon-button ${pinned ? "selected" : ""}`}
            title="Pinned messages"
            aria-label="Show pinned messages"
            onClick={() => setPinned(!pinned)}
          >
            <Pin size={17} />
          </button>
          <button
            className="icon-button"
            title="Refresh messages"
            aria-label="Refresh messages"
            onClick={() => void resource.refresh()}
          >
            <RefreshCw size={17} />
          </button>
        </div>
        {browseThreads && !threadId && (
          <ThreadDirectory roomId={roomId} open={setOpenThread} />
        )}
        {threadId && (
          <ThreadTools
            roomId={roomId}
            threadId={threadId}
            thread={resource.data?.thread}
            refresh={resource.refresh}
          />
        )}
        <form
          className="chat-search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(query);
          }}
        >
          <Search size={15} />
          <input
            aria-label="Search this conversation"
            placeholder="Search this conversation…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="text-button">Search</button>
          {search && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setQuery("");
                setSearch("");
              }}
            >
              Clear
            </button>
          )}
        </form>
        <ResourceState
          loading={resource.loading}
          error={resource.error}
          retry={resource.refresh}
        />
        <div className="chat-messages" aria-live="polite">
          {threadId && resource.data?.thread && !resource.data.thread.root && (
            <p className="muted">
              The original message was removed. This thread’s replies are
              preserved.
            </p>
          )}
          {(cursor === null ? resource.data?.nextCursor : cursor) && (
            <button
              className="button secondary small load-history"
              onClick={async () => {
                try {
                  const page = await api<ChatData>(
                    `chat/${roomId}/${threadId ? `threads/${threadId}` : "messages"}?before=${cursor === null ? resource.data?.nextCursor : cursor}${search ? `&q=${encodeURIComponent(search)}` : ""}${pinned ? "&pinned=true" : ""}`,
                  );
                  setOlder((previous) => [...page.messages, ...previous]);
                  setCursor(page.nextCursor || "");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Earlier messages
            </button>
          )}
          {messages.length
            ? messages.map((message) => (
                <article
                  id={`${threadId ? `thread-${threadId}-` : ""}message-${message.id}`}
                  className={`message ${message.deletedAt ? "deleted-message" : ""}`}
                  key={message.id}
                >
                  <Link href={`/profile/${message.authorId}`}>
                    <Avatar user={message} />
                  </Link>
                  <div className="message-body">
                    <div className="message-byline">
                      <Link href={`/profile/${message.authorId}`}>
                        {message.displayName}
                      </Link>
                      <time
                        title={new Date(message.createdAt).toLocaleString()}
                      >
                        {time(message.createdAt)}
                      </time>
                      {message.editedAt && <small>edited</small>}
                      {message.pinned && <Pin size={12} />}
                    </div>
                    {message.replyTo && (
                      <button
                        className="reply-reference"
                        onClick={() =>
                          document
                            .getElementById(
                              `${threadId ? `thread-${threadId}-` : ""}message-${message.replyTo}`,
                            )
                            ?.scrollIntoView({ block: "center" })
                        }
                      >
                        <Reply size={12} /> Reply to{" "}
                        {messages.find((m) => m.id === message.replyTo)
                          ?.displayName || "an earlier message"}
                      </button>
                    )}
                    {editing === message.id ? (
                      <form
                        className="message-edit"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          await change(`chat/messages/${message.id}`, "PATCH", {
                            content: editText,
                          });
                          setEditing(null);
                        }}
                      >
                        <textarea
                          aria-label="Edit message"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          maxLength={4000}
                          required
                        />
                        <div className="button-row">
                          <button className="button small">Save</button>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <MessageText
                        serverId={resource.data?.room.serverId}
                        text={
                          message.deletedAt
                            ? "This message was deleted."
                            : message.content
                        }
                      />
                    )}
                    {!message.deletedAt &&
                      editing !== message.id &&
                      resource.data?.room.id && (
                        <LinkPreview
                          roomId={resource.data.room.id}
                          messageId={message.id}
                          content={message.content}
                        />
                      )}
                    {!threadId &&
                      (!!message.threadReplyCount || !!message.threadId) && (
                        <button
                          className="text-button"
                          onClick={() =>
                            setOpenThread(message.threadId || message.id)
                          }
                        >
                          <MessagesSquare size={13} />{" "}
                          {message.threadId
                            ? "View thread"
                            : `${message.threadReplyCount} thread ${message.threadReplyCount === 1 ? "reply" : "replies"}`}
                        </button>
                      )}
                    {!message.deletedAt &&
                      message.attachments?.map((attachment) => (
                        <ChatAttachment
                          key={attachment.id}
                          attachment={attachment}
                        />
                      ))}
                    {message.poll && !message.deletedAt && (
                      <div className="chat-poll">
                        <strong>{message.poll.question}</strong>
                        {message.poll.options?.map((option) => (
                          <button
                            key={option.id}
                            className={`poll-option ${option.voted ? "selected" : ""}`}
                            onClick={() => {
                              if (!message.poll) return;
                              const selected = message.poll.multiple
                                ? message.poll.options
                                    .filter(
                                      (o) => o.voted && o.id !== option.id,
                                    )
                                    .map((o) => o.id)
                                    .concat(option.voted ? [] : [option.id])
                                : [option.id];
                              void change(
                                `chat/polls/${message.poll.id}/vote`,
                                "POST",
                                { optionIds: selected },
                              );
                            }}
                          >
                            <span>
                              {option.voted && "✓ "}
                              {option.label}
                            </span>
                            <span>{option.votes} votes</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {!message.deletedAt && (
                      <div className="reaction-row">
                        {[
                          ...new Set(
                            (message.reactions || []).map(
                              (reaction) => reaction.emoji,
                            ),
                          ),
                        ].map((emoji) => (
                          <button
                            className={
                              message.reactions.some(
                                (reaction) =>
                                  reaction.emoji === emoji &&
                                  reaction.userId === user.id,
                              )
                                ? "selected"
                                : ""
                            }
                            key={emoji}
                            onClick={() =>
                              void change(
                                `chat/messages/${message.id}/reactions`,
                                message.reactions.some(
                                  (reaction) =>
                                    reaction.emoji === emoji &&
                                    reaction.userId === user.id,
                                )
                                  ? "DELETE"
                                  : "POST",
                                { emoji },
                              )
                            }
                          >
                            {/^e:[a-f0-9-]{36}$/.test(emoji) ? (
                              <CustomEmoji
                                id={emoji.slice(2)}
                                serverId={resource.data?.room.serverId}
                              />
                            ) : (
                              emoji
                            )}{" "}
                            {
                              message.reactions.filter(
                                (reaction) => reaction.emoji === emoji,
                              ).length
                            }
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {!message.deletedAt && (
                    <div className="message-actions">
                      <button
                        className="icon-button"
                        aria-label="Copy message ID"
                        title="Copy message ID"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(message.id);
                          } catch {
                            setError(`Message ID: ${message.id}`);
                          }
                        }}
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => setReply(message)}
                        aria-label="Reply"
                      >
                        <Reply size={14} />
                      </button>
                      {!threadId && (
                        <button
                          className="icon-button"
                          aria-label={
                            message.threadId ? "Open thread" : "Start thread"
                          }
                          title={
                            message.threadId ? "Open thread" : "Start thread"
                          }
                          onClick={() =>
                            setOpenThread(message.threadId || message.id)
                          }
                        >
                          <MessagesSquare size={14} />
                        </button>
                      )}
                      <button
                        className="icon-button"
                        onClick={() =>
                          void change(
                            `chat/messages/${message.id}/reactions`,
                            "POST",
                            { emoji: "✨" },
                          )
                        }
                        aria-label="React with sparkle"
                      >
                        <Smile size={14} />
                      </button>
                      <button
                        className="icon-button"
                        onClick={() =>
                          void change(
                            `chat/messages/${message.id}/pin`,
                            message.pinned ? "DELETE" : "POST",
                          )
                        }
                        aria-label={message.pinned ? "Unpin" : "Pin"}
                      >
                        <Pin size={14} />
                      </button>
                      {message.authorId === user.id && (
                        <>
                          <button
                            className="icon-button"
                            onClick={() => {
                              setEditing(message.id);
                              setEditText(message.content);
                            }}
                            aria-label="Edit"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="icon-button danger"
                            onClick={() =>
                              void change(
                                `chat/messages/${message.id}`,
                                "DELETE",
                              )
                            }
                            aria-label="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </article>
              ))
            : !resource.loading && (
                <Empty
                  title={
                    search ? "No matching messages" : "Say the first hello"
                  }
                  icon="✳"
                >
                  {search
                    ? "Try a different word or phrase."
                    : "A good conversation starts with a little curiosity."}
                </Empty>
              )}
          <div ref={end} />
        </div>
        <Notice>{error}</Notice>
        <Notice>{liveError}</Notice>
        <div className="composer-hint" role="status" aria-live="polite">
          {typingPeople.length
            ? `${typingPeople
                .map((person) => person.username)
                .slice(0, 3)
                .join(
                  ", ",
                )}${typingPeople.length > 3 ? " and others" : ""} ${typingPeople.length === 1 ? "is" : "are"} typing…`
            : ""}
        </div>
        {showEmoji && resource.data?.room.serverId && (
          <EmojiPicker
            serverId={resource.data.room.serverId}
            choose={(token) => {
              if (content.length + token.length + 1 > 4000) {
                setError("This message has no room for another emoji.");
                return;
              }
              compose(`${content} ${token}`.trimStart());
              setShowEmoji(false);
            }}
          />
        )}
        {showGifs && (
          <GifPicker
            choose={(url) => {
              if (content.length + url.length + 1 > 4000) {
                setError("This message has no room for a GIF URL.");
                return;
              }
              compose(`${content}\n${url}`.trimStart());
              setShowGifs(false);
            }}
          />
        )}
        <form className="chat-composer" onSubmit={send}>
          {!!attachments.length && (
            <div
              className="pending-attachments"
              aria-label="Pending attachments"
              style={{ display: "grid", gap: 8, padding: "10px 0" }}
            >
              {attachments.map((item) => (
                <div
                  key={item.clientId}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    padding: 8,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                >
                  <Paperclip size={16} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong
                      style={{ overflowWrap: "anywhere", fontSize: ".78rem" }}
                    >
                      {item.filename}
                    </strong>{" "}
                    <small className="muted">{fileSize(item.bytes)}</small>
                    {item.status === "uploading" && (
                      <div role="status">
                        <progress
                          max={100}
                          value={item.progress}
                          aria-label={`Upload ${item.filename}`}
                          style={{ width: "100%" }}
                        />
                        <small>
                          {item.progress < 100
                            ? `Uploading ${item.progress}%`
                            : "Finishing upload…"}
                        </small>
                      </div>
                    )}
                    {item.status === "ready" && (
                      <small role="status" style={{ display: "block" }}>
                        Ready to send
                      </small>
                    )}
                    {item.status === "error" && (
                      <small
                        role="alert"
                        style={{ display: "block", color: "var(--danger)" }}
                      >
                        {item.error}
                      </small>
                    )}
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove attachment ${item.filename}`}
                    disabled={sending}
                    onClick={() => void removeAttachment(item)}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {askingMicrophone && (
            <p role="status">Waiting for microphone permission…</p>
          )}
          {recording && (
            <div className="composer-reply" role="status">
              <Mic size={15} /> Recording {Math.floor(recordSeconds / 60)}:
              {String(recordSeconds % 60).padStart(2, "0")} / 1:00
              <button
                type="button"
                className="button small"
                aria-label="Stop voice recording"
                onClick={() => stopVoice()}
              >
                <Square size={13} /> Stop
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => stopVoice(true)}
              >
                Discard recording
              </button>
            </div>
          )}
          {reply && (
            <div className="composer-reply">
              <Reply size={14} /> Replying to {reply.displayName}
              <button
                type="button"
                className="icon-button"
                aria-label="Cancel reply"
                onClick={() => setReply(null)}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {poll && (
            <div className="poll-composer">
              <label>
                Poll question
                <input
                  value={pollQuestion}
                  onChange={(e) => setPollQuestion(e.target.value)}
                  required
                  maxLength={300}
                />
              </label>
              <label>
                Options, one per line
                <textarea
                  value={pollOptions}
                  onChange={(e) => setPollOptions(e.target.value)}
                  required
                  placeholder={"Option one\nOption two"}
                />
              </label>
            </div>
          )}
          <div className="composer-input">
            <input
              hidden
              ref={fileInput}
              type="file"
              multiple
              aria-label="Choose chat attachments"
              accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.docx,.pptx,.xlsx,.mp3,.wav,.webm,.m4a,.mp4"
              disabled={
                !!resource.data?.thread?.archivedAt ||
                sending ||
                recording ||
                askingMicrophone ||
                attachments.length >= 10
              }
              onChange={(event) => {
                void uploadFiles(Array.from(event.currentTarget.files || []));
                event.currentTarget.value = "";
              }}
            />
            <button
              className="icon-button"
              type="button"
              aria-label="Attach files"
              title="Attach files"
              disabled={
                sending ||
                recording ||
                askingMicrophone ||
                attachments.length >= 10
              }
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Start voice recording"
              title={
                canRecord
                  ? "Record a voice message (up to 60 seconds)"
                  : "Voice recording is unavailable in this browser"
              }
              disabled={
                !!resource.data?.thread?.archivedAt ||
                !canRecord ||
                sending ||
                uploading ||
                recording ||
                askingMicrophone ||
                attachments.length >= 10
              }
              onClick={() => void startVoice()}
            >
              <Mic size={18} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Create a poll"
              title="Create poll"
              disabled={!!resource.data?.thread?.archivedAt}
              onClick={() => setPoll(!poll)}
            >
              <BarChart3 size={18} />
            </button>
            <textarea
              aria-label={threadId ? "Thread message" : "Message"}
              disabled={!!resource.data?.thread?.archivedAt}
              placeholder={`Message ${title || resource.data?.room?.name || "global chat"}…`}
              value={content}
              onChange={(e) => compose(e.target.value)}
              maxLength={4000}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !poll) {
                  e.preventDefault();
                  if (content.trim() || readyAttachments.length) void send(e);
                }
              }}
            />
            {resource.data?.room.serverId && (
              <button
                className="icon-button"
                type="button"
                aria-label="Browse server emoji"
                title="Custom server emoji"
                disabled={!!resource.data?.thread?.archivedAt}
                onClick={() => {
                  setShowEmoji(!showEmoji);
                  setShowGifs(false);
                }}
              >
                ✦
              </button>
            )}
            <button
              className="icon-button"
              type="button"
              aria-label="Browse GIFs"
              title="Search GIFs"
              disabled={!!resource.data?.thread?.archivedAt}
              onClick={() => {
                setShowGifs(!showGifs);
                setShowEmoji(false);
              }}
            >
              GIF
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Add smile emoji"
              disabled={!!resource.data?.thread?.archivedAt}
              onClick={() => setContent(content + " ☺")}
            >
              <Smile size={19} />
            </button>
            <button
              className="send-button"
              aria-label={threadId ? "Send thread reply" : "Send message"}
              disabled={
                !!resource.data?.thread?.archivedAt ||
                sending ||
                uploading ||
                recording ||
                askingMicrophone ||
                (!content.trim() && !poll && !readyAttachments.length)
              }
            >
              <Send size={18} />
            </button>
          </div>
          <div className="composer-hint">
            Be yourself. Be good company.
            <span>Enter to send · Shift + Enter for a new line</span>
          </div>
        </form>
      </section>
      {!threadId && openThread && (
        <ChatRoom
          key={`${roomId}:${openThread}`}
          roomId={roomId}
          threadId={openThread}
          onClose={() => setOpenThread(null)}
        />
      )}
    </div>
  );
}
export function ChatPage() {
  const { user } = useSession(),
    rooms = useResource<ChatRoomData[]>("chat/rooms"),
    friends = useResource<FriendsData>("friends"),
    [room, setRoom] = useState("global"),
    [showNew, setShowNew] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState("");
  useLiveRefresh(rooms.refresh, roomListEvents);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("room");
    if (id) setRoom(id);
  }, []);
  useEffect(() => {
    const socket = getGameSocket();
    const removed = (event: { roomId?: string }) => {
      if (event?.roomId === room) setRoom("global");
    };
    socket.on("chat:room:removed", removed);
    return () => {
      socket.off("chat:room:removed", removed);
    };
  }, [room]);
  const current = rooms.data?.find((item) => item.id === room);
  return (
    <>
      <Heading
        eyebrow="STAY IN THE LOOP"
        title="The conversation."
        description="A hello, a good idea, or just a little company."
      />
      <div className="chat-layout">
        <aside className="panel chat-sidebar">
          <div className="panel-heading">
            <h2>Conversations</h2>
            <button
              className="icon-button"
              aria-label="New direct message"
              onClick={() => setShowNew(!showNew)}
            >
              <Plus size={17} />
            </button>
          </div>
          <button
            className={`room-item ${room === "global" ? "active" : ""}`}
            onClick={() => setRoom("global")}
          >
            <span className="global-room-icon">✳</span>
            <span>
              <strong>Global chat</strong>
              <small>A little bit of everyone</small>
            </span>
            <Hash size={14} />
          </button>
          <p className="eyebrow room-label">DIRECT MESSAGES</p>
          <ResourceState
            loading={rooms.loading}
            error={rooms.error}
            retry={rooms.refresh}
          />
          {rooms.data?.length
            ? rooms.data.map((item) => {
                const person =
                  item.kind === "group"
                    ? { displayName: item.name || "Group", avatar: item.icon }
                    : item.members?.find((member) => member.id !== user.id) || {
                        displayName: "Group",
                      };
                return (
                  <button
                    className={`room-item ${room === item.id ? "active" : ""}`}
                    key={item.id}
                    onClick={() => setRoom(item.id)}
                  >
                    <Avatar user={person} />
                    <span>
                      <strong>{item.name || person.displayName}</strong>
                      <small>
                        {item.lastMessage || "Start a conversation"}
                      </small>
                    </span>
                    {!!item.unread && (
                      <span className="count">{item.unread}</span>
                    )}
                  </button>
                );
              })
            : !rooms.loading && (
                <p className="quiet-message">
                  Your conversations will live here.
                </p>
              )}
          {showNew && (
            <form
              className="new-chat-form"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const data = await api<ChatRoomData>("chat/rooms", "POST", {
                    userIds: selected,
                    name: field(e.currentTarget, "name"),
                  });
                  await rooms.refresh();
                  setRoom(data.id);
                  setShowNew(false);
                  setSelected([]);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <h3>Start a conversation</h3>
              {friends.data?.friends?.map((friend) => (
                <label className="checkbox" key={friend.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(friend.id)}
                    onChange={(e) =>
                      setSelected((previous) =>
                        e.target.checked
                          ? [...previous, friend.id]
                          : previous.filter((id) => id !== friend.id),
                      )
                    }
                  />
                  {friend.displayName}
                </label>
              ))}
              {!friends.data?.friends?.length && (
                <Link className="text-link" href="/friends">
                  Add friends to start a DM
                </Link>
              )}
              {selected.length > 1 && (
                <input
                  name="name"
                  aria-label="Group name"
                  placeholder="Group name"
                  maxLength={80}
                />
              )}
              <button className="button small" disabled={!selected.length}>
                Start chatting
              </button>
              <Notice>{error}</Notice>
            </form>
          )}
        </aside>
        <div style={{ minWidth: 0 }}>
          {current?.kind === "group" && (
            <GroupManager
              roomId={room}
              refresh={rooms.refresh}
              onLeave={() => {
                setRoom("global");
                void rooms.refresh();
              }}
            />
          )}
          <ChatRoom
            key={room}
            roomId={room}
            title={
              room === "global"
                ? "Global chat"
                : current?.name ||
                  current?.members
                    ?.filter((member) => member.id !== user.id)
                    .map((member) => member.displayName)
                    .join(", ")
            }
          />
        </div>
      </div>
    </>
  );
}
export function NotificationsPage() {
  const resource = useResource<Notification[]>("notifications"),
    [error, setError] = useState("");
  useLiveRefresh(resource.refresh, notificationEvents);
  async function read(id?: string) {
    try {
      await api(
        id ? `notifications/${id}/read` : "notifications/read-all",
        "POST",
        {},
      );
      await resource.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Heading
        eyebrow="NOTHING MISSED"
        title="Your notifications."
        description="Updates from your people and your platform."
      >
        <button className="button secondary" onClick={() => void read()}>
          <Check size={16} /> Mark all read
        </button>
      </Heading>
      <Notice>{error}</Notice>
      <Panel>
        <ResourceState
          loading={resource.loading}
          error={resource.error}
          retry={resource.refresh}
        />
        {resource.data?.length
          ? resource.data.map((item) => (
              <div
                className={`notification-item ${!item.readAt ? "unread" : ""}`}
                key={item.id}
              >
                <span className="notification-icon">
                  {item.kind.includes("friend") ? (
                    <UserPlus size={18} />
                  ) : item.kind.includes("game") ? (
                    "♜"
                  ) : (
                    <MessageCircle size={18} />
                  )}
                </span>
                <Link
                  href={item.link || "/"}
                  onClick={() => void read(item.id)}
                >
                  <strong>{item.title}</strong>
                  <small>
                    {item.actorName ? `${item.actorName} · ` : ""}
                    {time(item.createdAt)}
                  </small>
                </Link>
                {!item.readAt && (
                  <button
                    className="icon-button"
                    aria-label="Mark read"
                    onClick={() => void read(item.id)}
                  >
                    <Check size={15} />
                  </button>
                )}
              </div>
            ))
          : !resource.loading && (
              <Empty title="A little peace and quiet" icon="✦">
                Friend requests, replies, party invites, and updates will arrive
                here.
              </Empty>
            )}
      </Panel>
    </>
  );
}
