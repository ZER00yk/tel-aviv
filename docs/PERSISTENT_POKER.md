# Persistent private poker tables

The Private poker tab now offers an opt-in **Keep table open between hands** mode. Legacy one-hand rooms remain the default. A persistent room keeps one table identity, its funded seats and their fictional chip stacks across distinct hands; hand completion does not reserve another buy-in or return chips to the wallet.

## Using a table

The host enables persistent mode before dealing, chooses minimum and maximum buy-in bounds between 100 and 10,000 Credits, and applies the options. Those bounds are immutable while the table is open. Each account explicitly reserves its own chosen amount before becoming Ready. Every funded, active seat must be connected and ready; sitting-out and unfunded room members do not participate in the deal. The host starts the next hand in the same room after the prior one ends.

A funded account can sit out or return between hands. Rebuys explicitly add wallet Credits between hands; the resulting stack must fall within the table bounds. Winning stacks can exceed the buy-in maximum and continue playing, but cannot receive another top-up while above the maximum. A table holds at most 60,000 chips. Hand numbering is bounded at 10,000, after which the host must close and open a fresh table.

The dealer rotates between hands. Blinds advance every ten hands: 5/10, 10/20, 20/40, 50/100, then 100/200. A short stack can post a partial blind; when no further betting is possible the server runs out the board immediately. There is no rake, external prize, real-money purchase or real-money withdrawal.

Leaving between hands returns the account's retained fictional stack once. Leaving during a hand folds an active seat; a seat already all-in remains eligible for its side pots. The departing account's final stack returns after that hand settles. The host can close a table between hands, returning all remaining retained stacks once. Room ownership transfers to a remaining member when the host leaves.

## Canonical state and financial invariants

Migration `033_persistent_poker_tables.sql` adds separate table, seat, operation, hand, private-hand-seat and chip-journal records; the legacy tables and their applied migration remain unchanged.

`packages/platform/src/casinoPokerTables.ts` handles persistent finances inside the same SQL transaction as `LobbyStore`'s canonical checkpoint and terminal multiplayer result. The wallet changes only for an explicit seat reservation/rebuy, departure, closure or abort. Ordinary hand starts and finishes move chips between retained table seats without a wallet debit or credit. Total stacks plus the active pot conserve the sum of that hand's actual starting stacks, including unequal stacks from prior hands.

Every seat operation has a request UUID and a digest. Repeating the same operation returns the already committed effect; reusing its UUID for different values fails. An active seat is unique per account across persistent tables, and wallet locks also serialize it against legacy hand escrow and administrator resets. A reset is rejected while an account holds a persistent seat, including between hands.

Checkpoint settlement locks existing and proposed participant account references in sorted order before taking the table lock or writing financial foreign keys. This matches account deletion's user-before-table order. A participant added while a caller waits requires a fresh retry rather than acquiring a user lock after the table lock. A real PostgreSQL concurrency regression starts a hand while deletion owns a participant row, then verifies that deletion and hand recovery complete without a deadlock, the table closes, surviving chips return exactly once and no active hand/seat remains.

Each hand has a new match UUID and monotonically separated revisions. Persistent decisions must include the exact current revision, so duplicated and old-hand actions fail. Financial state digests canonicalize object keys while retaining array order. Repeated SQL checkpoints do not reapply chip allocations or wallet operations. Poker reads SQL as canonical even if a stale Redis snapshot survived a process failure.

Account erasure closes an associated persistent table. If a hand is active, the abort restores that hand's starting stacks before returning remaining participants' chips; previously settled hands remain committed. Explicit account cleanup and a defensive SQL deletion trigger implement this rule. Orphan tables expire only after twenty-four hours without an unexpired checkpoint, using bounded, locked maintenance.

## Privacy and history

All shuffling and dealing remain server owned. During betting, each participant sees only their own cards; sitting-out and unfunded room members see masked pockets. Fold winners keep their cards private. Only nonfolded hands at a genuine five-card multiplayer showdown are revealed. No client view or participant history exposes deck order.

The casino history includes each requesting participant's own cards, public actions/board, hand number, table identity, starting stack and ending stack. An ending stack in persistent history is retained at the table, rather than a per-hand wallet return. The requesting account's export also includes its own persistent table/seat history; interactive lists are capped at fifty records while exports are complete.

## Validation and limits

Eighteen engine tests include 120 six-player mixed-action stress hands, three unequal all-ins, layered and split side pots, ties, folded contributors, odd chips, blind-only runouts, private sitting-out views, stale actions across hands and unequal-stack cancellation. Thirteen dedicated SQL/Redis tests cover three real retained-stack hands, operation idempotency and rollback, current block checks before reservation, sit-out/departure, retained all-in settlement, SQL recovery, competing legacy/persistent escrow, simultaneous six-seat room joins, disconnect timeout, administrator reset, account deletion, private exports and orphan expiry. Twelve legacy financial tests remain passing.

The new browser case exercises actual controls in a two-account room, two hands, dealer rotation, reload/private-card recovery, retained balances, no repeated buy-in and final table closure. Final integrated pass counts belong in the current verification report.

The current shared-worker run also passed both persistent and legacy poker cases with the normal development Content Security Policy and no endpoint redirect or CSP bypass. Their results appear in `.local/verification/ego-coop-poker-browser-4.json`. These are local HTTP Chromium checks; production TLS and network impairment need separate verification.

Private room-code invitation is implemented. Friends/public table discovery, public stakes browsing, tournaments, table balancing, elimination/reward schedules, table spectators with separate permissions and a proven multi-worker table scheduler remain unfinished. This is a persistent private-table foundation, not tournament or production-scale completion.
