"use client";
import { useEffect } from "react";
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ component: "web-boundary", message: error.name }),
    }).catch(() => undefined);
  }, [error]);
  return (
    <main className="empty">
      <h1>This page needs another try.</h1>
      <p>Your saved work is still on the server.</p>
      <button className="button" onClick={reset}>
        Try again
      </button>
      <a className="button secondary" href="/">
        Return home
      </a>
    </main>
  );
}
