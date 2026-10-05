Continue development of the existing **Tell Aviv** repository.

This is an implementation task, not an architecture proposal or code review. Inspect the current working tree, read the project documentation, then make substantial working changes directly in the repository.

Treat these as authoritative context:

- `PROJECT_STATE.md`
- `docs/TELL_AVIV_SPEC.md`
- `docs/BUILD_PASS.md`
- `docs/KNOWN_ISSUES.md`

Do not restart or rewrite working systems unnecessarily. Preserve compatibility with existing users, data, published Creator levels, saves, messages, classes, economy history, and multiplayer state wherever technically possible.

Use the entire available implementation window. When one item is implemented and tested, continue immediately to the next highest-priority task.

# Primary goal

Take Tell Aviv from a broad functional build into a substantially deeper, more resilient, more polished application.

Prioritize **actual missing functionality and reliability work** rather than writing more plans or documentation about missing functionality.

---

# 1. Creator 2.0 — highest product priority

The existing Creator currently has basic object manipulation, publishing, moving platforms, buttons, doors, and simple connections.

Expand this into a real visual game-logic editor.

## Add a generic event system

Implement structured, validated events such as:

- player enters zone
- player exits zone
- object touched
- button pressed
- timer starts
- timer expires
- object destroyed
- enemy defeated
- all enemies defeated
- variable changed
- variable reaches value
- level starts
- checkpoint reached
- player dies
- collectible obtained

Do not allow arbitrary JavaScript or arbitrary executable user code.

## Add conditions

Examples:

- variable equals value
- variable greater/less than value
- player has item
- player health threshold
- object active/inactive
- door open/closed
- enemy alive/dead
- player count
- timer state
- random bounded chance
- AND/OR condition groups

Conditions must have validation and complexity limits.

## Add actions

Examples:

- enable object
- disable object
- toggle object
- open/close door
- move platform
- teleport player
- spawn object/enemy
- destroy object
- damage player
- heal player
- give/remove item
- show text
- update objective
- play sound
- change variable
- increment/decrement variable
- set timer
- trigger another event
- complete level
- fail level
- activate checkpoint

## Variables

Implement project-level variables with safe supported types:

- boolean
- integer/number
- short string when justified

Add a proper visual editor for variables and logic.

Do not force normal creators to edit raw JSON.

## Logic editor UX

Create an understandable interface for:

- event
- optional conditions
- actions

Support:

- creating logic blocks
- editing
- duplication
- deletion
- reordering
- validation messages
- references to objects in the scene
- broken-reference detection
- undo/redo integration

Objects should be selectable through useful labels, not only opaque IDs.

## Runtime

Make execution deterministic and bounded.

Prevent:

- recursive infinite triggers
- gigantic action chains
- unbounded spawning
- maliciously huge payloads
- arbitrary server workload
- circular event chains without limits

Preserve compatibility with currently published levels.

Add schema migrations/version conversion when necessary rather than breaking old Creator content.

## More Creator objects

Add several useful object types such as:

- trigger zones
- checkpoints
- hazards
- collectible/key
- enemy spawn
- text/sign
- teleporters
- switches
- pressure plates
- goal/finish zone

Where possible, reuse the generic logic system instead of creating special-case code for every object.

## Creator discovery

Improve:

- templates
- search
- category filters
- sorting
- favorites
- likes
- creator profiles
- completion count
- recent/popular discovery

Implement trustworthy server-side completion tracking rather than accepting a simple client claim that a level was completed.

---

# 2. Ego Trip — turn it into the actual flagship game

The current twenty-room procedural campaign is only the foundation.

Expand it substantially.

Normal full runs should target roughly **45–60 minutes**, depending on route and player skill.

Do not simply stretch existing rooms.

Add meaningful content.

## Boss structure

Add more major bosses.

Every major boss should preferably have:

- a unique arena
- identifiable visual/combat identity
- at least three normal attacks
- meaningful phase changes
- clear telegraphs
- punishable openings
- anti-circling/anti-cheese behavior
- difficulty scaling
- unique dialogue or presentation
- signature reward
- associated achievement
- sensible multiplayer scaling

Do not implement bosses as mostly HP increases.

## Encounters

Add considerably more encounter variety:

- combat
- elites
- minibosses
- challenge rooms
- treasure
- shrines
- shops
- NPCs
- helpers
- cursed/risk-reward rooms
- choice rooms
- secret rooms
- rare encounters
- environmental encounters

Prevent runs from feeling like twenty repeated combat boxes.

## Weapons/upgrades

Expand the pool while keeping roles clear.

Add more:

- melee weapons
- projectile weapons
- unusual weapons
- passive upgrades
- weapon-specific mods
- synergy mods
- defensive mods
- movement mods
- helper-related mods
- boss-oriented mods
- tradeoff upgrades

Keep stacking bounded with diminishing returns where needed.

## Progression

Improve permanent progression without making early runs meaningless.

Add:

- unlock progression
- achievements
- cosmetics
- challenge unlocks
- boss rewards
- weapon unlocks
- encounter unlocks
- helper unlocks
- difficulty modifiers

Persist progress authoritatively.

## Secrets

Add meaningful secrets that are not simply random invisible buttons.

Possible mechanisms include:

- unusual route choices
- carrying a specific object
- refusing a reward
- beating a boss under a condition
- completing rooms in a pattern
- finding hidden NPC interactions
- defeating specific enemies in one run

Secret content should have meaningful rewards.

---

# 3. Ego Trip synchronized campaign co-op

The existing 2–4 player boss gauntlet should not remain the only meaningful co-op mode.

Begin turning the normal campaign into synchronized multiplayer.

Implement as much as possible of:

- shared room progression
- synchronized encounter state
- authoritative enemy state
- authoritative boss state
- player health/state
- revives
- player death/spectating
- helper ownership
- drops/rewards
- shared choices
- individual choices where appropriate
- checkpoint persistence
- reconnect
- late reconnect restoration
- party leader departure handling
- scaling by player count
- disconnect timeout behavior
- server-authoritative run completion

Avoid architectures where one player's browser is trusted as the canonical host.

Important state should live on the server/realtime layer.

If full campaign co-op cannot be completed in this pass, build the architecture properly and implement a substantial playable subset rather than a fake UI shell.

---

# 4. Authoritative Ego Trip ranked runs

Implement the foundation for trustworthy ranked solo runs.

A ranked run record should capture validated information such as:

- user
- seed
- game version
- run mode
- difficulty
- modifiers
- completion
- completion time
- deaths
- important run statistics
- final boss reached
- server validation status

Do not accept a final arbitrary score from the browser.

Where full server simulation is impractical, design an authoritative event-validation model that makes trivial score forging significantly harder and rejects impossible state transitions.

Keep casual/local simulation separate from ranked claims.

---

# 5. Classes 2.0

The school workspace works, but it still needs enough depth to be useful daily.

## Notes/editor

Improve the editor substantially.

Support:

- headings
- bold
- italic
- underline if compatible
- lists
- numbered lists
- links
- blockquotes
- code
- tables
- horizontal rules
- embedded uploaded images
- math/LaTeX rendering
- keyboard shortcuts
- preview/edit experience

Preserve existing Markdown notes.

Do not migrate existing notes destructively.

## Math

Add real math rendering rather than showing raw LaTeX source.

Support common:

- inline math
- display math
- superscripts/subscripts
- fractions
- roots
- matrices where supported
- common science notation

## Assignments

Improve assignment management:

- due dates
- overdue state
- upcoming
- completed
- missing
- filtering
- sorting
- priority
- class/folder grouping
- detail pages
- attachments
- notes
- completion history

## Flashcards

Expand the existing spaced repetition workflow.

Implement:

- deck organization
- due counts
- review history
- per-card history
- accuracy/success statistics
- Again / Hard / Good / Easy-style responses where appropriate
- card editing during review
- image support
- deck search
- deck statistics
- mastery/progress summaries

Keep learner state private.

## Quizzes

Expand:

- question creation
- attempts
- grading
- result history
- question review
- correctness breakdown
- quiz analytics for the quiz owner
- multiple choice
- multi-select
- true/false
- short answer where practical

Maintain explicit authorization for all private educational content.

## Reminders

Implement actual reminder generation/delivery plumbing for assignments/reviews where practical using existing notification systems.

Avoid duplicate notifications.

---

# 6. Social/chat depth

Finish the major missing communication features.

## Threads

Implement:

- thread names
- archive/unarchive
- follow/unfollow
- subscription behavior
- unread counts
- last activity
- improved discovery
- pagination beyond the current limited discovery set

## Group DMs

Add safe membership management:

- add member
- leave group
- remove member where rules allow
- rename group
- group avatar if compatible

Define clear ownership/admin semantics.

## Emoji/stickers

Implement custom server emoji architecture.

At minimum:

- upload
- validation
- size/type limits
- server ownership
- permission checks
- rendering in messages
- deletion
- missing/deleted fallback

If stickers are too large for this pass, build on the same reusable media architecture where possible.

## GIF search

If an external API key is not available:

- implement provider abstraction
- server endpoint
- safe result DTO
- configuration plumbing
- UI
- graceful disabled state

Do not fake live GIF search results.

## Link previews

Implement secure URL unfurling.

This must have strong SSRF defenses.

Block or safely handle:

- localhost
- loopback
- RFC1918/private networks
- link-local
- metadata endpoints
- internal DNS targets
- redirect chains into private addresses
- unsupported protocols
- excessive downloads
- very slow endpoints

Store a small bounded metadata preview.

Do not execute remote scripts.

---

# 7. Notifications and presence

## Automatic idle

Implement automatic idle detection.

Consider:

- user input inactivity
- multiple tabs
- explicit DND
- Invisible
- returning from idle
- disconnect timeout

Explicit manual status should not be unexpectedly overridden.

Invisible must remain private.

Audit every presence-related API so Invisible users are not leaked through:

- activity
- game presence
- typing indicators
- server membership
- party UI
- timestamps
- Home widgets
- websocket events

## Browser notifications

Add browser/desktop notification support where available.

Implement:

- permission flow
- opt-in settings
- DM preferences
- mention preferences
- party/invite preferences
- Focus Mode suppression
- duplicate prevention

Do not repeatedly prompt for browser permission.

---

# 8. Matchmaking and multiplayer recovery

Implement missing public matchmaking.

Add:

- queue join
- queue leave
- queue status
- estimated/basic status presentation
- party queue
- game selection
- match creation
- cancellation
- ready flow
- failure handling
- reconnect

Persist sufficient match state so service interruptions do not automatically destroy every active match.

Implement recovery snapshots where appropriate.

Test:

- realtime process restart
- reconnect
- Redis-backed state restoration
- abandoned matches
- duplicated reconnect attempts

Never solve recovery by exposing hidden canonical game state to players who should not see it.

---

# 9. Velvet Casino multiplayer poker

The casino currently has house-bot poker.

Build proper server-authoritative multiplayer table architecture.

Support private/friend tables first if necessary.

Implement:

- table creation
- join
- leave
- seats
- dealer rotation
- blinds
- betting rounds
- fold
- check
- call
- variable raise
- all-in
- side pots
- showdown
- split pots
- disconnect handling
- timeout/action timer
- reconnect
- hand history

All cards and deck order must be server-owned.

Never expose opponents' hidden cards before showdown.

All currency remains fictional.

Every casino currency mutation must remain journaled/ledgered.

Do not introduce real-money purchasing, cash-out, crypto, or anything representing real-world monetary value.

## Social marketplace

Improve:

- offers
- barter proposals
- gift history
- incoming/outgoing offers
- accept/reject/cancel
- live market updates

Settlement must be atomic.

Prevent item or currency duplication through concurrent acceptance.

---

# 10. Other game content

After the major systems above are materially advanced, deepen the other games.

## Neon Defense

Add:

- additional maps
- more enemies
- map-specific mechanics
- more bosses
- tower synergies
- campaign progression
- more meaningful wave interaction

## Paper Odyssey

Increase the content pool substantially beyond the current eighteen cards.

Add:

- more cards
- archetypes
- relics
- events
- enemies
- bosses
- character/build variety

Do not add hundreds of shallow reskins.

## After Hours

Add more party-game modes and improve drawing/game UX.

## Night Shift

Add:

- additional roles
- neutral roles if architecture supports it
- additional stations/maps
- more tasks
- more sabotage types
- spectator handling
- recovery after service restart

## Board games

Create a reusable board-game host architecture and begin adding at least one substantial additional game such as:

- chess
or
- checkers

Avoid creating completely separate duplicated matchmaking/state code for every board game.

## Signal Foundry

Deepen:

- production chains
- technologies
- automation
- prestige choices
- late-game systems
- long-run balance

## Empire Exchange

Add:

- competitors
- events
- deeper demand simulation
- additional businesses
- player interaction/trading where appropriate

## Loose Parts

Expand:

- joints
- fracture/destruction
- tools
- NPC/object behaviors
- sharing/gallery support

---

# 11. Backup and storage operations

Implement the missing operational safety work.

Add:

- scheduled backup support/configuration
- retention policies
- cleanup job scheduling
- trash cleanup scheduling
- orphan upload reconciliation
- orphan metadata reconciliation
- deletion retry monitoring
- object storage checks
- backup manifests
- checksums

Address the failure case where:

1. object upload succeeds;
2. database metadata insertion fails;
3. the physical object becomes orphaned.

Also consider the inverse.

Where S3 credentials are unavailable, implement provider-aware code and test against the local storage provider without claiming S3 itself was verified.

---

# 12. Observability and architecture cleanup

Do not rewrite everything to use one ORM merely for aesthetic consistency.

Instead improve safety and maintainability around the existing architecture.

Add stronger:

- DTO types
- schema validation
- query result typing
- domain event typing
- error classes
- structured logs
- health checks
- metrics

Split particularly large modules when there is a clear separation of responsibility.

Add metrics around:

- HTTP requests
- failures
- realtime connections
- websocket errors
- reconnects
- match count
- queue count
- active users
- uploads
- background workers
- cleanup failures
- database failures
- Redis failures
- economy settlement failures

Never include sensitive secrets or private chat contents in telemetry.

---

# 13. Admin/recovery improvements

Build safe administrator recovery capabilities.

Possible additions:

- storage health
- worker health
- queue backlog
- failed deletion jobs
- service status
- current game revision information
- active match counts
- maintenance state

For reset tools, require deliberate scopes and immutable audits.

Avoid "reset everything" actions that bypass economy/game invariants.

Fix leaderboard reset semantics so a reset does not simply repopulate unexpectedly from stale cumulative state unless that behavior is intentionally modeled.

---

# 14. Accessibility and device pass

Perform real testing, not just code inspection.

Audit major pages and every game where practical with:

- keyboard only
- narrow 375px viewport
- touch emulation
- reduced motion
- larger text
- high contrast
- focus visibility
- screen-reader semantics
- controller input

Create a reusable gamepad abstraction.

Add controller remapping UI where practical.

Persist mappings safely per user.

Games should consume global:

- master volume
- music volume
- effects volume
- reduced motion

where relevant.

Do not force sound playback where autoplay policies prohibit it.

---

# 15. Developer workflow cleanup

Fix shared Next development/build artifact conflicts if practical.

Separate or safely serialize:

- development output
- production build output
- Playwright output

Make test scripts use isolated result directories when parallel execution is possible.

Preserve currently passing CI behavior.

---

# 16. PWA — only after core work

Do not prioritize this over Creator, Ego Trip, Classes, multiplayer, or security work.

If substantial time remains, add:

- manifest
- installability
- icons
- service worker
- offline shell

Use extremely conservative authenticated caching.

Never cache private user API responses in a way that could leak information between accounts on a shared machine.

---

# Production validation

Perform a dedicated security and abuse test pass.

Test areas including:

## Authorization

Attempt cross-user access to:

- DMs
- attachments
- classes
- notes
- flashcards
- quizzes
- Creator drafts
- private levels
- saves
- account data
- server management
- economy objects

## Realtime authorization

Attempt:

- socket event spoofing
- room joining without permission
- hidden state access
- impersonated user IDs
- stale sessions
- blocked-user delivery
- unauthorized party control

## Economy

Stress:

- simultaneous transfers
- simultaneous purchases
- simultaneous marketplace purchases
- simultaneous offer acceptance
- loan repayment
- gifting
- finite collectibles

Check conservation invariants.

## Uploads

Test:

- incorrect MIME types
- fake file extensions
- oversized files
- malformed images
- unauthorized download
- deleted attachment access
- attachment reassignment
- orphan cleanup

## Rate limits

Add/test limits for abuse-sensitive actions without making ordinary usage painful.

Examples:

- auth attempts
- messages
- friend requests
- uploads
- party invites
- marketplace operations
- Creator publishing
- expensive searches

---

# External blockers

Do not waste the implementation window repeatedly trying unavailable infrastructure.

Google OAuth is currently blocked by missing credentials and callback configuration.

If the required credentials are unavailable:

- verify the implementation statically and through local auth paths;
- improve tests;
- document exactly what remains unverified;
- move on.

Likewise for:

- real S3
- production DNS/TLS
- authenticated container registry
- true production multi-node deployment

Never claim any of those were verified unless they actually were.

---

# Testing requirements

After each meaningful batch, run relevant tests.

Before finishing, run the broadest available validation suite.

At minimum attempt:

- strict TypeScript
- ESLint
- unit tests
- database tests
- Redis/realtime tests
- integration tests
- HTTP smoke tests
- browser tests
- production build

For new multiplayer features, test with multiple simultaneous accounts.

For race-sensitive economy features, deliberately issue concurrent requests.

For Creator, build an actual level using the new logic UI and play it.

For Classes, create/edit/share/study realistic content through the browser.

For Ego Trip, actually play through enough of the expanded campaign to catch pacing/runtime failures.

Do not mark something complete because its route renders.

---

# Migration rules

Database safety is mandatory.

For every schema change:

- create a new additive migration
- do not rewrite previously applied migrations
- support existing rows
- maintain constraints
- test against populated development data where feasible

Do not reset the database simply to make development easier.

---

# Implementation behavior

Work continuously.

Use this cycle:

1. inspect existing implementation;
2. choose a concrete missing capability;
3. implement it completely enough to use;
4. add tests;
5. run tests;
6. fix regressions;
7. continue.

Do not spend most of the task writing planning Markdown.

Do not stop simply because one large feature cannot be completed perfectly.

Implement the useful safe subset, leave a precise note about the remaining boundary, and move on.

Do not add fake buttons, placeholder APIs, fake success states, or mock data and describe them as completed features.

Prefer fewer genuinely functional features over many decorative shells.

---

# Final verification and handoff

Before finishing:

1. run all practical tests;
2. run strict typecheck;
3. run lint;
4. run the production build;
5. inspect the working tree;
6. update `PROJECT_STATE.md`;
7. update `docs/KNOWN_ISSUES.md`;
8. make sure documentation matches reality;
9. create a fresh source archive;
10. calculate SHA-256;
11. inspect the archive contents;
12. confirm that recently modified files are actually present inside it.

The final report must contain:

- exact major features implemented
- notable bugs fixed
- security fixes
- migrations added
- tests added
- exact test results
- build/type/lint results
- browser tests performed
- remaining blockers
- remaining partial systems
- important files/modules changed
- archive path
- archive SHA-256

Do not describe a feature as COMPLETE if it is merely scaffolded.

Most importantly, **keep implementing after the first successful feature instead of ending early with a status report.**