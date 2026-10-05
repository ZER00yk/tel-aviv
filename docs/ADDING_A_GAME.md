# Adding an official game

1. Add a truthful manifest to `games/catalog.ts`: stable slug, route, version/save schema, device support, player limits and minimum SDK permissions. Declare only modes that exist. Add an original cover under `apps/web/public/game-covers`.
2. Create `games/<slug>/client.tsx` as a lazy client module accepting the SDK and shared runtime settings. Register it in `games/GamePlayer.tsx`. Import Phaser/Matter only after browser mount. Keep tuning, rules and content in separate modules.
3. Use `GameSDK.user/load/save/start/presence/end`, shared controller/lobby helpers and lifecycle hooks. SDK identity intentionally excludes account secrets and school data. Saves belong exclusively to the slug and use revision checks; a conflict requires reloading and resolving the newer state.
4. Put competitive/economy rules on the server. Add validated authoritative actions in `packages/platform/src/games.ts` and independent rule modules under `games/server`. Use parameterized SQL and atomic balance/ledger updates. Do not let client saves set currency, grant XP or submit arbitrary ranked scores.
5. If multiplayer is core, extend the dedicated realtime engine registry with server validators, per-player views and durable outcomes. Never send future random decisions, other players' roles or answer keys to the browser. Use private/public lobby protocols and existing session-cookie transport.
6. Add immutable numbered migrations for durable data and achievement definitions. Preserve unsupported save versions and existing account/game namespaces. Add critical rule, authorization and database race tests; launch the game through the authenticated platform in Chromium.
7. Document controls, exact content depth, trust model and unfinished modes in the game's README and PROJECT_STATE.md. Casual client simulations must be clearly unranked. Use a feature flag when unfinished behavior would break the launcher.

Run `pnpm typecheck`, `pnpm lint`, relevant tests and the production build. Stop development web first: production and development currently share `apps/web/.next`.
