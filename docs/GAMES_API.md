# Game platform API

All routes require the authenticated platform session cookie. The route wrapper checks mutation origins and JSON content types. Responses are wrapped as `{data: ...}`; expected rejections are `{error: string}` with an appropriate HTTP status. A user ID in a payload never supplies authentication. Games receive only safe game identity, never class resources, email, tokens, or private notes.

Use the shared `GameSDK`, game metadata in `games/catalog.ts`, and client-safe balance data in `games/config/`. `games/server/` is server-only and imports secure server randomness.

## Platform routes

- `GET /api/games`: `{games:[GameManifest & {favorite,livePlayers}],history:[{gameId,lastPlayed,sessions}]}`.
- `GET /api/games/history`: recent unique games with `gameId`, `lastPlayed`, and `sessions`.
- `GET /api/games/:id`: `{game,favorite,stats:{sessions,lastPlayed,playSeconds},achievements,changelog}`.
- `GET /api/games/:id/user`: `{id,username,displayName,avatar,xp,level}`.
- `POST /api/games/:id/favorite`: `{favorite:boolean}` → `{favorite}`.
- `POST /api/games/:id/start`: optional `{mode:string}` → `{id,gameId,startedAt,mode}`. Starts one active session per user; switching games ends the prior session atomically. Repeated starts of the same game reuse the session.
- `POST /api/games/:id/presence`: optional `{mode:string}` refreshes the active session and realtime activity; returns `{gameId,mode,expiresIn:90}`. Send every thirty seconds while playing.
- `POST /api/games/:id/end`: optional `{sessionId:uuid}` → `{ended,session}`. The server verifies session ownership and the game namespace.
- `GET /api/games/:id/achievements`: definitions with `unlockedAt` and `unlockCount`. Achievements are unlocked only from verified server state. There is no client unlock endpoint.
- `GET /api/games/:id/leaderboard?category=default&period=all&scope=all`: `{entries:[{rank,userId,username,displayName,avatar,score,metadata,recordedAt}],ranked,category,period,periodKey,scope}`. Periods: `all`, `daily`, `weekly` (UTC Monday). Scope: `all` or `friends`. Casual games return empty entries and `ranked:false`; there is no arbitrary client score submission route.

## Versioned cloud saves

`GET /api/games/:id/save` returns `{data,schemaVersion,revision,updatedAt,authoritative:false}`. A new save returns `data:null`, `revision:0`. `POST` accepts `{data,schemaVersion:1,expectedRevision?:number}` and returns the new revision. The SDK carries the loaded revision. A stale revision is HTTP 409 and does not change the stored data. Namespaces are authenticated user + game ID, each write is atomic, and save payloads are capped at 256 KiB. Unsupported schema versions and downgrades are rejected without discarding old data.

Games that grant authoritative progression omit `saves.write` from their manifests and use action state instead. Other generic saves, including Ego Trip and physics worlds, cannot set protected balances, XP, achievements, inventory, or ranked scores. They are explicitly casual.

## Authoritative actions

`POST /api/games/:id/action` accepts `{action:string,payload?:object}`. Every action returns `{state,achievements:string[],authoritative:true,schemaVersion:1}`. `action:'state'` creates or loads state and advances server time where relevant. The server serializes actions for the authenticated user and game, calculates outcomes, and commits progression, achievements, currency, and ranking in one transaction. Payloads never include authoritative balances, clocks, or scores.

### Signal Foundry (`incremental`)

State: `spark`, `alloy`, `insight`, `machines:{extractor,smelter,lab}`, `upgrades:{efficiency,automation}`, `prestige`, `ascensions`, `totalProduced`, `lifetimeProduced`, `lastTick`, `offlineSeconds`.

Actions: `tap` (at most ten/second), `buy {machine,quantity?:1..25}`, `upgrade {upgrade:'efficiency'|'automation'}`, `prestige`, `ascend`. Generators produce spark, forges consume spark to make alloy, laboratories consume alloy to make insight. Automation and efficiency alter production. Prestige requires 10,000 spark produced this workshop and resets resources/machines while preserving lifetime statistics. Ascension requires ten prestige and 100 insight and opens a second permanent multiplier. Offline production uses server timestamps, capped at eight hours, and cannot be replayed by resending a request. Rankings: `default` prestige/ascension milestones, `production` lifetime output.

### Empire Exchange (`tycoon`)

State: `cash`, `businesses:[{id,kind,level,workers,price}]`, `research`, `reputation`, `totalEarned`, `market`, `lastTick`, `offlineSeconds`. Industries: `kiosk`, `cafe`, `factory`, `studio`.

Actions: `open {kind}`, `hire {businessId}`, `upgrade {businessId}`, `price {businessId,price}`, `research`, `operate {businessId}`. Staff automate income; manual operation is rate limited. Demand responds to price, hourly market conditions change, payroll costs constrain margins, and research unlocks the studio. Offline income uses at most eight hours of server elapsed time. `default` ranks earned cash rather than browser snapshots.

### Velvet Casino (`casino`)

All Credits are fictional and free; there are no deposits, withdrawals, purchases of Credits, cryptocurrency, or prizes. State: `credits`, `wins`, `rounds`, `netWon`, `lastResult`, optional `blackjack`, optional `mines`, and `nextRewardAt`. New accounts receive 1,000 Credits, recorded in the ledger.

Actions:

- `dice {bet,target:2..98,direction:'under'|'over'}` uses a server random roll from 0 through 99.99; payout includes stake and a 3% house edge.
- `roulette {bet,choice:'red'|'black'|'even'|'odd'|number0..36}` returns a server wheel result; even-money bets pay 2× gross and exact numbers 36× gross.
- `blackjack.start {bet}`, `blackjack.hit`, `blackjack.stand`. Cards are indices 0..51: rank `card%13` (Ace 0), suit `floor(card/13)`. The player hand is visible; the dealer hole card is `-1` until settled. The shoe is always omitted. Naturals pay 3:2 net; pushes return stake; dealer stands on 17. Only one active blackjack hand per user.
- `mines.start {bet,bombs:1..20}`, `mines.reveal {cell:0..24}`, `mines.cashout`. Mine locations stay secret until the board settles; revealed cells cannot be replayed. Gross payout is server calculated from survival probability with a 3% house edge and 100× cap. Only one active board per user.
- `reward`: 250 Credits every twelve server hours; concurrent requests cannot claim twice.
- `transfer {username,amount:1..100000}` transfers Credits to another active, unblocked player. Both accounts lock in consistent UUID order; both journal entries share a reference.

Wagers are integers 1..100000. Stakes must be available before play, and stakes/payouts are separate journal entries committed with the outcome. `default` ranks verified wins. Transfers/rewards never increment win statistics.

### Paper Odyssey (`deck-roguelike`)

State: `phase:'map'|'combat'|'reward'|'lost'|'won'`, `floor`, `hp`, `maxHp`, `energy`, `gold`, `block`, `character`, `hand:string[]`, `deck:string[]`, `drawCount`, `discardCount`, optional `enemy:{name,hp,maxHp,intent,poison}`, `rewardCards`, `shopCards`, `availableNodes`, `relics`, `log`, `score`. Server RNG state and draw order are omitted.

Actions: `start {character:'striker'|'warden'|'spark',mode?:'campaign'|'daily'}`, `choose {node}` from `availableNodes`, `play {handIndex}`, `endTurn`, `reward {card}` from offered rewards (or `skip`), `shop {card}` from the current shop. Twelve floors include combat, elites, rest, events, shops, and the final boss. Energy, cards, enemy intentions, poison, health, relics, battle rewards, and run scoring are server calculated. Daily runs use the same daily server seed. Card descriptions are in `games/config/deck.ts`. `default` ranks verified run scores; `daily-run` records completed seeded runs.

### Neon Defense (`tower-defense`)

State: `phase:'build'|'upgrade'|'lost'|'won'`, `wave`, `lives`, `cash`, `towers:[{id,kind,x,y,level}]`, `kills`, `upgrades`, `offeredUpgrades`, optional `lastWave:{kills,leaks,reward,events}`.

Actions: `start`, `place {kind,x:0..7,y:0..4}`, `upgrade {towerId}`, `sell {towerId}`, `wave`, `choose {upgrade}` from the offered rewards. Towers cannot occupy path row 2 or an occupied tile. Families: `rapid`, `heavy`, `splash`, `slow`, `sniper`, `burn`, `support`, `economy`. The server simulates enemy movement, cooldowns, targeting, damage, support, slow, ink damage, waves, kills, leaks, and rewards. Clients animate returned wave events. Every third wave offers a choice; twenty surviving waves complete the map. `default` ranks waves actually survived, never client-submitted kill counts.

## Protected economy

- `GET /api/economy`: own `{accounts,inventory,shop}`. Tell Coins and Casino Credits are isolated accounts.
- `GET /api/economy/ledger`: latest one hundred journal entries belonging to the requester.
- `POST /api/economy/purchase {itemId}`: purchases a known profile cosmetic at its server price. Ownership and payment commit together; duplicate purchases and insufficient funds are rejected. Tell Coins do not purchase game power.

Verified first achievement unlocks award its defined XP points and twenty Tell Coins exactly once. All game state, account, and save mutation operations preserve transaction consistency. Tests cover capped offline time, production chains, card state transitions, tower simulation, casino redaction/payout rules, opposing transfers, concurrent overspend/reward races, stale save conflicts, and namespace/privacy isolation.

Run `pnpm exec vitest run tests/games.test.ts`; with a migrated local database, run `RUN_DB_TESTS=true node --env-file=.env node_modules/vitest/vitest.mjs run tests/game-database.test.ts`.
