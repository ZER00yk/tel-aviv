export type DesktopPolicy = {
  enabled: boolean;
  focusMode: boolean;
  status: string;
  preferences: Record<string, boolean>;
};
export function desktopAllowed(
  policy: DesktopPolicy,
  kind: string,
  foreground: boolean,
) {
  if (
    !policy ||
    typeof policy !== "object" ||
    !policy.preferences ||
    typeof policy.preferences !== "object"
  )
    return false;
  if (
    !policy.enabled ||
    policy.focusMode ||
    policy.status === "dnd" ||
    foreground ||
    policy.preferences[kind] === false
  )
    return false;
  if (kind === "dm") return policy.preferences.desktop_dm !== false;
  if (
    kind === "mention" ||
    kind === "reply" ||
    kind === "thread_reply" ||
    kind === "thread"
  )
    return policy.preferences.desktop_mentions !== false;
  if (kind === "party_invite" || kind === "game_invite")
    return policy.preferences.desktop_invites !== false;
  return true;
}
