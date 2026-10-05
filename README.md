# Tell Aviv

An integrated browser space for social communication, playable games, structured community creations, and private school work. This repository implements a substantial build and continuation of [the full product specification](docs/TELL_AVIV_SPEC.md) and [development goals](docs/DEVELOPMENT_GOALS_2.md); [PROJECT_STATE.md](PROJECT_STATE.md) records exact coverage and [known issues](docs/KNOWN_ISSUES.md) records remaining work.

## Development

Requirements: Node 24, pnpm 11, PostgreSQL 17, Redis 7+. Use the existing checkout; each cloud task is isolated and does not require an additional Git worktree.

In the configured cloud workspace, run `bash scripts/cloud-setup.sh` for repeatable dependency/service preparation, then `bash scripts/cloud-start.sh` for both application services. Startup checks readiness and reuses healthy processes. These instructions are saved in the cloud configuration draft.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# Option A: Docker development services
docker compose up -d
# Option B: Debian-based cloud development, no root installation
bash scripts/local-services.sh start
pnpm db:migrate
pnpm dev:realtime
# In another terminal:
pnpm dev:web
```

The local development service password is a non-secret example; it must never be reused for public deployment. `.env` is ignored. Adjust DATABASE_URL to your selected provider. Local uploads use a private STORAGE_LOCAL_PATH outside the checkout; S3-compatible provider configuration is supported separately. The web uses port 3000 and realtime 3001 locally; production routes both through HTTPS 443.

Tell Aviv uses native username/password registration and login with Argon2id. Optional email stays private and must be verified before email recovery. Recovery codes support accounts without an email provider. See [authentication](docs/AUTHENTICATION.md) for session, reset and bootstrap contracts. Development sign-in remains clearly labeled for fixtures, requires `DEV_AUTH=true`, and is disabled in production regardless of the flag; it cannot log into an account with native credentials. No external identity provider is required. Supply production proxy/email settings securely through environment settings.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec tsx --env-file=.env scripts/smoke.ts
pnpm test:e2e
```

The last two commands require running web/database/realtime services. CI runs frozen installation, strict types, lint, unit tests and production build. Integration/E2E results are documented separately rather than represented as unit-test coverage.

Run the complete database/realtime suite with `RUN_DB_TESTS=true RUN_INTEGRATION=1 node --env-file=.env node_modules/vitest/vitest.mjs run`. Default unit tests skip integration cases. Development writes `apps/web/.next-dev` and production builds write `apps/web/.next`, so the build can run while dev remains available. Playwright gives each invocation a unique ignored output directory; use distinct explicit outputs for parallel custom runs.

`pnpm ops:once` inspects maintenance without changing data. Configure the scheduled apply worker and backups using [OPERATIONS](docs/OPERATIONS.md). `pnpm source:archive` creates a fresh source snapshot outside the checkout, checks every archived member, and writes SHA-256/manifest files. Source archives exclude credentials and private uploaded/service data; preserve those through the separate verified backup workflow.

Current deployment checks and remaining public-hosting limits are in [deployment verification](docs/VERIFICATION_DEPLOYMENT_2026-10-04.md). New Ego journeys target 45–60 minutes through missions and boss phases; [pacing measurements](docs/EGO_JOURNEY_PACING.md) distinguish automated evidence from human validation.

## Code boundaries

- `apps/web`: Next.js frontend and authenticated API wrapper.
- `apps/realtime`: Socket.IO presence, events, lobbies and authoritative multiplayer.
- `packages/auth`, `database`, `platform`, `storage`: account identity, durable data, domain permissions and private files.
- `packages/game-sdk`, `game-runtime`: safe game APIs and common lifecycle/input utilities.
- `packages/creator-runtime`: shared validated level schemas and bounded deterministic physics/logic.
- `games`: pure manifests, isolated game clients, config and authoritative simulations.

Private Classes resources never appear in game/social payloads by default. Fictional casino balances and protected rewards change through validated server actions and ledgers. See [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [database](docs/DATABASE.md), and [backup/restore](docs/BACKUP_RESTORE.md).
