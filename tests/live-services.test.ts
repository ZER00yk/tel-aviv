import { describe, it, expect } from "vitest";
import {
  effectivePresenceStatus,
  IDLE_AFTER_MS,
} from "../apps/realtime/src/presence-policy";
import {
  desktopAllowed,
  rememberNotification,
  safeNotificationLink,
  type DesktopPolicy,
} from "../apps/web/components/live/policy";
const policy: DesktopPolicy = {
  enabled: true,
  focusMode: false,
  status: "online",
  preferences: {},
};
describe("automatic idle and desktop alert policy", () => {
  it("switches automatic online to idle and back without changing explicit statuses", () => {
    const now = 1_000_000;
    expect(effectivePresenceStatus("online", now - IDLE_AFTER_MS, now)).toBe(
      "idle",
    );
    expect(effectivePresenceStatus("online", now - 1000, now)).toBe("online");
    for (const status of ["idle", "dnd", "invisible"])
      expect(effectivePresenceStatus(status, now, now)).toBe(status);
    expect(effectivePresenceStatus(undefined, undefined, now)).toBe("online");
  });
  it("requires opt-in and suppresses Focus Mode, DND and a foreground tab", () => {
    expect(desktopAllowed(policy, "dm", false)).toBe(true);
    expect(desktopAllowed({ ...policy, enabled: false }, "dm", false)).toBe(
      false,
    );
    expect(desktopAllowed({ ...policy, focusMode: true }, "dm", false)).toBe(
      false,
    );
    expect(desktopAllowed({ ...policy, status: "dnd" }, "dm", false)).toBe(
      false,
    );
    expect(desktopAllowed(policy, "dm", true)).toBe(false);
  });
  it("honors direct-message, mention/reply, invite and in-app category preferences", () => {
    for (const [kind, key] of [
      ["dm", "desktop_dm"],
      ["mention", "desktop_mentions"],
      ["reply", "desktop_mentions"],
      ["thread_reply", "desktop_mentions"],
      ["thread", "desktop_mentions"],
      ["party_invite", "desktop_invites"],
      ["game_invite", "desktop_invites"],
      ["achievement", "achievement"],
    ])
      expect(
        desktopAllowed(
          { ...policy, preferences: { [key]: false } },
          kind,
          false,
        ),
      ).toBe(false);
    expect(
      desktopAllowed({ ...policy, preferences: { dm: false } }, "dm", false),
    ).toBe(false);
  });
  it("bounds deduplication storage, ignores expired/future IDs and survives malformed entries", () => {
    const now = 200_000_000;
    const entries = Array.from({ length: 200 }, (_, index) => ({
      id: String(index),
      at: now - 1000,
    }));
    const first = rememberNotification(entries, "199", now);
    expect(first.duplicate).toBe(true);
    expect(first.entries).toHaveLength(128);
    const second = rememberNotification(
      [
        { id: "old", at: 0 },
        { id: "future", at: now + 1 },
      ],
      "old",
      now,
    );
    expect(second.duplicate).toBe(false);
    expect(second.entries).toEqual([{ id: "old", at: now }]);
  });
  it("allows only relative in-app notification destinations", () => {
    expect(safeNotificationLink("/chat?room=fixture")).toBe(
      "/chat?room=fixture",
    );
    for (const bad of [
      "//evil.test",
      "https://evil.test",
      "javascript:alert(1)",
      "/\\evil.test",
      null,
    ])
      expect(safeNotificationLink(bad)).toBe("/notifications");
  });
});
