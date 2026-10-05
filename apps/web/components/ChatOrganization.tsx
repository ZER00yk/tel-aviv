"use client";
import { useEffect, useRef, useState } from "react";
import {
  api,
  Avatar,
  Notice,
  ResourceState,
  time,
  useResource,
  useSession,
} from "./ui";
import type { ChatData, FriendsData, Person } from "./models";
import { getGameSocket } from "../../../packages/game-runtime/src/socket";

interface ThreadSummary {
  id: string;
  name: string;
  rootContent: string | null;
  displayName: string | null;
  replyCount: number;
  updatedAt: string;
  archivedAt: string | null;
  following: boolean;
  unread: number;
}
interface ThreadPage {
  threads: ThreadSummary[];
  nextCursor: string | null;
}
const changedEvents = [
  "chat:message:create",
  "chat:message:delete",
  "chat:thread:update",
  "chat:thread:read",
  "chat:room:update",
] as const;
function useOrganizationRefresh(refresh: () => Promise<void>, roomId: string) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    const socket = getGameSocket();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const change = (event?: { roomId?: string }) => {
      if (roomId !== "global" && event?.roomId && event.roomId !== roomId)
        return;
      clearTimeout(timer);
      timer = setTimeout(() => void latest.current(), 150);
    };
    changedEvents.forEach((event) => socket.on(event, change));
    socket.on("connect", change);
    return () => {
      clearTimeout(timer);
      changedEvents.forEach((event) => socket.off(event, change));
      socket.off("connect", change);
    };
  }, [roomId]);
}

export function ThreadDirectory({
  roomId,
  open,
}: {
  roomId: string;
  open: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [following, setFollowing] = useState(false),
    [older, setOlder] = useState<ThreadSummary[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState("");
  const path = `chat/${roomId}/threads?page=true&q=${encodeURIComponent(search)}&archived=${archived}&following=${following}`;
  const resource = useResource<ThreadPage>(path);
  useOrganizationRefresh(resource.refresh, roomId);
  useEffect(() => {
    setOlder([]);
    setCursor(null);
    setError("");
  }, [path]);
  const threads = [
    ...new Map(
      [...(resource.data?.threads ?? []), ...older].map((thread) => [
        thread.id,
        thread,
      ]),
    ).values(),
  ];
  return (
    <section
      aria-label="Conversation threads"
      style={{
        padding: "16px 20px",
        borderBottom: "1px solid var(--border)",
        display: "grid",
        gap: 12,
      }}
    >
      <form
        style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query);
        }}
      >
        <input
          aria-label="Search threads"
          placeholder="Search thread names and original messages"
          value={query}
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="button secondary small">Search threads</button>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />
          Archived threads
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={following}
            onChange={(event) => setFollowing(event.target.checked)}
          />
          Following only
        </label>
      </form>
      <ResourceState
        loading={resource.loading}
        error={resource.error}
        retry={resource.refresh}
      />
      <Notice>{error}</Notice>
      {!resource.loading && !threads.length && (
        <p className="muted">
          No threads match. Start a thread from a conversation message.
        </p>
      )}
      {threads.map((thread) => (
        <button
          className="text-button"
          key={thread.id}
          onClick={() => open(thread.id)}
          style={{
            textAlign: "left",
            padding: "10px 0",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <strong>
            {thread.name ||
              thread.rootContent?.slice(0, 100) ||
              "Original message removed"}
          </strong>
          {!!thread.unread && (
            <span className="count" style={{ marginLeft: 8 }}>
              {thread.unread} unread
            </span>
          )}
          <br />
          <small>
            {thread.displayName || "Deleted account"} · {thread.replyCount}{" "}
            {thread.replyCount === 1 ? "reply" : "replies"} ·{" "}
            {time(thread.updatedAt)}
            {thread.following ? " · Following" : ""}
            {thread.archivedAt ? " · Archived" : ""}
          </small>
        </button>
      ))}
      {(cursor === null ? resource.data?.nextCursor : cursor) && (
        <button
          className="button secondary small"
          onClick={async () => {
            try {
              const page = await api<ThreadPage>(
                `${path}&before=${cursor === null ? resource.data?.nextCursor : cursor}`,
              );
              setOlder((previous) => [...previous, ...page.threads]);
              setCursor(page.nextCursor || "");
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Could not load more threads",
              );
            }
          }}
        >
          More threads
        </button>
      )}
    </section>
  );
}

export function ThreadTools({
  roomId,
  threadId,
  thread,
  refresh,
}: {
  roomId: string;
  threadId: string;
  thread: ChatData["thread"];
  refresh: () => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [editing, setEditing] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  async function change(action: string, method: string, body: unknown) {
    setError("");
    setSaving(true);
    try {
      await api(`chat/${roomId}/threads/${threadId}${action}`, method, body);
      await refresh();
      setEditing(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Thread could not be updated",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div
      style={{
        padding: "12px 20px",
        borderBottom: "1px solid var(--border)",
        display: "grid",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <button
          className="button secondary small"
          disabled={saving}
          onClick={() =>
            void change("/follow", "POST", { following: !thread?.following })
          }
        >
          {thread?.following ? "Unfollow thread" : "Follow thread"}
        </button>
        {thread?.canManage && (
          <>
            <button
              className="button secondary small"
              onClick={() => {
                setName(thread.name || "");
                setEditing(!editing);
              }}
            >
              Rename thread
            </button>
            <button
              className="button secondary small"
              disabled={saving}
              onClick={() =>
                void change("", "PATCH", { archived: !thread.archivedAt })
              }
            >
              {thread.archivedAt ? "Unarchive thread" : "Archive thread"}
            </button>
          </>
        )}
        {thread?.archivedAt && (
          <span className="muted">Archived · replies are read-only</span>
        )}
        <span className="muted">
          Following sends thread notifications. Reading clears this thread’s
          unread replies.
        </span>
      </div>
      {editing && (
        <form
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
          onSubmit={(event) => {
            event.preventDefault();
            void change("", "PATCH", { name });
          }}
        >
          <input
            aria-label="Thread name"
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            placeholder="Give this thread a name"
          />
          <button className="button small" disabled={saving || !name.trim()}>
            Save thread name
          </button>
        </form>
      )}
      <Notice>{error}</Notice>
    </div>
  );
}

interface GroupData {
  id: string;
  ownerId: string;
  name: string;
  icon: string | null;
  members: (Person & { joinedAt: string })[];
}
export function GroupManager({
  roomId,
  refresh,
  onLeave,
}: {
  roomId: string;
  refresh: () => Promise<void>;
  onLeave: () => void;
}) {
  const { user } = useSession();
  const resource = useResource<GroupData>(`chat/${roomId}/members`),
    friends = useResource<FriendsData>("friends");
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [icon, setIcon] = useState(""),
    [target, setTarget] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const owner = resource.data?.ownerId === user.id;
  useOrganizationRefresh(resource.refresh, roomId);
  useEffect(() => {
    if (resource.data) {
      setName(resource.data.name);
      setIcon(resource.data.icon ?? "");
    }
  }, [resource.data]);
  async function change(
    path: string,
    method: string,
    body: unknown,
    leaving = false,
  ) {
    setBusy(true);
    setError("");
    try {
      await api(path, method, body);
      if (leaving) {
        onLeave();
        return;
      }
      await resource.refresh();
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Group could not be updated",
      );
    } finally {
      setBusy(false);
    }
  }
  const eligible = (friends.data?.friends ?? []).filter(
    (friend) =>
      !resource.data?.members.some((member) => member.id === friend.id),
  );
  return (
    <section
      className="panel"
      aria-label="Group management"
      style={{ marginBottom: 12 }}
    >
      <button className="text-button" onClick={() => setOpen(!open)}>
        {open ? "Hide group settings" : "Group settings"}
      </button>
      {open && (
        <div style={{ display: "grid", gap: 14, padding: 16 }}>
          <ResourceState
            loading={resource.loading}
            error={resource.error}
            retry={resource.refresh}
          />
          <Notice>{error}</Notice>
          <p className="muted">
            The owner can rename the group and add or remove members. When the
            owner leaves, ownership passes to the longest-standing remaining
            member. Groups have at most eight members.
          </p>
          {owner && (
            <form
              style={{ display: "grid", gap: 10 }}
              onSubmit={(event) => {
                event.preventDefault();
                void change(`chat/${roomId}`, "PATCH", {
                  name,
                  icon: icon.trim() || null,
                });
              }}
            >
              <label>
                Group name
                <input
                  aria-label="Rename group"
                  value={name}
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                Group avatar URL
                <input
                  aria-label="Group avatar URL"
                  type="url"
                  placeholder="https://…"
                  value={icon}
                  maxLength={2048}
                  onChange={(event) => setIcon(event.target.value)}
                />
              </label>
              <button className="button small" disabled={busy || !name.trim()}>
                Save group settings
              </button>
            </form>
          )}
          {resource.data?.members.map((member) => (
            <div
              key={member.id}
              style={{ display: "flex", gap: 10, alignItems: "center" }}
            >
              <Avatar user={member} />
              <span>
                {member.displayName}
                {member.id === resource.data?.ownerId ? " · Owner" : ""}
              </span>
              {owner && member.id !== user.id && (
                <button
                  className="text-button"
                  disabled={busy}
                  aria-label={`Remove ${member.username} from group`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove ${member.displayName} from this group? They will lose access to its messages and files.`,
                      )
                    )
                      void change(
                        `chat/${roomId}/members/${member.id}`,
                        "DELETE",
                        {},
                      );
                  }}
                >
                  Remove member
                </button>
              )}
            </div>
          ))}
          {owner && (
            <form
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
              onSubmit={(event) => {
                event.preventDefault();
                if (target)
                  void change(`chat/${roomId}/members`, "POST", {
                    userId: target,
                  });
              }}
            >
              <select
                aria-label="Add group member"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">Choose a friend</option>
                {eligible.map((friend) => (
                  <option key={friend.id} value={friend.id}>
                    {friend.displayName} (@{friend.username})
                  </option>
                ))}
              </select>
              <button
                className="button secondary small"
                disabled={
                  busy || !target || (resource.data?.members.length ?? 0) >= 8
                }
              >
                Add member
              </button>
            </form>
          )}
          <button
            className="button secondary small"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Leave this group? You will lose access to its messages and files.",
                )
              )
                void change(`chat/${roomId}/leave`, "POST", {}, true);
            }}
          >
            Leave group
          </button>
        </div>
      )}
    </section>
  );
}
