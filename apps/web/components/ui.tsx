"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@tell-aviv/shared";

export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/${path.replace(/^\//, "")}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const result = await response
    .json()
    .catch(() => ({ error: "The service returned an unreadable response." }));
  if (!response.ok || result.error)
    throw new Error(result.error || `Request failed (${response.status}).`);
  return result.data as T;
}
export function useResource<T = unknown>(path: string | null) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (!path) {
      setLoading(false);
      return;
    }
    setError("");
    try {
      setData(await api<T>(path));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    let active = true;
    setLoading(Boolean(path));
    setData(null);
    setError("");
    if (path)
      api<T>(path)
        .then((value) => {
          if (active) setData(value);
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    return () => {
      active = false;
    };
  }, [path]);
  return { data, error, loading, refresh, setData };
}
export const SessionContext = createContext<{
  user: User;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
} | null>(null);
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("Session unavailable");
  return session;
}
export function Avatar({
  user,
  size = "",
}: {
  user: { displayName?: string; username?: string; avatar?: string | null };
  size?: string;
}) {
  return (
    <span className={`avatar ${size}`} aria-hidden="true">
      {user.avatar ? (
        <img src={user.avatar} alt="" referrerPolicy="no-referrer" />
      ) : (
        (user.displayName || user.username || "?").slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
export function Empty({
  title,
  children,
  icon = "✦",
}: {
  title: string;
  children?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Notice({
  children,
  success = false,
}: {
  children?: ReactNode;
  success?: boolean;
}) {
  return children ? (
    <div
      className={`notice ${success ? "success" : ""}`}
      role={success ? "status" : "alert"}
    >
      {children}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" /> Loading your space…
    </div>
  );
}
export function ResourceState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry?: () => void;
}) {
  return loading ? (
    <Loading />
  ) : error ? (
    <Notice>
      {error}
      {retry && (
        <button className="text-button" onClick={retry}>
          Try again
        </button>
      )}
    </Notice>
  ) : null;
}
export function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </header>
  );
}
export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function time(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
}
export function field(form: HTMLFormElement, name: string) {
  return String(new FormData(form).get(name) || "").trim();
}
