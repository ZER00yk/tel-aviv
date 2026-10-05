import { describe, expect, it } from "vitest";
import { createLobby, lobbyView } from "./engines";
describe("explicit multiplayer identity DTOs", () => {
  const privateUser = {
    id: "a",
    username: "lobby-player",
    role: "owner",
    email: "private@example.invalid",
    settings: {
      presence: "invisible",
      focusMode: true,
      privateNotes: "PRIVATE_SETTINGS_SENTINEL",
    },
  };
  it("does not spread an authenticated account into a new lobby", () => {
    const lobby = createLobby(
      privateUser,
      "connect-four",
      "private",
      "ABC234",
      1000,
    );
    expect(lobby.players[0]).toEqual({
      id: "a",
      username: "lobby-player",
      ready: false,
      connected: true,
    });
    expect(JSON.stringify(lobby)).not.toContain("PRIVATE_SETTINGS_SENTINEL");
    expect(JSON.stringify(lobby)).not.toContain("private@example.invalid");
  });
  it("sanitizes public views of old canonical snapshots without exposing private settings or roles", () => {
    const lobby = createLobby(
      privateUser,
      "connect-four",
      "private",
      "ABC234",
      1000,
    );
    Object.assign(lobby.players[0], privateUser, { disconnectedAt: 900 });
    const view = lobbyView(lobby, "a", 1000);
    expect(view.players[0]).toEqual({
      id: "a",
      username: "lobby-player",
      ready: false,
      connected: true,
    });
    for (const sentinel of [
      "PRIVATE_SETTINGS_SENTINEL",
      "private@example.invalid",
      "invisible",
      "focusMode",
      '"role"',
      "disconnectedAt",
    ])
      expect(JSON.stringify(view)).not.toContain(sentinel);
  });
});
