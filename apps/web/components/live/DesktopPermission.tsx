"use client";
import { useEffect, useState } from "react";
import { api, useSession } from "../ui";
export function DesktopPermission() {
  const { user, refresh } = useSession();
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [prompted, setPrompted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (typeof Notification !== "undefined")
      setPermission(Notification.permission);
    try {
      setPrompted(
        localStorage.getItem("tell-aviv:desktop-permission-requested") ===
          "true",
      );
    } catch {}
  }, []);
  const enabled =
    (user.settings.notifications as Record<string, boolean> | undefined)
      ?.desktop_enabled === true;
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      if (!enabled) {
        if (permission === "default" && !prompted) {
          try {
            localStorage.setItem(
              "tell-aviv:desktop-permission-requested",
              "true",
            );
          } catch {}
          setPrompted(true);
          const result = await Notification.requestPermission();
          setPermission(result);
          if (result !== "granted") return;
        } else if (permission !== "granted") return;
      }
      await api("profile", "POST", {
        settings: { notifications: { desktop_enabled: !enabled } },
      });
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not change desktop notifications",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-form">
      <strong>Browser notifications</strong>
      <p className="muted">
        Optional desktop alerts while Tell Aviv is in the background. Focus Mode
        and Do not disturb suppress alerts across your open tabs.
      </p>
      <button
        type="button"
        className="button secondary"
        disabled={
          busy ||
          permission === "unsupported" ||
          (!enabled &&
            (permission === "denied" || (permission === "default" && prompted)))
        }
        onClick={() => void toggle()}
      >
        {busy
          ? "Updating…"
          : enabled
            ? "Turn off browser notifications"
            : "Enable browser notifications"}
      </button>
      <p className="small muted">
        {permission === "unsupported"
          ? "This browser does not support desktop notifications."
          : permission === "denied"
            ? "Permission is blocked. Change this site's notification permission in your browser settings."
            : permission === "default" && prompted
              ? "The permission request was dismissed. Enable permission in your browser settings to continue."
              : permission === "granted"
                ? `Browser permission granted · alerts ${enabled ? "enabled" : "off"}.`
                : "Permission is requested only when you choose Enable."}
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
