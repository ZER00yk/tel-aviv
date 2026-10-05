# Public matchmaking

The shared multiplayer lobby controls now provide a working public queue. Eligible solo players or ready parties are paired by game, casual mode, player-pool preference and Ego Trip expedition mode. Supported engines include Four in a Row, checkers, chess, After Hours modes, Night Shift and both Ego Trip co-op modes. Found matches use reserved private rooms, explicit ready checks and the existing server-authoritative engines.

Regional choices are player-pool preferences. They do not promise regional hosting or lower latency. Multiplayer competitive ranking and public poker queues are unavailable; the server rejects those requests. Ranked solo Ego Trip and private poker tables retain their separate rules.

## Protocol and eligibility

`game:queue:join` accepts a validated game ID, `region`, `mode`, Ego `coopMode` and optional `party`. The authenticated socket determines the user. Queue responses include only the requesting member's ticket, anonymous pool counts, wait duration, player limits and eventual room reservation. Other queued identities, private presence and canonical game state are not exposed.

A party leader may queue the current party only when every member is ready and connected. The ticket stores the original party kind and member count. Party changes, deletion, disabled accounts, disconnected members beyond their grace period or conflicting lobby membership invalidate the ticket. Blocked accounts cannot be paired, including inside a party. Existing game flags are checked before joining and again before allocation.

`game:queue:status` restores the owned ticket and current authorized room. `game:queue:leave` cancels a waiting party ticket for all its members, or declines an entire matched ready check. Any member may withdraw their own participation. Users must leave a waiting queue before creating another room. Matched room codes are reserved to their queued participants; guessing a code does not grant access.

Every participant must mark Ready. The existing host starts only after the engine verifies readiness and minimum player count. A 45-second ready deadline dissolves a declined/abandoned check and clears memberships. Players can join the queue again deliberately; failed checks do not silently requeue them. Once play starts, ordinary game departure/reconnect rules apply.

## Persistence and recovery

Queue tickets and membership reservations live in PostgreSQL, with a unique active reservation per user and environment namespace. A transaction advisory lock serializes allocation/cancellation. LobbyStore's user/lobby Redis locks prevent competing private-room requests from creating duplicate memberships.

Waiting tickets survive reconnect and worker restart. The worker grants a 30-second connection grace period after restart; waiting members are matched only while actually connected. Waiting tickets expire after ten minutes. Per-user socket rate limits, a maximum of 500 waiting tickets and the existing bounded player limits constrain workload.

Matched lobbies use the existing Redis state plus SQL recovery checkpoints. Reservation IDs are saved in the lobby's first canonical snapshot. If a process dies after partial room creation but before committing queue status, recovery recognizes that reservation and compensates the partial room. It preserves an already-started canonical game instead of creating a second match. Accepted board-game turns are checkpointed on every mutation, so a crash immediately after a move does not depend on the generic one-second snapshot throttle.

Queue events are delivered only to authenticated ticket members. Clients also refresh status and authorized lobby membership periodically, which recovers from missed events or failed delivery. Match-found notifications link each participant to their game without exposing another player's private data.

## Checks and remaining scope

SQL/Redis/socket checks cover strict input and impersonation rejection, separate pools, duplicate joins, blocks, room reservation authorization, decline/timeout cleanup, party authorization, real campaign startup, reconnect, disabled accounts and interrupted allocation. Separate crash tests stop an owned realtime child process and restore a waiting reservation and an active board match after deleting only that test namespace's Redis keys. Browser checks use separate accounts to join the queue, complete a real match, reload a participant and decline a found room.

Advanced skill ratings, latency routing, competitive multiplayer ranking, cross-region expansion, automatic ready/start policies, public poker stake agreement and production-scale load testing remain work. Current matching fills compatible games in arrival order up to their player limit; no invented wait-time prediction is shown.
