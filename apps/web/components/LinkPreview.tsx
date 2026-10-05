"use client";
import { useRef, useState } from "react";
import { api } from "./ui";
import type { LinkPreviewResult } from "../../../packages/platform/src/linkPreview";

export function LinkPreview({
  roomId,
  messageId,
  content,
}: {
  roomId: string;
  messageId: string;
  content: string;
}) {
  const identity = JSON.stringify([roomId, messageId, content]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const generation = useRef(0);
  const [state, setState] = useState<{
    identity: string;
    result?: LinkPreviewResult;
    loading?: boolean;
    error?: string;
  } | null>(null);
  const result = state?.identity === identity ? state : null;
  if (!/https:\/\/\S+/i.test(content)) return null;
  async function load() {
    const requestGeneration = ++generation.current;
    setState({ identity, loading: true });
    try {
      const preview = await api<LinkPreviewResult>(
        "chat/link-preview",
        "POST",
        { roomId, messageId },
      );
      if (
        currentIdentity.current === identity &&
        generation.current === requestGeneration
      )
        setState({ identity, result: preview });
    } catch (e) {
      if (
        currentIdentity.current === identity &&
        generation.current === requestGeneration
      )
        setState({
          identity,
          error: e instanceof Error ? e.message : "Preview is unavailable.",
        });
    }
  }
  return (
    <div className="link-preview" style={{ marginTop: ".5rem" }}>
      {result?.result?.preview ? (
        <a
          href={result.result.preview.url}
          target="_blank"
          rel="noopener noreferrer"
          className="card"
          style={{
            display: "block",
            padding: ".65rem",
            textDecoration: "none",
          }}
        >
          <small className="muted">{result.result.preview.site}</small>
          <strong style={{ display: "block" }}>
            {result.result.preview.title}
          </strong>
          {result.result.preview.description && (
            <span className="muted" style={{ display: "block" }}>
              {result.result.preview.description}
            </span>
          )}
        </a>
      ) : (
        <>
          <button
            type="button"
            className="button ghost small"
            disabled={result?.loading}
            onClick={load}
          >
            {result?.loading ? "Loading preview…" : "Load link preview"}
          </button>
          {(result?.error || result?.result?.message) && (
            <small className="muted" role="status">
              {" "}
              {result.error || result.result?.message}
            </small>
          )}
        </>
      )}
    </div>
  );
}
