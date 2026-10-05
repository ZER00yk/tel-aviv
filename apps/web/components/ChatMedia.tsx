"use client";
import { useEffect, useState } from "react";
import { api, Notice, ResourceState, useResource } from "./ui";
import { getGameSocket } from "../../../packages/game-runtime/src/socket";
import type { GifSearch } from "../../../packages/platform/src/chatMedia";

export interface ServerEmoji {
  id: string;
  name: string;
  mime: string;
  bytes: number;
}
export function CustomEmoji({
  id,
  serverId,
  name,
}: {
  id: string;
  serverId?: string | null;
  name?: string;
}) {
  const [missing, setMissing] = useState(false),
    [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const socket = getGameSocket();
    const update = (event: { serverId?: string }) => {
      if (event.serverId === serverId) {
        setMissing(false);
        setEpoch((value) => value + 1);
      }
    };
    socket.on("server:emoji:update", update);
    return () => {
      socket.off("server:emoji:update", update);
    };
  }, [serverId]);
  if (!serverId || missing)
    return (
      <span title="Emoji is deleted or unavailable">
        :{name || "emoji unavailable"}:
      </span>
    );
  return (
    <img
      src={`/api/servers/${serverId}/emojis/${id}/file?v=${epoch}`}
      alt={`:${name || "server emoji"}:`}
      title={name ? `:${name}:` : "Server emoji"}
      width={24}
      height={24}
      loading="lazy"
      onError={() => setMissing(true)}
      style={{
        display: "inline-block",
        objectFit: "contain",
        verticalAlign: "middle",
      }}
    />
  );
}

function useEmojiRefresh(serverId: string, refresh: () => Promise<void>) {
  useEffect(() => {
    const socket = getGameSocket();
    const update = (event: { serverId?: string }) => {
      if (event.serverId === serverId) void refresh();
    };
    socket.on("server:emoji:update", update);
    return () => {
      socket.off("server:emoji:update", update);
    };
  }, [serverId, refresh]);
}
export function EmojiPicker({
  serverId,
  choose,
}: {
  serverId: string;
  choose: (token: string) => void;
}) {
  const emojis = useResource<ServerEmoji[]>(`servers/${serverId}/emojis`);
  useEmojiRefresh(serverId, emojis.refresh);
  return (
    <section
      aria-label="Server emoji picker"
      style={{
        padding: 16,
        display: "grid",
        gap: 10,
        borderTop: "1px solid var(--border)",
      }}
    >
      <ResourceState
        loading={emojis.loading}
        error={emojis.error}
        retry={emojis.refresh}
      />
      {!emojis.loading && !emojis.data?.length && (
        <p className="muted">
          No custom emoji yet. A server manager can upload them in server
          settings.
        </p>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {emojis.data?.map((emoji) => (
          <button
            type="button"
            className="button secondary small"
            key={emoji.id}
            aria-label={`Insert emoji ${emoji.name}`}
            onClick={() => choose(`:emoji:${emoji.id}:`)}
          >
            <CustomEmoji id={emoji.id} serverId={serverId} name={emoji.name} />{" "}
            {emoji.name}
          </button>
        ))}
      </div>
    </section>
  );
}

export function ServerEmojiManager({
  serverId,
  canManage,
}: {
  serverId: string;
  canManage: boolean;
}) {
  const resource = useResource<ServerEmoji[]>(`servers/${serverId}/emojis`);
  useEmojiRefresh(serverId, resource.refresh);
  const [name, setName] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section
      aria-label="Server emoji management"
      style={{
        display: "grid",
        gap: 12,
        borderTop: "1px solid var(--border)",
        paddingTop: 18,
        marginTop: 18,
      }}
    >
      <h3>Custom server emoji</h3>
      <p className="muted">
        PNG, JPEG, GIF or WebP · 256 KB and 512 × 512 pixels each · 50 per
        server. Uploads count toward your storage quota. Server managers can
        upload and delete.
      </p>
      <ResourceState
        loading={resource.loading}
        error={resource.error}
        retry={resource.refresh}
      />
      <Notice>{error}</Notice>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {resource.data?.map((emoji) => (
          <div
            key={emoji.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 10,
              display: "grid",
              gap: 8,
            }}
          >
            <span>
              <CustomEmoji
                id={emoji.id}
                serverId={serverId}
                name={emoji.name}
              />{" "}
              :{emoji.name}:
            </span>
            {canManage && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                aria-label={`Delete emoji ${emoji.name}`}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Delete :${emoji.name}:? Existing messages will show an unavailable emoji fallback.`,
                    )
                  )
                    return;
                  setBusy(true);
                  setError("");
                  try {
                    await api(
                      `servers/${serverId}/emojis/${emoji.id}`,
                      "DELETE",
                      {},
                    );
                    await resource.refresh();
                  } catch (reason) {
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "Emoji could not be deleted",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete emoji
              </button>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <form
          style={{ display: "grid", gap: 10 }}
          onSubmit={async (event) => {
            event.preventDefault();
            const element = event.currentTarget;
            if (!file) return;
            setBusy(true);
            setError("");
            try {
              const form = new FormData();
              form.set("name", name);
              form.set("file", file);
              const response = await fetch(`/api/servers/${serverId}/emojis`, {
                method: "POST",
                credentials: "same-origin",
                body: form,
              });
              const result = await response.json();
              if (!response.ok)
                throw new Error(result.error || "Emoji upload failed");
              setName("");
              setFile(null);
              element.reset();
              await resource.refresh();
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Emoji upload failed",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Emoji name
            <input
              aria-label="Custom emoji name"
              value={name}
              maxLength={32}
              pattern="[a-z0-9_]{2,32}"
              placeholder="happy_cat"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Emoji image
            <input
              aria-label="Custom emoji image"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <button
            className="button small"
            disabled={
              busy ||
              !file ||
              !/^[a-z0-9_]{2,32}$/.test(name) ||
              (resource.data?.length ?? 0) >= 50
            }
          >
            {busy ? "Uploading…" : "Upload server emoji"}
          </button>
        </form>
      )}
    </section>
  );
}

export function GifPicker({ choose }: { choose: (url: string) => void }) {
  const resource = useResource<GifSearch>("chat/gifs"),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<GifSearch | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const data = results ?? resource.data;
  return (
    <section
      aria-label="GIF search"
      style={{
        padding: 16,
        borderTop: "1px solid var(--border)",
        display: "grid",
        gap: 12,
      }}
    >
      <ResourceState
        loading={resource.loading}
        error={resource.error}
        retry={resource.refresh}
      />
      <Notice>{error}</Notice>
      {data?.configured === false && (
        <p role="status" className="muted">
          GIF search is unavailable right now.
        </p>
      )}
      <form
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            setResults(
              await api<GifSearch>(`chat/gifs?q=${encodeURIComponent(query)}`),
            );
          } catch (reason) {
            setError(
              reason instanceof Error ? reason.message : "GIF search failed",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          aria-label="Search GIFs"
          disabled={!data?.configured || busy}
          value={query}
          maxLength={120}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search GIFs"
        />
        <button
          className="button secondary small"
          disabled={!data?.configured || busy || !query.trim()}
        >
          Search GIFs
        </button>
      </form>
      {data?.configured && (
        <small className="muted">
          Powered by {data.provider}. Choosing a GIF adds its image URL to your
          message.
        </small>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))",
          gap: 8,
        }}
      >
        {data?.results.map((gif) => (
          <button
            type="button"
            className="text-button"
            key={gif.id}
            aria-label={`Choose GIF ${gif.title}`}
            onClick={() => choose(gif.url)}
          >
            <img
              src={gif.previewUrl}
              alt={gif.title}
              loading="lazy"
              style={{
                width: "100%",
                height: 110,
                objectFit: "cover",
                borderRadius: 6,
              }}
            />
          </button>
        ))}
      </div>
      {results?.configured && !results.results.length && (
        <p className="muted">No matching GIFs found.</p>
      )}
    </section>
  );
}

export function isGifImageUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "giphy.com" || url.hostname.endsWith(".giphy.com")) &&
      /\.(gif|webp)$/i.test(url.pathname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
