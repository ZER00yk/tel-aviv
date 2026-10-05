export {
  desktopAllowed,
  type DesktopPolicy,
} from "../../../../packages/shared/src/notification-policy";
export function safeNotificationLink(value: unknown) {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    value.length <= 2048
    ? value
    : "/notifications";
}
export type SeenNotification = { id: string; at: number };
export function rememberNotification(
  current: SeenNotification[],
  id: string,
  now: number,
) {
  const recent = current.filter(
    (entry) =>
      entry &&
      typeof entry.id === "string" &&
      Number.isFinite(entry.at) &&
      now - entry.at < 24 * 60 * 60_000 &&
      entry.at <= now,
  );
  return {
    duplicate: recent.some((entry) => entry.id === id),
    entries: [
      ...recent.filter((entry) => entry.id !== id),
      { id, at: now },
    ].slice(-128),
  };
}
