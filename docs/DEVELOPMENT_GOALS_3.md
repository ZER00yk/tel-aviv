You are continuing active development of my existing **Tell Aviv** repository.

This is a **full implementation continuation**, not a planning exercise, architecture proposal, or code-review-only task.

Inspect the actual current working tree first. Read the project documentation and verification reports, understand what is already implemented, then **continue coding directly from the current state**.

Read first:

- `PROJECT_STATE.md`
- `docs/TELL_AVIV_SPEC.md`
- `docs/BUILD_PASS.md`
- `docs/KNOWN_ISSUES.md`
- `docs/VERIFICATION_2026-10-03.md`
- `docs/HTTP_RATE_LIMITS.md`
- any game-specific READMEs
- relevant migrations/tests before modifying those systems

When documentation and implementation disagree, investigate the actual code and tests. Update documentation afterward so it matches reality.

# Core working rule

Do not spend the majority of this task writing plans.

Use this cycle continuously:

1. inspect;
2. implement;
3. test;
4. fix;
5. continue to the next important gap.

Do not stop after completing one feature.

Use as much of the available implementation window as possible.

If a large feature cannot be completed safely in one pass, implement a substantial working subset with proper architecture and tests, document the exact remaining boundary, then continue to another priority.

Do not add fake buttons, placeholder success responses, hard-coded demonstration data, or UI shells and describe them as completed features.

---

# IMPORTANT CURRENT STATE

The repository has already advanced substantially.

Existing functionality includes, among other things:

- strict TypeScript monorepo
- PostgreSQL and Redis
- authenticated sessions
- account ownership/export/deletion workflows
- friends
- presence
- DMs/groups/channels
- threads
- reactions
- polls
- uploads
- voice notes
- servers/roles/permissions
- notifications
- parties
- matchmaking foundations
- multiplayer recovery
- game SDK/platform
- achievements
- leaderboards
- economy
- inventory/cosmetics
- Classes
- Creator
- administration
- backups/reconciliation
- operational metrics
- mobile/accessibility foundations

Current game work includes substantial implementations for:

- Ego Trip
- Signal Foundry
- Neon Defense
- After Hours
- Velvet Casino
- Empire Exchange
- Paper Odyssey
- Loose Parts
- Night Shift
- board games

Creator already has:

- 16 object types
- typed variables
- nested conditions
- structured events/actions
- deterministic bounded runtime
- reference-safe visual logic editing
- undo
- templates
- discovery
- version-pinned attempts
- server-replayed completion validation

Ego Trip already has approximately:

- 40-room campaign
- 8 districts
- 8 bosses
- multiple weapons/modifiers
- server-owned 2–4 player campaign co-op
- route voting
- revives
- helpers
- shops
- leader transfer
- recovery
- authoritative solo ranked gauntlet

Velvet Casino already has:

- fictional currency only
- multiplayer private Hold'em
- betting streets
- all-ins
- side pots
- ties
- atomic stake persistence
- escrowed marketplace offers
- barter
- offer history

Classes already has:

- semantic Markdown
- safe KaTeX
- assignment planner/history
- flashcard review history/statistics
- quizzes
- analytics
- reminders
- private file/sharing authorization

Do not needlessly rebuild these systems.

Extend them.

---

# CRITICAL AUTHENTICATION REQUIREMENT

## DO NOT USE SIGN IN WITH GOOGLE

Tell Aviv **cannot use Google OAuth or Sign in with Google**.

This is not an external blocker to wait on.

Google authentication is no longer part of the intended production architecture.

Do not spend time trying to configure:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- Google OAuth consent
- Google OAuth callback URLs
- Google userinfo
- Google identity APIs
- any Google authentication dependency

Replace the production authentication plan with a secure native Tell Aviv authentication system.

This is the first major priority.

---

# PRIORITY 1 — Native Tell Aviv accounts

Implement a real first-party authentication system.

Users should be able to create and access Tell Aviv accounts without any external identity provider.

## Account identity

Use:

- stable internal immutable user ID
- unique username
- password
- optional private email address

The stable internal user ID must remain the ownership identity for:

- saves
- friends
- messages
- servers
- Classes
- Creator
- achievements
- inventory
- economy
- multiplayer records
- leaderboards
- account history

Do not make username or email the permanent database identity.

## Registration

Implement a complete production registration flow.

Include:

- username
- password
- password confirmation
- optional email
- validation
- duplicate username detection
- username canonicalization
- clear errors
- rate limits

Reuse existing username/history rules wherever appropriate.

Test race conditions involving two users registering the same username simultaneously.

Only one should succeed.

## Password storage

Never store plaintext passwords.

Use a modern password hashing algorithm.

Prefer:

- Argon2id

Use strong configurable production parameters.

Persist only what is required to validate passwords.

Never log:

- passwords
- password hashes
- reset tokens
- session secrets
- recovery codes

## Login

Implement native:

- username + password

If optional verified-email login is added later, do it without making email public.

Login failures should avoid unnecessary account enumeration.

Implement protection against repeated failed login attempts.

## Existing sessions

Reuse and strengthen the existing secure session architecture rather than replacing it casually.

Maintain:

- opaque sessions
- digested persistent tokens where currently used
- logout
- logout all devices
- individual device/session revocation
- disabled-account revocation
- deleted-account revocation
- secure session cookies
- reasonable session expiration

Cookies should use appropriate production settings:

- HttpOnly
- Secure
- SameSite
- correct path/domain behavior

Preserve development compatibility without enabling an insecure production bypass.

## Development authentication

Existing development authentication may remain for:

- automated tests
- local fixtures
- browser test accounts

But it must be impossible to enable accidentally in production.

Add an explicit production safeguard.

## Password change

Implement:

- current password
- new password
- confirmation
- password policy validation
- recent-authentication requirement if appropriate

After password change:

- old password must stop working
- allow/recommend revoking other sessions
- invalidate recovery credentials where appropriate

## Password recovery

Do not depend on Google.

Create a secure native recovery architecture.

If email infrastructure is configured:

- send reset link/code

Reset tokens must be:

- cryptographically random
- short-lived
- one-use
- stored hashed/digested
- invalid after successful reset
- invalidated when replaced where appropriate

Recovery endpoints should avoid revealing whether an account/email exists.

If no email provider exists:

- implement the complete recovery backend
- implement provider abstraction
- fixture-test it
- add development transport if useful
- clearly document real email delivery as externally unverified

Do not fake production email delivery.

## Recovery codes

Add optional recovery codes if practical.

Requirements:

- secure random generation
- display plaintext only when generated
- store hashes only
- one-use
- regenerate invalidates old set
- reauthentication required

## Passkeys / WebAuthn

If the password system is stable and sufficient time remains, add optional passkeys.

Support:

- register passkey
- multiple credentials
- credential names
- authenticate
- revoke/remove credential
- challenge expiration
- RP/origin verification
- replay protection

Do not make passkeys mandatory.

Do not claim physical-authenticator testing if only browser fixtures were used.

## Account Security page

Create a proper account security area with:

- change password
- sessions/devices
- revoke one session
- log out other sessions
- recovery options
- passkeys if implemented
- recent security events where appropriate

Do not expose raw session tokens or unnecessary sensitive information.

## Reauthentication

Require recent authentication for highly sensitive actions such as:

- changing password
- changing email
- generating recovery credentials
- deleting account
- potentially major security changes

## Remove Google UI/code

After native authentication is working:

Remove or replace production-facing:

- “Sign in with Google”
- Google-specific auth errors
- Google configuration warnings
- Google onboarding assumptions
- OAuth callback UI
- Google deployment requirements

Replace with:

- Create account
- Sign in
- Forgot password
- account security

Search the repository first before deleting Google-specific code.

Remove dead Google OAuth routes/dependencies only when they are no longer required by unrelated functionality.

## Existing account migration

Do not destroy existing users.

Add credentials additively.

Preserve:

- IDs
- profiles
- friendships
- messages
- saves
- Creator projects
- Classes
- economy
- achievements
- leaderboard history
- inventory

For existing development users without passwords, provide a safe development migration/bootstrap path.

Never assign a shared default production password.

---

# PRIORITY 2 — Authentication security testing

Add substantial tests around the new native system.

## Registration tests

Test:

- normal registration
- duplicate username
- simultaneous duplicate registration
- invalid username
- invalid password
- malformed body
- rate limiting
- oversized values

## Login tests

Test:

- correct password
- incorrect password
- nonexistent username
- disabled account
- deleted account
- malformed request
- repeated failures
- rate limits

## Session tests

Test:

- successful login
- cookie persistence
- browser reload
- logout
- logout all
- revoke one device
- expired session
- disabled user
- deleted user
- revoked session reuse
- multiple sessions

## Password-change tests

Test:

- correct old password
- incorrect old password
- old password after change
- new password after change
- session handling
- concurrent password changes

## Recovery tests

Test:

- valid token
- invalid token
- expiration
- replay
- replacement
- one-use semantics
- enumeration resistance

## Security tests

Attempt:

- CSRF
- cross-origin mutation
- session fixation
- malformed cookies
- replayed tokens
- forged forwarded headers
- credential brute force
- timing/account enumeration where practical

Add real Chromium browser coverage for account creation/login/security flows.

---

# PRIORITY 3 — Ego Trip full-run quality

Ego Trip already has significantly more content.

Do not primarily increase raw room counts again.

Now focus on **whether a complete run is actually good**.

Perform long-run automated/browser-assisted playtesting where practical.

Measure:

- total run duration
- room time
- boss duration
- player damage output
- incoming damage
- healing availability
- upgrade strength
- weapon strength
- difficulty progression
- resource availability
- repetition
- frame performance
- memory growth
- late-run state size

Target roughly:

**45–60 minutes for a normal complete run**

without creating artificial HP sponges.

## Fix pacing

If runs are too short:

add:

- meaningful encounters
- route decisions
- bosses/minibosses
- events
- challenge rooms
- secrets

Do not merely increase enemy HP.

If runs are too long:

reduce:

- low-value combat
- repetitive waves
- unnecessary downtime

## Boss quality pass

Audit all bosses.

Each major boss should have:

- distinct identity
- readable telegraphs
- several attacks
- meaningful phase changes
- fair punish windows
- anti-circling behavior
- anti-corner abuse where appropriate
- arena mechanics where useful
- sensible multiplayer scaling
- signature reward

Improve bosses that remain shallow.

## Enemy variety

Expand enemies based on behavior.

Examples:

- chargers
- snipers
- shields
- healers
- summoners
- artillery
- ambushers
- teleporters
- area denial
- buffers
- elite combinations

New enemies should change how the player plays.

---

# PRIORITY 4 — Ego Trip encounter variety

Expand meaningful room types.

Add/improve:

- survival
- waves
- protect-objective
- moving hazards
- pursuit
- optional elite challenge
- miniboss encounters
- puzzle/combat hybrids
- route forks
- environmental rooms
- movement trials
- NPC events
- risk/reward encounters
- helper events
- secret rooms
- weapon challenges
- shrines
- cursed rewards

Avoid runs that feel like repeated rectangular arenas.

---

# PRIORITY 5 — Ego Trip co-op parity

Co-op exists, but improve parity with the solo campaign.

Bring more of these systems into synchronized co-op:

- secret events
- helper behavior
- special weapons
- modifiers
- permanent unlocks
- encounter effects
- shop interactions
- unusual rooms

For each event/reward decide intentionally whether it is:

- shared
- individual
- voted
- first-interactor controlled
- all-players-required

Do not apply one global rule blindly.

## Co-op voting

Use party voting where appropriate for:

- route selection
- shared risk/reward choices
- major events
- helpers
- secrets

Use deterministic tie resolution.

## Disconnects

Preserve:

- authoritative state
- reconnect
- player reward ownership
- helper ownership
- checkpoint state
- leader transfer

Prevent duplication from disconnect/reconnect loops.

---

# PRIORITY 6 — Full ranked Ego Trip campaign foundation

Current ranked play is a boss-gauntlet subset.

Expand toward a representative ranked campaign.

Keep it server authoritative.

Persist/validate:

- run ID
- game revision
- account
- seed
- difficulty
- modifiers
- route
- room progression
- encounters
- boss progression
- weapons
- upgrades
- deaths
- time
- completion
- disconnect/recovery state

Never simply trust a browser-submitted final score.

If fully authoritative simulation is too expensive, implement strict deterministic transition validation.

Reject impossible progression.

## Ranked categories

Support useful categories such as:

- full completion time
- daily seed
- weekly
- difficulty category
- challenge category

Avoid creating dozens of nearly empty leaderboards.

---

# PRIORITY 7 — Seasons

Create a reusable competition-season system.

Support:

- season ID
- start time
- end time
- eligible games
- eligible modes
- leaderboard epoch
- active/ended state
- finalized standings
- rewards
- historical season results

Do not erase old seasons.

Rewards must be once-only and ledgered where they involve currency/items.

---

# PRIORITY 8 — Creator advanced geometry

Creator logic is already working.

Do not replace it.

Extend the runtime.

Add where practical:

- slopes
- angled platforms
- one-way platforms
- polygon/angled collision
- rotating hazards
- moving hazards

Keep physics deterministic enough for verification.

Do not add arbitrary executable creator code.

---

# PRIORITY 9 — Creator vehicles and explosives

Introduce safe bounded mechanics.

## Vehicles

Start with a small reliable set.

Examples:

- cart
- simple car
- platform vehicle

Add:

- seats/driver state if necessary
- controls
- bounded speed
- collision
- reset behavior

## Explosives

Add:

- radius
- damage
- force
- destructible interactions
- chain reactions

Strictly bound recursive explosion chains.

Limit:

- active explosives
- affected bodies
- chain depth
- simulation work

---

# PRIORITY 10 — Creator custom assets

Implement secure creator asset uploads.

Support appropriate assets such as:

- level thumbnails
- sprites/images
- limited audio if safe

Validate:

- MIME
- actual file structure
- dimensions
- file size
- ownership
- quota
- authorization

Do not accept executable content.

## Thumbnail system

Allow:

- uploaded thumbnail
or
- generated scene thumbnail

Use safe media storage and serving.

---

# PRIORITY 11 — Creator discovery/community

Build a more complete published-level ecosystem.

Implement:

- creator follows
- tags
- categories
- difficulty ratings
- reports
- popular
- trending
- newest
- most completed
- favorites
- creator profiles

## Better statistics

Separate:

- total attempts
- total completions
- unique account completions
- completion percentage
- published-version completion
- fastest verified time

Do not let one user completing several versions distort unique-user metrics.

## Reports

Implement moderation reports with reasons such as:

- inappropriate
- harassment
- exploit
- misleading metadata
- broken level
- other

Do not auto-delete merely because something was reported.

Create admin review support.

---

# PRIORITY 12 — Verified Creator speed rankings

Implement server/runtime-validated completion times.

Do not accept arbitrary client-submitted times.

Persist:

- attempt ID
- version
- start
- finish
- verified elapsed time
- account
- relevant level revision

Add fastest-time rankings.

Handle retries/reconnects correctly.

---

# PRIORITY 13 — Collaborative Creator

Add collaborator support.

Start with robust ownership/authorization:

- owner
- editor
- viewer if useful
- invite
- revoke
- collaborator list
- active presence

Then implement safe collaborative edits.

Possible model:

- server serialized operations
- revision numbers
- optimistic locking
- conflict detection

Do not silently overwrite another person's edits.

Test with two real browser accounts.

---

# PRIORITY 14 — Multiplayer Creator levels

Create a real multiplayer foundation for user-created levels.

Projects should be able to specify:

- min/max player count
- spawn points
- shared state
- per-player state
- teams where supported
- shared objectives
- per-player triggers

Upgrade `player-count` conditions to use actual multiplayer state.

Do not pretend all current Creator mechanics are automatically multiplayer-safe.

Support a reliable subset first.

---

# PRIORITY 15 — Persistent multiplayer poker tables

Current Hold'em is one hand per started match.

Turn it into a true multi-hand table.

After each hand:

- preserve players/seats
- preserve chip stacks
- rotate dealer
- update blinds
- allow sit-out
- allow leave between hands
- allow valid rebuy
- start next hand

Do not require a new lobby for every hand.

## Buy-ins

Allow table-defined:

- minimum buy-in
- maximum buy-in

Players can choose a valid fictional-Credit amount.

Keep everything fictional.

No real-money purchase.

No cash-out.

No crypto.

No real-world prize.

## Table discovery

Support:

- private
- friends
- public

Show:

- seats
- occupancy
- stakes
- status

Make stakes explicit before joining.

---

# PRIORITY 16 — Poker robustness

Stress-test:

- three or more all-ins
- side pots
- split side pots
- ties
- folded contributors
- action timeout
- disconnect
- reconnect
- player leaving mid-hand
- player leaving between hands
- simultaneous seat join
- duplicate actions
- stale actions
- admin reset
- account deletion

Deck order and hidden cards must remain server-owned.

---

# PRIORITY 17 — Poker tournaments

After persistent tables are reliable, add tournament foundations.

Implement:

- tournament creation
- registration
- fictional entry amount
- starting stacks
- scheduled/manual start
- table assignment
- blind progression
- elimination
- table balancing
- final table
- final standings
- once-only fictional rewards

Again:

no real money and no external-value rewards.

---

# PRIORITY 18 — Neon Defense authoritative real-time waves

Current Neon Defense still resolves waves server-side and primarily replays them.

Move toward actual interactive authoritative waves.

Implement server-owned:

- enemy state
- enemy movement
- tower target decisions
- damage
- effects
- waves
- boss state

Allow validated player commands during waves:

- build
- upgrade
- sell
- targeting priority
- abilities if added

Support reconnect restoration.

## Add depth

Expand:

- maps
- enemy families
- bosses
- map mechanics
- tower synergies
- support towers
- status effects
- campaign progression

If stable, begin cooperative tower-defense support.

---

# PRIORITY 19 — Paper Odyssey expansion

44 cards is not enough for long-term deck-building variety.

Expand meaningfully.

Target multiple real archetypes.

Examples:

- poison
- block/armor
- draw
- discard
- energy
- combo
- status
- summon
- scaling
- glass cannon
- expensive finishers
- low-cost chains

Expand:

- cards
- relics
- events
- enemies
- elites
- bosses
- shops
- build paths

Do not fill the game with numerically near-identical cards.

Run repeated simulations/playthroughs for obviously dominant combinations.

---

# PRIORITY 20 — Board games

The shared host already supports:

- Four in a Row
- chess
- forced-capture checkers

Deepen it.

## Chess

Verify full rule correctness:

- check
- checkmate
- stalemate
- castling
- en passant
- promotion
- repetition
- draw rules
- fifty-move rule where supported

## Checkers

Verify:

- captures
- forced capture
- multiple jumps
- kinging
- game ending

## Clocks

Add server-owned clocks.

Support common controls.

Ensure reconnect does not incorrectly reset time.

## Rating

Add reusable game-specific ratings.

Persist:

- rating
- match history
- outcome
- opponent
- game

Use only server-authoritative outcomes.

## Spectators

Add authorized spectators for public games.

Spectators cannot submit player actions.

---

# PRIORITY 21 — Night Shift depth

Expand the social-deduction game.

Add:

- additional crew roles
- hostile roles
- neutral roles where useful
- additional tasks
- additional sabotage systems
- additional station/map layouts
- spectator/dead-player UX
- host configuration

Maintain hidden-state privacy.

Audit socket payloads for role leakage.

Test reconnect/recovery during active rounds.

---

# PRIORITY 22 — After Hours expansion

Add additional meaningful multiplayer minigames.

Good categories include:

- bluffing
- word games
- guessing
- reaction
- drawing
- trivia variants
- voting/social games

Avoid reskinning the same mechanic repeatedly.

Improve drawing:

- brush size
- eraser
- undo
- touch
- efficient stroke serialization
- bounded payload sizes

---

# PRIORITY 23 — Signal Foundry late game

Expand:

- production chains
- resources
- technologies
- automation
- prestige
- ascension
- mutually exclusive decisions
- late-game objectives

Keep offline progress bounded.

Protect against clock manipulation.

Simulate long progression paths to identify runaway exponential balance.

---

# PRIORITY 24 — Empire Exchange depth

Implement:

- competitors
- market-share pressure
- pricing reactions
- business events
- supply shocks
- demand changes
- reputation consequences
- additional industries/businesses

If player trading is extended, keep settlement transactional.

---

# PRIORITY 25 — Loose Parts expansion

Expand the physics sandbox.

Add:

- destructible objects
- fracture behavior
- hinges
- motors
- springs
- ropes
- welds
- break forces
- tools
- grouping
- improved scene sharing/gallery

Keep strict workload limits on:

- physics bodies
- constraints
- explosives
- serialized scene size
- simulation cost

---

# PRIORITY 26 — Classes remaining work

Do not rewrite the existing Classes system.

Focus on missing functionality.

## Revision retention

Implement safe revision retention.

Possible behavior:

- keep recent revisions densely
- keep older revisions at larger intervals
- preserve named/manual versions
- never delete current revision
- respect active shared links/version semantics

## Group permissions

Add group grants where useful.

Every private read/download must still perform authorization.

## Document compatibility

Improve Markdown/CommonMark support.

Improve upload/preview/export for common document types.

Do not claim native Office editing unless it actually exists.

---

# PRIORITY 27 — Chat/media remaining polish

Current system already includes:

- threads
- group management
- emoji
- GIF adapter
- safe text previews

Continue only with meaningful missing gaps.

Consider:

- stickers
- richer emoji management
- improved GIF result UX
- thread discovery
- poll live-state consistency
- larger history scalability

## Rich link previews

If adding images to previews:

Do not proxy arbitrary remote data without strong protections.

Maintain:

- SSRF defense
- redirect revalidation
- private-network blocking
- byte limits
- type validation
- timeouts
- cache limits

---

# PRIORITY 28 — Accessibility

Continue a real accessibility pass.

Audit:

- account/auth flows
- Home
- chat
- server UI
- Creator
- Classes
- game launcher
- poker
- admin
- mobile navigation

Test:

- keyboard-only operation
- focus order
- focus restoration
- dialogs
- dropdowns
- form errors
- heading structure
- status announcements
- larger text
- high contrast
- reduced motion

Do not add redundant ARIA where native semantic HTML already works.

Prepare for screen readers even if no physical screen-reader environment exists.

Document external verification accurately.

---

# PRIORITY 29 — Controller abstraction

Improve reusable gamepad support.

Support:

- detection
- disconnect
- reconnect
- standard mapping
- remapping
- deadzone
- sensitivity
- multiple controllers when relevant
- feature-detected vibration if used

Do not assume Xbox/PlayStation only.

Maintain keyboard/touch fallback.

---

# PRIORITY 30 — Audio and microphone resilience

Improve:

- permission denied
- unsupported browser
- microphone removed during recording
- cancellation
- invalid audio
- upload failure
- retry
- cleanup

Synthetic browser input does not count as physical microphone verification.

---

# PRIORITY 31 — Persistent observability architecture

Current metrics are largely process-local.

Create a proper exporter/sink architecture.

Track at minimum:

- HTTP request counts
- latency
- error rates
- active websocket connections
- reconnects
- queue sizes
- active matches
- failed matches
- DB health
- DB pool pressure
- Redis health
- worker failures
- cleanup backlog
- upload failures
- economy failures

If an external monitoring backend is unavailable:

- implement a standard export endpoint/adapter
- test it locally
- do not claim deployed monitoring

Never export sensitive:

- passwords
- session tokens
- private messages
- poker hidden state
- authentication secrets

---

# PRIORITY 32 — Load testing

Create a reusable load/stress harness.

Test realistic combinations of:

- login
- authenticated HTTP
- chat
- presence
- websocket connections
- parties
- matchmaking
- Creator autosave
- Classes autosave
- marketplace
- poker
- Ego Trip realtime

Collect:

- latency
- throughput
- errors
- CPU
- memory
- DB usage
- Redis usage

Do not claim local load numbers equal real production capacity.

Use them to find bottlenecks.

---

# PRIORITY 33 — Bad-network testing

Test realtime systems under degraded conditions.

Simulate where tooling allows:

- latency
- jitter
- disconnect
- reconnect
- duplicate actions
- reordered actions
- delayed actions
- browser suspension

Test especially:

- Ego Trip
- poker
- Night Shift
- board games
- chat
- parties

Fix duplicated rewards, state divergence, stale input, and broken recovery.

---

# PRIORITY 34 — Multi-process realtime validation

Current namespaces use worker ownership/leases.

Test actual local multi-process failover.

Verify:

- worker lease
- fencing semantics
- stale worker rejection
- leader/owner transition
- shared Redis state
- recovery snapshots
- participant reconnect

Kill a worker during an active match and confirm another process can safely recover ownership.

Do not remove safety locks just to make multiple workers appear active.

---

# PRIORITY 35 — Proxy-safe anonymous authentication rate limits

This becomes especially important after introducing native password authentication.

Do not trust arbitrary:

`X-Forwarded-For`

Implement explicit trusted-proxy configuration.

Derive source identity safely.

Protect anonymous endpoints such as:

- registration
- login
- recovery
- username checks
- public discovery where abuse-sensitive

Test forged headers.

Authenticated user-based limits should continue to exist separately.

---

# PRIORITY 36 — Security headers / CSP

Perform the missing Content Security Policy work.

Create a policy compatible with:

- Next
- WebSocket
- Phaser
- KaTeX
- local media
- object storage
- configured GIF providers
- workers if used

Prefer strict policies with nonces/hashes where practical.

Also review:

- `frame-ancestors`
- `Referrer-Policy`
- `Permissions-Policy`
- `X-Content-Type-Options`
- HSTS for real HTTPS production only

Do not break local development.

---

# PRIORITY 37 — Storage/backup operations

Current reconciliation exists.

Improve operator visibility.

Add safe status views for:

- latest backup
- backup age
- backup verification
- pending cleanup
- deletion retry count
- orphan candidates
- missing objects
- size mismatch
- storage provider status
- retention status

Do not expose private file contents.

## Backup enhancements

Implement where practical:

- encrypted backup option
- rotation
- off-host provider abstraction
- integrity manifests
- restore-verification command

If no real remote target exists, fixture-test the abstraction and document that remote verification remains external.

---

# PRIORITY 38 — Admin operations

Expand safe administrative recovery.

Possible additions:

- worker health
- realtime namespace health
- queue backlog
- current game revisions
- active matches
- storage health
- failed maintenance jobs
- maintenance mode

All destructive admin actions require:

- fresh authorization
- explicit scope
- immutable audit record

Do not introduce unrestricted database-edit controls.

---

# PRIORITY 39 — PWA LAST

PWA remains low priority.

Only begin it after substantial progress on authentication, gameplay depth, multiplayer, reliability, and production hardening.

If time remains:

- manifest
- icons
- installability
- service worker
- offline shell

Never cache private authenticated responses in a way that can leak across accounts on shared devices.

Do not fake offline multiplayer.

---

# DATABASE AND MIGRATION RULES

Never reset production-like data just because a migration is inconvenient.

For schema changes:

1. use additive migrations;
2. never rewrite an applied migration;
3. support existing rows;
4. preserve foreign keys/invariants;
5. migrate populated development data;
6. test migration repeatability;
7. preserve checksums.

Do not renumber existing migrations merely to remove gaps.

A skipped migration number is preferable to rewriting history.

---

# ECONOMY RULES

All currencies remain fictional.

Never add:

- real-money deposits
- real-money withdrawal
- cryptocurrency
- cash prizes
- external-value conversion

Every currency change must remain:

- server authoritative
- atomic
- ledgered
- idempotent where required

Stress concurrency.

Check conservation.

Prevent:

- double spend
- duplicate rewards
- duplicated collectibles
- simultaneous offer acceptance
- duplicate tournament payout
- reconnect payout duplication

---

# PRIVACY RULES

Maintain strict privacy boundaries.

Never expose:

- password hashes
- recovery secrets
- raw session tokens
- private account settings
- hidden poker cards
- hidden Night Shift roles
- private messages to unauthorized users
- private Classes content
- private Creator drafts
- Invisible presence through secondary APIs

Recheck authorization at the point of mutation/read where races matter.

Do not assume a permission checked earlier in a multi-step operation is still valid.

---

# CREATOR SAFETY

Never allow arbitrary user JavaScript.

Creator logic remains declarative, typed, validated and bounded.

Enforce limits on:

- objects
- triggers
- actions
- nested conditions
- event recursion
- spawns
- explosions
- physics bodies
- uploaded assets
- serialized project size

Published levels must not create uncontrolled backend work.

---

# TESTING REQUIREMENTS

Testing is part of implementation, not something deferred to the end.

After significant changes:

- add tests
- run targeted tests
- fix failures
- continue

Before finalizing, run the broadest practical suite.

At minimum attempt:

- frozen install
- migrations
- strict TypeScript
- ESLint
- backend unit tests
- database tests
- Redis tests
- realtime/socket tests
- integration tests
- authenticated HTTP smoke
- Chromium browser suite
- production build

Do not reduce assertions to make tests pass.

Do not mark flaky tests as ignored instead of investigating actual regressions.

---

# BROWSER TEST REQUIREMENTS

Use real browser interaction for important flows.

## Authentication

Test through Chromium:

1. create account;
2. sign out;
3. sign in;
4. reload and confirm session;
5. change password;
6. ensure old password fails;
7. ensure new password works;
8. create another session;
9. revoke the other session;
10. verify it loses access;
11. exercise recovery;
12. delete test account.

## Creator

Use the actual UI to:

- create a level
- add objects
- add logic
- save
- publish
- play
- complete
- verify completion
- test collaboration if implemented

## Ego Trip

Play meaningful portions of:

- solo
- co-op
- ranked

Test actual movement/combat.

## Poker

Run:

- normal hand
- fold
- showdown
- all-in
- side pot
- reconnect
- multiple hands if implemented

Verify ledger conservation.

## Classes

Create:

- note
- math
- assignment
- flashcards
- quiz

Exercise real review/history behavior.

## Multiplayer

Use multiple simultaneous browser accounts for:

- friends
- parties
- matchmaking
- games
- Creator collaboration
- poker
- co-op

A route returning HTTP 200 does not mean the feature works.

---

# FAILURE TESTING

Deliberately test failure.

Examples:

- kill realtime worker
- temporarily lose Redis
- simulate stale cache
- disconnect browser
- duplicate action
- submit malformed packet
- revoke permission during operation
- concurrent economy requests
- failed upload
- missing storage bytes
- failed cleanup
- stale session
- invalid recovery token

Verify safe recovery.

---

# DOCUMENTATION

After implementation, update documentation to match actual reality.

Especially update:

- `PROJECT_STATE.md`
- `docs/KNOWN_ISSUES.md`
- current verification document
- auth/setup documentation
- environment-variable documentation
- relevant game READMEs

Remove Google OAuth from required deployment setup.

Do not continue calling Google credentials a blocker.

Instead describe native auth status accurately.

Use status categories such as:

- COMPLETE
- SUBSTANTIALLY IMPLEMENTED
- PARTIAL
- BLOCKED
- NOT STARTED

Only use COMPLETE where justified.

---

# FINAL VERIFICATION REPORT

The final report must include:

## Implementation

- major features implemented
- bugs fixed
- security fixes
- architecture changes
- migrations added
- major files/modules changed

## Authentication

Report:

- registration status
- password login status
- password hash algorithm
- recovery status
- session management status
- passkey status if implemented
- external email-provider verification status

Google OAuth should no longer be listed as required.

## Tests

Provide exact:

- backend test count
- failed count
- skipped count
- browser test count
- HTTP smoke count
- typecheck result
- lint result
- production build result

Do not say “all tests passed” without numbers when numbers are available.

## Gameplay

Report:

- Ego Trip measured run duration if measured
- boss/content additions
- co-op parity additions
- ranked changes
- other-game expansions

## Reliability

Report:

- process recovery tests
- Redis-loss tests
- network impairment tests
- concurrency tests
- load-test results
- multi-worker results

Distinguish local test results from production verification.

## External remaining gaps

Be precise about anything genuinely requiring external infrastructure or hardware.

Examples may include:

- real email provider
- real production DNS
- live TLS
- live S3
- remote/off-host backup provider
- physical controller
- physical microphone
- Safari/iOS
- real screen reader
- real production traffic

Do not describe something as externally blocked if it can reasonably be implemented and fixture-tested locally.

---

# SOURCE ARCHIVE / HANDOFF

At the end:

1. stabilize code;
2. finish tests;
3. update documentation;
4. create a **fresh source archive** from the actual current working tree;
5. exclude secrets, dependencies, private runtime data and caches;
6. generate a manifest;
7. calculate SHA-256;
8. verify the checksum;
9. inspect archive membership;
10. verify several files changed in this continuation are inside the archive.

Do not reuse the old archive.

Do not claim a new archive exists unless it was actually generated after the changes.

Report:

- exact archive path
- exact SHA-256
- manifest path
- archive verification result

---

# FINAL WORK BEHAVIOR

Do not finish early merely because one major feature passed its tests.

Keep going.

Prioritize in roughly this order:

1. native Tell Aviv authentication
2. authentication/security verification
3. Ego Trip full-run quality
4. Ego Trip co-op parity
5. ranked campaign/seasons
6. Creator advanced mechanics
7. Creator collaboration/multiplayer
8. persistent poker
9. Neon Defense realtime authority
10. other game depth
11. accessibility/device quality
12. load/realtime/multi-node hardening
13. operations/backups
14. optional PWA

If one item becomes blocked by unavailable external infrastructure, document the exact boundary and immediately continue with another implementation task.

The purpose of this continuation is not to produce a longer roadmap.

The purpose is to leave the repository with **substantially more working, tested functionality than it had at the beginning of this task**.