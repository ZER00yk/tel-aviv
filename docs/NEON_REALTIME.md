# Neon Defense live authority

Neon Defense now offers **Live co-op defense** alongside its existing solo defense. Two to four authenticated accounts share one map, tower grid, cash balance and life pool. This mode runs combat over Socket.IO while players intervene; solo waves retain the verified HTTP simulation and replay controls.

The host creates a private room, everyone joins and readies, then the host starts the match. Before building, the host can select City Boulevard, Canal Switchback or Two-Way Crossing and either a 20-wave campaign or Endless. The host sends each wave. All members can build, upgrade, sell and change targeting during combat, and choose the shared reward offered every third wave. Leaving during a match ends the shared defense; the Solo defense tab stays disabled until an explicit room leave.

## Simulation and commands

The server owns spawning, enemy positions, health, shields, movement, tower targeting and cooldowns, damage, status effects, boss behavior, kills, leaks, cash rewards and the final result. Both modes use the same serializable fixed-step combat kernel. Live combat advances in 200 ms steps; the worker polls about every 250 ms and performs at most five steps after a stall, preventing a long outage from turning into an unbounded combat burst.

Each live command carries a UUID request ID and the latest command revision. The strict schema accepts only `configure`, `place`, `upgrade`, `sell`, `target`, `wave` and `choose`, with bounded coordinates, tower IDs and enumerated choices. It rejects outcome, score, cash and simulation fields. Shared funds, path placement, levels, phase, membership and host privileges are checked on the server. Concurrent commands must use the latest revision. An exact retry is accepted without spending again; a changed payload using an existing request ID is rejected. Each player retains the latest 32 receipts, and each defense accepts at most 10,000 command revisions.

The public projection includes current visible enemies, health, effects, towers, cash, lives, recent shots and the command revision. It excludes future spawn times, simulation timers and cooldowns, random seed, receipts and private canonical state. The shared match outcome is derived from server combat and recorded once in `multiplayer_matches` and `multiplayer_results`. Live results do not submit a client score or overwrite the solo ranked leaderboard.

## Recovery

Accepted commands and phase changes commit a PostgreSQL checkpoint before Redis publication. Ongoing movement is checkpointed approximately once per second. A private checkpoint serial orders SQL commits; a newer SQL checkpoint takes precedence over an older cached snapshot, including when the SQL commit succeeded and cache publication failed. This preserves committed teammate disconnects and all-disconnected pauses as well as commands and combat steps. Older snapshots without the serial remain compatible.

One absent player does not pause a defense while a teammate remains connected. If everyone disconnects, server ticks pause. Rejoining or recovering a durable checkpoint resets the combat wall-time baseline and restores the same wave, towers, funds and receipts without simulating the outage. Disconnect cleanup rechecks active socket membership inside the lobby mutation, so queued cleanup from an old socket cannot undo a reconnect. Missing Redis lobby and membership keys can be restored from this namespace's SQL checkpoint. Combat since the latest periodic checkpoint can be lost after a process crash; accepted commands remain pinned by their revision.

Live enemy and replay budgets remain bounded to 80 initial enemies, 160 total including reinforcements, 1,500 combat steps, 800 retained replay events and 16 position samples per enemy. Unresolved enemies leak at the step limit. Endless waves stop accepting new waves after 10,000.

## Verification

The focused engine suite has 36 passing cases: 19 existing tower-depth cases, 10 live-authority cases and 7 general realtime engine cases. It checks identical solo/live outcomes across all three maps and representative boss waves, actual teammate intervention, wave commands, retries and stale revisions, hidden-state projection, bounded catch-up and terminal server settlement.

Eight additional real PostgreSQL/Redis/Socket.IO cases pass with `RUN_INTEGRATION=1`. They verify shared spending, SQL receipts, rejected score forgery, a lost cache publication after a committed build or teammate disconnect, visible moving enemies and mid-wave upgrades, hydration from a lost fixture cache, all-disconnected pause despite stale connected cache, reconnect cleanup ordering and once-only SQL loss settlement. The loss test accelerates server time through an owned fixture rather than waiting through a campaign.

Run the focused checks from the repository root:

```sh
pnpm exec vitest run games/server/tower-depth.test.ts games/tower-defense/authority.test.ts apps/realtime/src/engines.test.ts
RUN_INTEGRATION=1 pnpm exec vitest run apps/realtime/src/defense.integration.test.ts
pnpm exec playwright test tests/e2e/neon-live.spec.ts
```

The integration suite owns port 3997 and a random namespace and deletes only its fixture rows and keys. One additional Chromium case passed against an isolated live worker using two separate authenticated contexts, actual room commands and real enemy movement. It verifies mid-wave build/upgrade/target/sell, prevents an accidental tab-switch forfeit, and reloads a participant into the same live room. It can target an isolated worker with `E2E_REALTIME_URL` and `E2E_REALTIME_NAMESPACE`; only that isolated-port run bypasses the web page's CSP to permit its temporary socket endpoint. Normal runs keep CSP enforcement and use the configured worker.

This pass does not introduce new maps, enemies, towers or active abilities. The existing three maps, eight tower families, ten enemy roles, four boss profiles, synergies and support effects are available live. Campaign and Endless balance, long four-player sessions, devices and browsers beyond local Chromium, external network impairment and deployed recovery still require broader validation.
