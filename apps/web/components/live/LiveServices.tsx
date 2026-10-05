"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getGameSocket } from "../../../../packages/game-runtime/src/socket";
import { useSession } from "../ui";
import {
  desktopAllowed,
  safeNotificationLink,
  rememberNotification,
  type DesktopPolicy,
  type SeenNotification,
} from "./policy";
import { claimDesktopNotice } from "./desktop-ledger";
const IDLE_AFTER_MS = 5 * 60_000;
type Notice = {
  id: string;
  kind: string;
  title: string;
  link?: string;
  desktopSuppressed?: boolean;
};
function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** One listener per signed-in shell; manual status stays in persistent settings. */
export function LiveServices() {
  const { user } = useSession();
  const router = useRouter();
  const desired = String(user.settings.presence ?? "online");
  const preferences = (user.settings.notifications ?? {}) as Record<
    string,
    boolean
  >;
  const policy = useRef<DesktopPolicy>({
    enabled: false,
    focusMode: false,
    status: "online",
    preferences: {},
  });
  const desktopKey = `tell-aviv:desktop-policy:${user.id}`;
  const current: DesktopPolicy = {
    enabled: preferences.desktop_enabled === true,
    focusMode: user.settings.focusMode === true,
    status: desired,
    preferences,
  };
  policy.current = current;
  useEffect(() => {
    writeStorage(desktopKey, current);
  }, [
    desktopKey,
    current.enabled,
    current.focusMode,
    current.status,
    JSON.stringify(preferences),
  ]);
  useEffect(() => {
    const socket = getGameSocket();
    let lastInput = Date.now(),
      lastSent = 0,
      lastIdle = false;
    const report = () => {
      if (!socket.connected) return;
      const now = Date.now();
      const idleForMs = Math.min(86_400_000, Math.max(0, now - lastInput));
      lastSent = now;
      lastIdle = idleForMs >= IDLE_AFTER_MS;
      socket.emit("presence:heartbeat", { idleForMs });
    };
    const activity = () => {
      const now = Date.now();
      lastInput = now;
      if (lastIdle || now - lastSent >= 30_000) report();
    };
    const inputEvents = [
      "pointerdown",
      "pointermove",
      "keydown",
      "touchstart",
      "wheel",
    ] as const;
    for (const event of inputEvents)
      window.addEventListener(event, activity, { passive: true });
    window.addEventListener("focus", activity);
    socket.on("connect", report);
    const timer = setInterval(report, 20_000);
    report();
    return () => {
      clearInterval(timer);
      for (const event of inputEvents)
        window.removeEventListener(event, activity);
      window.removeEventListener("focus", activity);
      socket.off("connect", report);
    };
  }, [user.id, desired]);
  useEffect(() => {
    const socket = getGameSocket(),
      tab = crypto.randomUUID(),
      seenKey = `tell-aviv:desktop-seen:${user.id}`,
      foregroundPrefix = `tell-aviv:foreground:${user.id}:`;
    const foregroundKey = foregroundPrefix + tab;
    const open = new Set<Notification>();
    const pending = new Set<ReturnType<typeof setTimeout>>();
    let active = true;
    const visibility = () => {
      if (document.visibilityState === "visible" && document.hasFocus())
        writeStorage(foregroundKey, Date.now());
      else
        try {
          localStorage.removeItem(foregroundKey);
        } catch {}
    };
    const otherForeground = () => {
      if (document.visibilityState === "visible" && document.hasFocus())
        return true;
      try {
        const now = Date.now();
        for (let index = 0; index < localStorage.length; index++) {
          const key = localStorage.key(index);
          if (
            key?.startsWith(foregroundPrefix) &&
            now - Number(localStorage.getItem(key)) < 15_000
          )
            return true;
        }
      } catch {}
      return false;
    };
    const isAllowed = (notice: Notice) =>
      notice.desktopSuppressed !== true &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted" &&
      desktopAllowed(
        readStorage<DesktopPolicy>(desktopKey, policy.current),
        notice.kind,
        otherForeground(),
      );
    const show = async (notice: Notice) => {
      if (!active || !isAllowed(notice)) return;
      const claimed = await claimDesktopNotice(
        user.id,
        notice.id,
        Date.now(),
      ).catch(() => {
        const old = readStorage<SeenNotification[]>(seenKey, []);
        const remembered = rememberNotification(
          Array.isArray(old) ? old : [],
          notice.id,
          Date.now(),
        );
        if (remembered.duplicate) return false;
        writeStorage(seenKey, remembered.entries);
        return true;
      });
      if (!claimed || !active || !isAllowed(notice)) return;
      try {
        const notification = new Notification("Tell Aviv", {
          body: notice.title.slice(0, 180),
          tag: `tell-aviv:${user.id}:${notice.id}`,
        });
        open.add(notification);
        notification.onclick = () => {
          window.focus();
          router.push(safeNotificationLink(notice.link));
          notification.close();
        };
        notification.onclose = () => open.delete(notification);
      } catch {}
    };
    const receive = (notice: Notice) => {
      if (
        !active ||
        typeof notice?.id !== "string" ||
        typeof notice.kind !== "string" ||
        typeof notice.title !== "string" ||
        !isAllowed(notice)
      )
        return;
      if (navigator.locks) {
        void navigator.locks
          .request(`tell-aviv:desktop:${user.id}`, () => show(notice))
          .catch(() => {});
        return;
      }
      // Browsers without Web Locks elect the last storage claimant after a short
      // grace period; the persistent ID ledger still catches later deliveries.
      const claimKey = `tell-aviv:desktop-claim:${user.id}:${notice.id}`;
      if (!writeStorage(claimKey, tab)) {
        show(notice);
        return;
      }
      const timeout = setTimeout(() => {
        pending.delete(timeout);
        if (readStorage(claimKey, "") === tab) show(notice);
        try {
          if (readStorage(claimKey, "") === tab)
            localStorage.removeItem(claimKey);
        } catch {}
      }, 60);
      pending.add(timeout);
    };
    window.addEventListener("focus", visibility);
    window.addEventListener("blur", visibility);
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(visibility, 10_000);
    visibility();
    socket.on("notification:create", receive);
    return () => {
      active = false;
      clearInterval(timer);
      for (const timeout of pending) clearTimeout(timeout);
      socket.off("notification:create", receive);
      window.removeEventListener("focus", visibility);
      window.removeEventListener("blur", visibility);
      document.removeEventListener("visibilitychange", visibility);
      try {
        localStorage.removeItem(foregroundKey);
      } catch {}
      for (const notification of open) notification.close();
    };
  }, [user.id, desktopKey, router]);
  return null;
}
