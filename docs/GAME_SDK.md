# Game SDK and client boundaries

All official games use `new GameSDK(gameId)` from `@tell-aviv/game-sdk`. The pure manifests in `games/catalog.ts` declare routes, versions, save schemas, platform permissions, device support, categories, and multiplayer limits. `games/registry.ts` exports the same pure list; React clients load separately through `games/GamePlayer.tsx`.

`user()` returns only ID, username, display name, and avatar. No school resources, OAuth token, role, or other account internals enter game identity. `load<T>()` reads the game's save namespace. `save(data, schemaVersion)` submits the loaded revision and fails rather than overwriting a concurrent revision. A conflict must be resolved by loading the newer save and explicitly merging or choosing state. Unsupported schema versions are preserved by the backend.

`action<T>(action,payload)` talks only to this game's authoritative handler. Incremental, Casino, Tycoon, Deck Roguelike, and Tower Defense perform production, currency changes, RNG, combat outcomes, achievements, and competitive scores on the server. Generic client saves cannot alter those authoritative records. These clients initialize with `action('state')`; mutations return `{state, achievements, authoritative:true}`. Solo Ego Trip, local party practice, board bot games, and physics are casual and unranked. Ego Trip also has a separate server-authoritative private co-op gauntlet that records match outcomes without ranked rewards.

`leaderboard()` reads this game's leaderboard. `start()`, `presence()`, and `end()` manage game sessions and activity. `GameShell` starts a session, identifies the user, renews presence every 45 seconds, ends on unmount, and pauses on browser visibility loss. It supplies fullscreen, local mute/reduced-motion preferences, back navigation, and a shared pause state. Pausing a server economy does not stop offline production; pausing a multiplayer match does not pause other players or the server timer.

`@tell-aviv/game-runtime` shares only lifecycle, cloud-save hooks, gamepad input, lobby transport, and UI controls. Game rules remain in the game directory. Phaser and Matter are imported only after mount, so server rendering does not require browser globals. Original geometric art avoids third-party asset dependencies.

## Multiplayer

The runtime's Socket.IO client uses the session cookie, not a claimed user ID. `useLobby` receives explicit per-user views from `game:lobby:state`. `LobbyControls` creates/joins rooms, readies players, starts as host, and leaves on unmount. Socket actions use server validators; hidden roles, answer keys, drawing words, and dealer/mine information remain server-side until appropriate disclosure. Reconnection is owned by Socket.IO plus the realtime service.

Internal multiplayer engine IDs map to platform game entries: `reaction`, `trivia`, and `drawing` → `party-games`; `connect-four` → `board-games`; `social-deduction` stays unchanged. The realtime service manages matching identities and achievement/leaderboard writes. Lobby discussion separates eliminated players from living deduction players.

## Add a game

1. Add a truthful manifest to the catalog with minimum necessary permissions and only implemented modes.
2. Add an isolated client module accepting `{sdk, paused, muted, reducedMotion}`; use platform services through the SDK and shared runtime.
3. Add it to the lazy client map. Put tuning and content in separate modules.
4. Add server rules and validators if competitive or economic outcomes matter. Never submit a browser-provided balance or arbitrary score as authoritative.
5. Test critical transitions, document controls/save schemas/limitations, and launch it through the platform in a real browser.

The game host receives only safe account volume/music/effects/reduced-motion defaults. `RuntimeSettings` supplies these preferences and an optional host-owned audio controller; Ego Trip requests procedural music and combat cues. Audio activates after a browser gesture, honors mute/pause/volume/category switches, and releases its context and timers when the host leaves. Toolbar adjustments last for the session; Settings → Games stores future defaults. Other games do not yet have a complete audio/content set.
