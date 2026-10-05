# Creator 2.0

Creator stores validated structured levels; it never runs uploaded JavaScript. Schema versions 1 and 2 remain readable. Old moving-platform and button/door levels keep their behavior. The editor supports selection, dragging, resizing, rotation, layers, snapping, duplication/deletion, undo/redo, versioned saves/restores, explicit publication, and local playtests.

## Structured logic and objects

The visual editor builds event → optional condition → ordered actions. It supports labels, enable/disable, duplicate/delete/reorder, reference selectors, typed variables, atomic variable renaming, and nested AND/OR conditions. Events cover start/death, object contact/destruction, zones, buttons, checkpoints, collectibles, enemies, timers, variable changes/thresholds, and named custom events. Conditions cover variables, inventory, health, object/door/enemy state, timers, player count, and seeded chance. Actions activate/deactivate/toggle, move/spawn/destroy objects, control doors, teleport, heal/damage, change inventory/variables, display text/objectives, play bounded procedural sounds, start timers, trigger events, and complete/fail the level.

Sixteen object types are functional: platform, moving platform, spikes, spring, checkpoint, finish, door, button, decoration, trigger zone, collectible, enemy, sign, teleporter, switch, and pressure plate. Enemies can be defeated by stomping; collectibles update inventory and emit events. Rotation renders correctly but collision uses an enclosing axis-aligned rectangle. Moving-platform paths are bounded and grounded players are carried. Four editable templates demonstrate a starter platformer, key/door logic, a timed gate, and moving-platform/spring traversal.

Validation limits levels to 300 objects, 32 typed variables, 64 logic blocks, 16 actions per block, three nested condition-group layers, and 1,024 total logic nodes. Runtime limits include 32 spawned objects, 64 queued events and 256 actions per tick, and 20,000 total actions. Cyclic event graphs stop with a visible warning. Chance uses deterministic seeded random state. Names, references, type compatibility, dimensions, coordinates and finite values are validated before saving. Player-count conditions currently evaluate a single player.

## Discovery and verified community play

Published levels support six categories, text/tag/creator search, favorites-only filtering, creator links, recent/popular/liked/completed sorting, and 24-item pages with a total count. Community discovery returns metadata; private level snapshots remain owner-only. Disabled authors are excluded. Existing play counts are preserved; new visits deduplicate each account/creation/day. Comments are escaped text, limited to ten per account/minute. Accounts may retain up to 200 creations; reaching the cap does not remove existing work.

Community play starts a server-owned attempt containing an immutable level/version and random seed. The browser uses that pinned level for rendering and local prediction. It submits only movement inputs and a sequence number. The server independently runs the shared physics/logic interpreter at 60 fixed ticks/second under an attempt row lock, checks elapsed wall time, and records a completion once per account/creation/version. Browser positions, claimed winners and scores are rejected. A saved edit during an active play cannot change that attempt's geometry. Unpublication prevents further attempt access/advancement. Local editor playtests remain casual; Creator completions award no ranked score, XP or currency.

An input request contains at most 60 frames and 300 ticks; a frame contains at most 60 ticks. Attempts permit five minutes of simulated time, expire after twenty minutes of wall time, and starts are capped at thirty/account/hour. A new start expires the account's older playing attempts. Duplicate/concurrent sequence submissions cannot advance twice. Verified community play reports completion only after the server confirms it.

## API

| Route                                  | Behavior                                                   |
| -------------------------------------- | ---------------------------------------------------------- |
| GET/POST `/api/creations`              | Filtered discovery plus own drafts / create draft          |
| GET/PATCH `/api/creations/:id`         | Owner or published read / owner version-checked edit       |
| POST `…/:id/publish`                   | Owner publication; requires finish zone or complete action |
| GET `…/:id/versions`                   | Owner revision metadata                                    |
| POST `…/:id/restore-version`           | Restore snapshot as a new revision                         |
| POST `…/:id/like`, `…/:id/favorite`    | Idempotent community preferences                           |
| POST `…/:id/comments`, `…/:id/play`    | Escaped comment / deduplicated visit                       |
| POST `…/:id/attempts`                  | Start pinned, server-owned attempt                         |
| GET `…/:id/attempts/:attemptId`        | Recover own published attempt, including pinned level      |
| POST `…/:id/attempts/:attemptId/input` | Advance using `{expectedSequence, frames:[{keys,ticks}]}`  |

## Validation and boundaries

Runtime tests cover schema-1 compatibility, nested conditions, references, seeded determinism, object interactions, logic cycles/budgets, movement and completion. Real database cases cover authoritative replay, forged payloads, sequence races, version pinning, private/unpublished access, discovery, visit deduplication, comment rates and account caps. Chromium tests create and save logic using the editor, reload it, play the resulting level, and verify server completion plus the gallery count.

Precise slopes, saws/explosives/vehicles, uploaded asset packs and thumbnails, difficulty ratings, reports/follow controls, fastest-time leaderboards, multiplayer, collaborative editing, and autosave remain outside this implementation. Explicit save and conflict handling preserve existing level versions. Completion counts span distinct account/version records; they are not a deduplicated lifetime-player count or a measured completion rate.
