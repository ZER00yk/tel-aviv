export const IDLE_AFTER_MS = 5 * 60_000;
export function effectivePresenceStatus(
  manual: unknown,
  lastActivityAt: number | undefined,
  now = Date.now(),
) {
  if (manual === "invisible" || manual === "dnd" || manual === "idle")
    return manual;
  return lastActivityAt !== undefined && now - lastActivityAt >= IDLE_AFTER_MS
    ? "idle"
    : "online";
}
