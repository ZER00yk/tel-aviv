The Administration page is available to active platform administrators and the
owner. Every request checks the current role in PostgreSQL; a supplied role or an
old browser session cannot grant access. Administrators can change ordinary
accounts and their own settings. Only the owner can change another administrator
account, and the owner account cannot be disabled.

The Accounts tab searches names and usernames and shows current storage usage,
fictional currency balances, recent ledger entries, and casual save metadata.
School files (including trash) and all stored chat uploads use one account budget.
The default is 2 GiB, configurable with `STORAGE_QUOTA_BYTES`. Account overrides
range from 1 MiB to 100 GiB. Quota changes require `QUOTA username` and a reason;
they cannot reduce the budget below existing bytes. They do not delete files.
Both upload handlers lock the same user row before reserving space, so concurrent
school and chat uploads cannot independently consume the final allowance.

Currency grants require a positive integer of at most 1,000,000, a reason, and
`GRANT currency username`. Resets require `RESET currency username` and set the
selected balance to zero. Both supported currencies are fictional: `tell-coins`
and `casino-credits`. Each committed delta is written to `currency_ledger` in the
same transaction as the balance and administrative audit. A first Credits grant
also journals the normal 1,000 opening Credits. An untouched account reset starts
at zero without granting opening Credits. A no-op reset records an audit without
creating a zero-amount ledger entry.

Currency requests require a UUID `operationId`. Concurrent retries with the same
administrator, target, operation, amount, and reason commit one change. Reusing
that UUID for a different change returns 409. Credits resets lock casino state
before the account, following game transaction order, and reject unfinished
Blackjack, Mines, and Poker hands. Resets affect the selected balance alone;
loans, collectibles, marketplace listings, reward timers, and game history remain.

The Accounts tab also resets a selected casual cloud save with
`RESET SAVE game-id username`. Games with writable casual SDK saves are
eligible, including Ego Trip's separate casual campaign save even though it also
has a ranked gauntlet. Its authoritative ranked run remains unchanged. The reset
writes JSON null with a newer revision under the same advisory
lock used by normal saving; a tab holding the previous revision receives a
conflict rather than silently undoing the reset. Authoritative progression,
Casino state, balances, loans, inventory, achievements, XP, and play history remain.
Reload the selected game after reset. Audit evidence records revision and byte
metadata, without retaining the original private save payload.

The Recovery tab resets one stored leaderboard scope, identified by ranked game,
supported category, period, and concrete UTC key. All-time keys use `all`, daily
keys use a valid date, and weekly keys use a Monday. The confirmation is
`RESET LEADERBOARD game-id category period key`. Only rows in that scope are
deleted. Game totals and achievements remain. A stored scope epoch captures each
account's cumulative baseline: later scoring publishes only progress earned after
the reset. An unchanged old save cannot repopulate the scope. Run-based games
require a fresh server run ID/start time after the epoch. Other categories and
periods keep their scores. Retries with the same operation UUID do not remove
scores added after the original reset. These epochs protect resets; they do not
implement a complete season/reward system.

Emergency removal accepts a known message or public creation UUID and requires
`REMOVE MESSAGE uuid` or `REMOVE CREATION uuid`, plus a reason. It does not provide
private chat, school content, or private draft previews/search. A message becomes
a deleted tombstone; reactions, pins, poll content/votes, and attachment metadata
are removed atomically with the audit. Attachment objects enter the durable
storage cleanup queue, so provider failures can be retried. A committed deletion
publishes `chat:message:delete` through Redis for authorized live viewers. Public
creation removal permanently deletes the creation and its versions, comments,
likes, and favorites. Private creation IDs return 404, even to administrators.
Audits retain identifiers and reasons rather than removed message/creation text.

All three recovery operations use UUID idempotency. Concurrent duplicates commit
one change, and retries remain valid after deleted content is gone. A save reset
retry cannot erase progress saved after the original operation. Changing the
target, scope, or reason while reusing an operation UUID returns 409.

Account disable and enable require `DISABLE username` or `ENABLE username`.
Disabling also revokes sessions atomically. The Audit tab displays the most recent
100 balance, quota, save, leaderboard, content, account, feature flag, and
announcement changes.
`admin_audit_log` preserves administrator and target IDs/usernames, action,
details, and time. Database triggers reject UPDATE and DELETE, and account
deletion does not cascade into this evidence. Infrastructure/database operators
with sufficient privileges can still alter the database; this is application
audit integrity, not an external tamper-proof logging service.

API routes:

- `GET /api/admin/users?q=name` searches at most 100 accounts.
- `GET /api/admin/users/:id` returns storage, balances, ledger, and save metadata.
- `POST /api/admin/users/:id/quota` accepts `quotaBytes` (integer or null for the
  default), `confirmation`, and `reason`.
- `POST /api/admin/users/:id/currency` accepts `operationId`, `currency`, `mode`,
  `amount` (positive grant or zero reset), `confirmation`, and `reason`.
- `POST /api/admin/users/:id/save-reset` accepts `operationId`, `gameId`,
  `confirmation`, and `reason`.
- `GET /api/admin/leaderboards` returns supported games/categories, current UTC
  keys, and counts for at most 200 stored scopes.
- `POST /api/admin/leaderboards/reset` accepts `operationId`, `gameId`, `category`,
  `period`, `periodKey`, `confirmation`, and `reason`.
- `POST /api/admin/content/remove` accepts `operationId`, `kind` (`chat-message` or
  `public-creation`), `id`, `confirmation`, and `reason`.
- `POST /api/admin/users/:id` accepts `disabled` and `confirmation`.
- `GET /api/admin/audit` returns recent immutable administrative evidence.

Validation: `RUN_DB_TESTS=true node --env-file=.env node_modules/vitest/vitest.mjs
run tests/admin-database.test.ts` exercises authorization, confirmation,
concurrent/idempotent grants, reset ledger conservation, active-hand protection,
combined storage usage, quota rollback, audit immutability, account deletion, and
session revocation. Synthetic audit evidence intentionally remains after test
account cleanup.

`RUN_DB_TESTS=true RUN_INTEGRATION=1 node --env-file=.env
node_modules/vitest/vitest.mjs run tests/admin-database.test.ts
tests/admin-recovery-database.test.ts` passes 16 database tests, including actual
Redis event delivery after removal. Recovery checks cover exact scope boundaries,
invalid dates/categories, stale tabs, concurrent retries, progress added after
reset, authoritative game exclusions, private draft privacy, deletion cascades,
attachment cleanup, and immutable evidence.

The browser flows are covered by `node --env-file=.env
node_modules/@playwright/test/cli.js test tests/e2e/admin.spec.ts`: it searches a
test account, sets a quota, grants and resets Credits, clears a casual save,
resets a historical fixture score scope, removes a message seen by a second live
browser, removes a public creation, and verifies the audit trail without browser
errors.

The Overview includes actual storage/realtime checks, recoverable SQL checkpoints,
cleanup retries, missing/size-mismatched objects, maintenance state, HTTP request
counts/latency, realtime connection/error aggregates and verified backup status.
Private exporters retain bounded process snapshots in SQL for 48 hours after their
last flush; counters describe each process lifetime rather than a sliding event
window. See [reliability](RELIABILITY_3.md) and [encrypted backups](ENCRYPTED_BACKUPS.md).
Credits resets also reject an active multiplayer poker escrow, checked under the
wallet lock used by table buy-ins.

[Seasons](COMPETITION_SEASONS.md) now provide previewed, audited start/finalization
and once-only reward claims. [Creator reports](CREATOR_COMMUNITY.md) provide
reasoned review/dismissal with immutable audit evidence.

Remaining scope: authoritative save reset/version tools, automatic season
scheduling and live gameplay configuration editing are not implemented by
these controls. Balance configuration remains in typed game
configuration files. There is no administrative school/private-draft content
browser or content restoration interface.
