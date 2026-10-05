# Realtime and multiplayer

Final game outcomes and recovery checkpoints commit in one SQL transaction for
all engines. Empty-room outcome/refund persistence and checkpoint deletion are
also atomic. A failed checkpoint cannot leave a recorded winner attached to an
older playing snapshot. Periodic playing combat snapshots retain their existing
throttle; immediate turn games read the committed SQL checkpoint even when Redis
holds an older revision. Other engines prefer SQL when the committed match ID,
status or recorded outcome differs, while retaining newer unsaved simulation
within the same playing match. `tests/lobby-checkpoint-database.test.ts` covers
seven real database/Redis rollback, retry, departed-participant, terminal-cache,
new-match and unsaved-progress cases.

`apps/realtime` is a dedicated Socket.IO service. PostgreSQL holds accounts, friendships, permissions, parties, chat, queue reservations, private recovery checkpoints, poker escrow and completed match results. Redis holds connection/presence TTLs, lobby membership, active authoritative matches, locks and an event channel. The Next.js API publishes committed social updates through `apps/realtime/src/events.ts`; consumers recheck room access before delivery.

## Run locally

1. Copy `.env.example` to `.env` and use `postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv` for the supplied local services.
2. Run `docker compose up -d`, or `scripts/local-services.sh start` on Debian 13. The latter runs PostgreSQL 17 and Redis as the current user, downloading packages through APT's signed HTTPS repositories and checking package hashes. It stores generated files under ignored `.local/services`, binds services to loopback, and needs no privileged package installation.
3. Run `pnpm db:migrate`, `pnpm dev:web`, and `pnpm dev:realtime` in separate terminals.
4. `GET http://localhost:3001/health` checks both SQL and Redis.

`REALTIME_PORT` defaults to 3001. `APP_URL` defines the allowed browser origin; `REALTIME_ALLOWED_ORIGINS` adds comma-separated exact origins. `NEXT_PUBLIC_REALTIME_URL` is the browser service URL. In production terminate TLS on port 443 and proxy `/socket.io` to this service; preserve HTTP long polling as well as WebSocket upgrades. Configure shared Redis and durable PostgreSQL, restrict access to both, and require production authentication. The development database password is for loopback development only.

Each cloud task already has an isolated checkout. Use the existing checkout; do not create Git worktrees unless the user requests one.

## Authentication and privacy

Clients connect with `io(url, {withCredentials:true, transports:['polling','websocket']})`. Identity comes exclusively from the HttpOnly `ta_session` cookie and its live SQL session. The service rejects missing or unapproved Origins, checks the session on actions and deliveries, and disconnects expired sessions. Client supplied IDs never authenticate a connection.

`room:subscribe {roomId}` checks DM/group/party membership or server/channel role permissions. IDs can be canonical UUIDs or `global`. Typing checks send permission. Subscriptions do not preserve access after a kick or block: each private room event checks permissions again. Message creation, edit, delete, reactions and persistence use the authenticated HTTP API. Socket messages notify clients to refresh their authorized HTTP history.

Presence is stored for 90 seconds and refreshed every 30 seconds. `presence:snapshot {}` returns the viewer and their unblocked friends; `presence:update` delivers changes. `presence:status {status}` saves `online`, `idle`, `dnd`, or `invisible`; browser activity heartbeats support automatic idle without overriding a manual status. Invisible friends appear offline with no activity. A user's `privacy.showActivity=false` hides activity from other users. Private lobby codes are never included in presence. Multiple tabs use a Redis connection set so closing one tab does not mark an active user offline. Each worker records only its own socket IDs and removes those stale IDs after recovering its exclusive namespace lease.

## Lobby protocol

All requests acknowledge `{data: result}` or `{error: message}`. Clients receive `game:lobby:state` with their authorized view. Membership and state changes use Redis locks; per-user locks prevent joining multiple lobbies concurrently. Six-character room codes support private invites; public lobbies are discoverable through a filtered list.

| Request                    | Payload                                 | Result                                                          |
| -------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| `game:lobby:create`        | `{gameId,visibility,coopMode?}`         | Lobby view; Ego Trip and poker require private visibility       |
| `game:lobby:join`          | `{code}`                                | Lobby view                                                      |
| `game:lobby:recover`       | `{}`                                    | Current lobby or null                                           |
| `game:lobby:list`          | `{gameId?}`                             | Public waiting-room summaries                                   |
| `game:lobby:ready`         | `{ready:boolean}`                       | Lobby view                                                      |
| `game:lobby:start`         | `{}`                                    | Lobby view; host only, all connected and ready                  |
| `game:lobby:leave`         | `{}`                                    | `{ok:true}`                                                     |
| `game:action`              | A game-specific action below            | Lobby view                                                      |
| `game:lobby:chat`          | `{text}`                                | Message, also pushed to authorized recipients                   |
| `game:lobby:poker-options` | `{buyIn:100..10000}`                    | Host-only agreed stake; clears all readiness                    |
| `game:queue:join`          | `{gameId,region,mode,coopMode?,party?}` | Own queue ticket/reservation; see [MATCHMAKING](MATCHMAKING.md) |
| `game:queue:status`        | `{}`                                    | Own ticket, anonymous pool counts and authorized reservation    |
| `game:queue:leave`         | `{}`                                    | Cancels waiting ticket or declines a ready check                |
| `party:recover`            | `{}`                                    | Durable party and members                                       |
| `party:launch`             | `{gameId}`                              | Shared private lobby; leader only, ready online members         |

The view includes `code`, `matchId`, `gameId`, `hostId`, `status`, `visibility`, `players`, `state`, and `serverTime`. `players` is an explicit public-identity/readiness/connection whitelist; private settings and authentication fields never reach peers. Authenticated users recover only their own membership. Ordinary games have a sixty-second reconnect window and forfeit on departure/expiry. Ego campaign members have two minutes while teammates continue; an all-offline campaign saves and pauses. Poker uses normal check/fold timeouts and keeps departed financial seats until payout. See each game contract for these distinctions.

Redis lobby records expire after one inactive hour. SQL recovery checkpoints expire twenty-four hours after their latest save. Completed summaries and outcomes are recorded transactionally in `multiplayer_matches` and `multiplayer_results`; generic browser saves cannot submit them. Deleted or disabled accounts are pruned before mutation, so result writes cannot become stuck behind a missing-player foreign key.

## Recovery and worker ownership

`REALTIME_NAMESPACE` defaults to `tell-aviv` and scopes lobby keys, membership, worker leases, checkpoints and queue reservations. A five-second Redis lease permits one worker per namespace. A worker that loses its lease stops accepting game mutations or advancing simulation. Other namespaces retain their own rooms and socket registries.

Startup checks current SQL checkpoints and rehydrates missing Redis lobby/membership records. Recovered playing matches are marked disconnected and paused until an authenticated existing participant returns; game clocks shift by the paused duration. Server-only secrets remain in the private canonical checkpoint. Views are rebuilt separately for each participant rather than publishing that checkpoint. Ordinary simulation checkpoints are throttled to about one second, with immediate room/status/connection transitions. Accepted chess/checkers/Four in a Row turns and every poker mutation force a save. Those turn games read the latest SQL checkpoint even when Redis retains an older room, covering the crash window between SQL commit and Redis update. Other engines consult SQL to preserve committed lifecycle transitions and terminal outcomes, then retain their potentially newer Redis simulation when those lifecycle fields match. Unlocked reads do not overwrite an existing cached room; startup persists pause metadata while holding its exclusive namespace lease.

Poker reserves or returns wallets inside the same SQL transaction as its corresponding checkpoint; a failed initial save cannot leave stakes behind. A graceful close drains work and saves rooms before releasing its lease. An abrupt process kill restores the latest committed snapshot, so ordinary high-frequency movement may roll back about one second. Deployment still requires durable SQL, secure Redis and a process supervisor. The exclusive worker lease is not a claim of horizontally distributed simulation or production load readiness.

## Playable engines

| Game ID            | Players      | Server actions and rules                                                                                                                                                                          |
| ------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connect-four`     | 2            | `drop {column:0..6}`; legal columns, turn order, wins and draws                                                                                                                                   |
| `checkers`         | 2            | `board:move {from,to}`, resign and mutual draw; mandatory captures, chained jumps, promotion, blocked-side wins and draw rules                                                                    |
| `chess`            | 2            | `board:move {from,to,promotion?}`, resign and mutual draw; chess.js legal checks, castling, en passant, promotion, mate and draw rules                                                            |
| `poker`            | 2–6, private | Fold/check/call/raise/all-in, rotating blinds, layered pots, private pockets and atomic wallet settlement; [PRIVATE_POKER](PRIVATE_POKER.md)                                                      |
| `trivia`           | 2–8          | `answer {answer:0..3}`; five timed rounds, one answer each, server question/answer and scoring                                                                                                    |
| `reaction`         | 2–8          | `react`; five random signal rounds; server elapsed time, early-click penalty, no future signal or derivable deadline disclosed                                                                    |
| `drawing`          | 2–8          | `stroke {points:[{x,y}],color:'#rrggbb'}`, `guess {text}`; each player draws once, bounded canvas/strokes, secret word only sent to current drawer                                                |
| `ego-trip`         | 2–4, private | Legacy four-boss gauntlet or forty-room/eight-district campaign; authoritative enemies/arenas, shared route choices, personal rewards/helpers, revives and team outcomes; [EGO_COOP](EGO_COOP.md) |
| `social-deduction` | 4–12         | `move {dx,dy}`, `task {taskId}`, `meeting {bodyId?}`, `vote {targetId}`, `eliminate {targetId}`, `sabotage`, `repair`                                                                             |

Social deduction is an original top-down expedition game. Crew complete assigned nearby tasks; hostiles eliminate nearby crew with cooldowns or sabotage a beacon. Nearby bodies can be reported, and the central console grants limited emergency meetings. Meetings pause actions and resolve timed votes without revealing individual choices. Crew win by completing all tasks or removing every hostile. Hostiles win through numerical control or an unrepaired timed sabotage. Eliminated crew can move and finish tasks, with separate dead-player chat. Living players chat only during meetings. Roles, tasks and ally identities are constructed separately for each player; the canonical hidden state is never spread into a public payload. Only own-role information and permitted hostile ally IDs are transmitted.

The current role implementation supports crew and hostile roles. Custom/neutral roles, spectator feeds, competitive multiplayer ranked rewards, in-game voice and persistent game-chat history are not implemented. [Public matchmaking](MATCHMAKING.md) supports casual queues and ready parties, anonymous pool status, ready checks and crash recovery; poker remains private with explicit stake consent. Durable party creation/invites/leadership/chat/ready/game selection use the social HTTP API; Socket.IO carries their updates and game launch. Redis pub/sub forwards committed notifications while namespace leases protect authoritative game ownership.

## Validation

`pnpm exec vitest run apps/realtime/src/engines.test.ts` covers turns/wins, readiness, validation, server timing, score authority, hidden quiz/reaction/drawing state, roles, movement limits, votes, proximity and sabotage.

`RUN_INTEGRATION=1 pnpm exec vitest run apps/realtime/src/server.integration.test.ts` starts a temporary listener on 3991 against the configured migrated development SQL/Redis services. It verifies cookie and Origin rejection, polling fallback, private subscription denial and revocation, invisible presence, actual match play with durable outcomes, reconnect recovery, hidden roles on the wire, separate dead chat, and abandoned-match expiry. Fixtures and their Redis lobby records are removed after the suite. Use a disposable development database rather than production data.

`RUN_INTEGRATION=1 pnpm exec vitest run apps/realtime/src/recovery.integration.test.ts` owns an isolated child process on 3993. Seven cases cover actual SIGKILL campaign recovery, SQL restoration after scoped Redis loss, drawing-word privacy, real checkers/chess outcomes and an older board cache, poker checkpoint/escrow rollback and one-time showdown after stale retained Redis and complete Redis loss, poker account-erasure refunds, preservation of already-paid outcomes after account deletion/disable, and missing-account cleanup. Related queue integration checks crash recovery and immediate board-turn durability. Browser cases exercise separate accounts in campaign rooms, board variants, queues and private poker. See the linked game/queue contracts for their exact tested scope.

Catalog feature switches apply to create, new joins, starts, queues and public discovery. Board aliases map to `games.board-games`, party aliases to `games.party-games`, and poker to `games.casino`. Existing playing members can reconnect and finish when a switch is disabled, preserving their outcome. Account/session validation and block checks remain live; a stale cookie cannot recover another participant’s hidden state.
