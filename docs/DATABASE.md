# Database and migrations

PostgreSQL 17 stores immutable UUID users, Argon2id native credentials, digested version-bound sessions and one-use recovery, social graph and rooms/messages, server memberships/roles, private school resources and shares/revisions, structured creations, game saves/states/sessions, achievement definitions/unlocks, verified leaderboard records, and transactional currency accounts/ledger. Historical external identifiers remain for ownership compatibility; OAuth is no longer a supported sign-in path.

Goals 3 adds migrations `030`–`037` for native authentication/request budgets, full ranked Ego campaigns, persistent poker tables, Creator community, seasons, co-op progress receipts and operational metrics/worker generations. All 36 source migrations match their applied SHA-256 checksums. Existing numbered migrations remain immutable; `020` is intentionally unused.

Run `pnpm db:migrate` from repository root. The runner reads `.env`, sorts `packages/database/migrations/*.sql`, obtains a PostgreSQL advisory transaction lock, applies each file atomically, and records a SHA-256 checksum. Applied files must remain immutable; add a new numbered migration for changes. It never resets existing data. Drizzle maps identity entities; domain SQL is parameterized via postgres-js.

Development service data is ignored under `.data`/`.local` as described by the service script. Production should use persistent volumes with scheduled backups. Never delete volumes as part of normal setup. Users and sessions use stable UUID identities rather than usernames; username changes preserve ID/history.
