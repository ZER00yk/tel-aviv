# Competition seasons

Competition seasons keep their own dated standings and reward receipts. Starting a later competition leaves ordinary all-time/daily/weekly boards and earlier finalized results intact. Migration `035_game_seasons.sql` adds the season, eligible-mode, cumulative-baseline, entry, frozen-standing and reward-receipt tables; it does not rewrite earlier migrations.

## Scoring and history

Only the existing authoritative leaderboard settlement calls `recordSeasonScore`. There is no public score-submission endpoint. A season supports up to twelve explicitly selected ranked game/category pairs. Run-based results need a server-owned run identity and a start timestamp within the season; old runs, future timestamps and missing identities are ignored. Cumulative incremental, tycoon and casino modes record progress above the balance captured at the season's start, including persisted progress from accounts without a visible leaderboard entry. Deleting or resetting an ordinary board does not replace this baseline.

Authoritative cumulative actions take a shared per-game SQL advisory barrier before reading or mutating their state. Season creation takes the exclusive counterpart for each selected cumulative game, in sorted order, before capturing its start clock and baselines. Existing actions commit before that snapshot; new actions wait until creation commits. Different players otherwise share the barrier and can continue concurrently. This prevents already staged progress from becoming season credit after an unchanged follow-up action.

New scores stop at the deadline. Finalization locks the season against concurrent scoring, filters disabled accounts and freezes ranks with score, first-recorded time and immutable user ID as deterministic tie breakers. Each mode admits at most 10,000 entries. The signed-in standings view displays the first hundred ranks per mode plus the requesting account's position. Earlier frozen standings remain available when another season starts. Account deletion removes active entries and anonymizes frozen results and receipts without changing rank or reward amounts; public history does not copy private activity or deleted usernames.

## Rewards and administration

Administrators use the **Seasons** tab to preview a start or finalization, enter the exact scoped confirmation and record a reason. The server rechecks the administrator's enabled account and current role inside the transaction. Every operation has a UUID; an exact retry returns its committed result, while reuse for a different actor, action or proposal rejects. Immutable audit rows record the proposal and resulting season identity. Preview does not mutate standings, balances or audit rows.

A season begins when confirmed, ends between one minute and ninety days later and has three nonincreasing podium rewards per eligible mode, each between zero and 1,000 fictional Tell Coins. At most ten unfinalized seasons can exist. Finalization can happen early after a preview explicitly identifies that effect. No automatic scheduled finalizer is implemented; an expired season reports that it is awaiting results and accepts no more scores.

After finalization, each account explicitly claims all its unclaimed rewards for that season. The server locks the account, owned standing rows and wallet, then commits the wallet credit, currency ledger entry and unique standing receipt together. Concurrent requests and retries cannot issue another credit. A balance-cap failure rolls back the whole claim. Frozen rewards and receipts reject later edits; foreign-key anonymization on account deletion is allowed. All rewards are fictional platform currency.

## Verification and remaining scope

Eleven isolated PostgreSQL cases pass, covering nonmutating previews; current administrator roles; bounds and unsupported modes; concurrent starts and exact retries; run eligibility; cumulative baselines; deterministic frozen results and preserved prior seasons; concurrent once-only claims and matching ledgers; over-cap rollback; deadlines and disabled accounts; deletion anonymization; and score/finalization/deletion races. The focused report is `.local/verification/features-focused-4.json`.

A separate real PostgreSQL concurrency regression in `tests/feature-concurrency-database.test.ts` blocks an actual incremental action on its owned state row, verifies that season creation waits for that action, then proves its committed prestige is captured in the baseline and an unchanged real action earns no new season score. It does not impose the application's advisory lock from the test.

The browser case uses two authenticated contexts: administrator preview/start, a real server-simulated Neon Defense wave to produce the score, visible player standings, preview/finalization, claim, reload, duplicate-claim rejection and a 375-pixel viewport check. Final browser counts and artifact paths are recorded in the current verification report.

The reusable model supports multiple eligible modes, but the administrator form currently creates one mode at a time. Automated season schedules, shared daily challenge seeds, tournaments, additional reward kinds and production load testing remain unfinished.
