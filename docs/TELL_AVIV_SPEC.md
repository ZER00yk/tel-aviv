# TELL AVIV
## Master Product, Architecture, Game Platform, and Implementation Specification

You are building a complete browser platform named **Tell Aviv**.

Treat this document as the authoritative product specification.

Do not reinterpret Tell Aviv as a basic arcade website, a Discord clone, a file-storage website, or a collection of independent games.

Tell Aviv is one integrated platform combining:

- social communication
- public chat
- Discord-like communities
- friends and presence
- multiplayer gaming
- single-player games
- persistent player progression
- game achievements
- user profiles
- user-created levels
- school/class organization
- private school documents
- collaborative school resources
- cloud saves
- leaderboards
- developer infrastructure for adding many future games

The primary initial audience is approximately **15–20 active users**, mostly students using managed Chromebooks during free time.

However, the site itself is public on the internet.

The architecture should remain clean enough that the service can grow beyond that initial group without requiring a complete rewrite.

---

# 1. CORE PRODUCT PRINCIPLES

Tell Aviv should feel distinct.

It may take inspiration from products such as:

- Discord
- Steam
- Roblox
- Coolmath Games
- browser arcades
- game launchers
- social gaming platforms

However, the final interface must not look like a direct clone of any of them.

The site's identity should come from connecting social interaction, games, user creations, and school tools into one system.

The four primary areas of Tell Aviv are:

1. **Social**
2. **Games**
3. **Create**
4. **Classes**

None of these should feel like a secondary feature.

The homepage should surface all four.

---

# 2. TARGET DEVICES

Tell Aviv is designed **Chromebook-first**.

The entire platform must operate in a normal modern Chrome browser.

Users must not need:

- browser extensions
- Linux mode
- downloadable desktop applications
- native executables
- command-line software
- custom certificates
- unusual ports

Normal HTTPS browser access must be sufficient.

Also support:

- Windows
- macOS
- Linux desktop browsers
- Android browsers
- iPhone/iPad browsers where practical

Desktop/Chromebook is the primary target.

Mobile support is secondary but should not be deliberately broken.

---

# 3. PERFORMANCE TARGET

Many users may be on lower-end school Chromebooks.

Performance is a first-class feature.

Avoid unnecessary:

- WebGL complexity
- huge JavaScript bundles
- constant background animation
- extremely large textures
- excessive React rerenders
- large memory allocations
- unnecessary network polling
- giant dependency trees

Games should provide graphics/performance settings where relevant.

Support at minimum:

- High
- Medium
- Low

Complex games may additionally expose:

- particle density
- lighting
- shadows
- screen shake
- post-processing
- animation quality
- render resolution
- maximum effects
- FPS target

Games should remain playable around 30 FPS on weak hardware where possible.

60 FPS should be the preferred target.

---

# 4. ACCESS MODEL

Tell Aviv is public on the internet.

However:

**Users must sign in before using the platform.**

There is no guest-browsing mode.

The unauthenticated experience should contain only:

- Tell Aviv branding
- brief description
- native username/password login and registration
- privacy/terms links
- service status where appropriate

Do not expose:

- chat history
- user profiles
- game statistics
- school documents
- servers
- friend graphs

to logged-out users.

---

# 5. AUTHENTICATION

Primary login method (updated by [development goals 3](DEVELOPMENT_GOALS_3.md)):

**Native Tell Aviv accounts: username and password, with optional private email.**

Registration canonicalizes a unique username and hashes passwords with Argon2id.
Email is optional and never public. Verified email can support one-use password
recovery when a real provider is configured; one-use recovery codes support
accounts without email. Account ownership uses immutable internal UUIDs and
secure server-managed sessions. Passwords, reset tokens and recovery codes are
never stored in plaintext or exported. Sensitive account changes require recent
password authentication. Google OAuth is no longer required or implemented as a
login flow. Historical external identity columns are retained for data compatibility.

Users may later change their username.

Maintain:

- immutable internal user ID
- current username
- username history if needed internally

Never use the username itself as the database identity.

Use secure server-managed sessions.

Cookies should be:

- HttpOnly
- Secure in production
- SameSite appropriately configured

Support:

- current sessions
- sign out
- sign out all devices

Avoid building an unnecessarily elaborate authentication system.

---

# 6. USER PROFILE

Each account should support:

- username
- display name
- custom avatar
- profile banner
- bio
- custom status
- online status
- friend list
- badges
- Tell Aviv global level
- global XP
- game statistics
- achievements
- game history
- creations
- selected school/class resources
- recent activity

Users may customize which profile sections are publicly visible.

Private school materials must NEVER become public simply because profiles support showing class content.

Only items explicitly marked for sharing or publication may appear.

Possible profile sections:

- Overview
- Games
- Achievements
- Friends
- Creations
- Activity
- Shared School Resources

Profiles should support badges such as:

- Owner
- Administrator
- Developer
- Game Developer
- Early User
- Level Creator
- Event Winner

Badge infrastructure should be extensible.

---

# 7. GLOBAL XP

Tell Aviv has a platform-wide XP system.

XP may be earned from legitimate activities such as:

- playing games
- completing achievements
- daily challenges
- creating popular community content
- participating in special events

Do not reward:

- sending large numbers of messages
- repeatedly joining/leaving servers
- spammy activity

Global XP determines the user's Tell Aviv level.

Levels primarily provide:

- profile prestige
- badges
- cosmetics
- titles
- cosmetic unlocks

Do not make global level provide overwhelming gameplay advantages.

---

# 8. FRIEND SYSTEM

Tell Aviv uses a **friends model**, not followers.

Implement:

- send friend request
- accept friend request
- decline friend request
- cancel outgoing request
- remove friend
- block user
- mute user
- favorite friend
- close friend
- friend nickname/notes
- recently played with
- suggested friends

Friend notes/nicknames are private to the user who created them.

Blocking should prevent direct interactions between the two users where appropriate.

---

# 9. PRESENCE

Friends may see:

- online
- idle
- do not disturb
- invisible
- offline

Users may manually appear invisible.

Presence may display:

- current game
- game mode
- lobby
- party
- server/room where appropriate
- elapsed play time
- join availability

Example:

Gabriel
Playing Ego Trip
Floor 18 — Boss Encounter
Party 2/4

Buttons might include:

- Join
- Spectate
- Invite
- Message

Each game controls whether joining and spectating are currently allowed.

---

# 10. PARTY SYSTEM

Parties are global.

They persist while users move between games.

Party functionality:

- create party
- invite user
- join party
- leave party
- kick party member
- transfer leader
- party chat
- ready status
- game selection
- launch game
- matchmaking as group

Initial recommended maximum:

**8 party members globally**

Individual games may impose smaller limits.

Example:

Ego Trip may support 4.

Party game collection may support 8.

---

# 11. MAIN NAVIGATION

Desktop/Chromebook layout should use a persistent navigation structure.

Primary destinations:

- Home
- Chat
- Games
- Create
- Classes
- Friends
- Servers
- Notifications
- Profile

Settings can live under the user menu.

Do not overload the navigation with dozens of icons.

Games may enter a distraction-free/fullscreen layout.

---

# 12. HOME PAGE

The homepage should combine the platform instead of simply showing a game catalog.

Suggested modules:

## Continue Playing

Recently played games.

## Friends Online

Current friend activity.

## Activity Feed

Examples:

- Rowan published a new level.
- Owen beat your Tower Defense record.
- Andrew unlocked an Ego Trip achievement.
- A friend started playing a game.
- Someone invited you to a party.

## Featured Games

Games highlighted by administrators/developers.

## Recently Updated

Games with recent patches.

## Community Creations

Popular community levels.

## Classes

Upcoming assignments and recently edited school content.

## Daily Challenges

Platform/game challenges.

## Announcements

Platform updates.

Users should eventually be able to hide/rearrange some homepage modules.

---

# 13. GLOBAL CHAT

There is one primary **Global Chat**.

Its experience should resemble modern Discord text chat in usability without copying Discord visually.

Support:

- messages
- persistent message history
- replies
- threads
- reactions
- emoji
- custom emoji
- stickers
- GIFs
- images
- videos
- file attachments
- voice messages
- link previews
- polls
- Markdown formatting
- mentions
- @everyone
- @here
- message editing
- message deletion
- pinned messages
- search
- timestamps
- unread indicators
- typing indicators
- read position
- jump to reply
- copy message link

History should persist indefinitely unless deleted.

Use pagination or virtualized history so large channels remain fast.

Do not load thousands of messages at once.

---

# 14. CHAT ATTACHMENTS

Support sensible browser-safe upload formats.

Images:

- PNG
- JPEG
- WebP
- GIF

Video:

- MP4
- WebM where supported

Documents:

- PDF
- TXT
- common office documents where practical

Audio/voice:

- browser-supported audio formats

All uploads should have sane configurable limits.

Initial recommendation:

- images: 10 MB
- normal attachments: 25 MB
- school documents: 50 MB

Do not hardcode these numbers deep into the application.

Use configuration.

---

# 15. DIRECT MESSAGES

Support:

- 1-to-1 DMs
- group DMs

Features should generally match normal chat:

- replies
- reactions
- attachments
- GIFs
- polls
- search
- editing
- deletion

Blocked users cannot initiate or continue a DM.

---

# 16. SERVERS

Tell Aviv includes Discord-like user communities called **Servers**.

Users may create servers.

A server supports:

- name
- icon
- banner
- description
- owner
- members
- roles
- role colors
- channels
- permissions
- invitations

Server types may include:

- general community
- friend group
- specific game
- class/study group
- developer community

---

# 17. SERVER CHANNELS

Initially support:

- text channel
- announcement channel

Design the channel system so future types can be added.

Do not implement live voice channels in the initial version.

Voice messages are supported in text chat.

Live voice introduces unnecessary WebRTC complexity for the initial target group.

---

# 18. SERVER ROLES

Roles support:

- name
- color
- ordering
- permissions

Permissions should include:

- view channel
- send messages
- attach files
- embed links
- add reactions
- mention everyone
- manage messages
- manage channels
- manage roles
- manage server
- create invite

Avoid an unnecessarily complicated permission engine.

Use Discord-like role inheritance concepts.

---

# 19. INVITES

Server invites may be:

- permanent
- temporary
- limited-use

Support configurable:

- expiration
- maximum uses

Example invitation fields:

- server
- creator
- code
- expiresAt
- maxUses
- uses

---

# 20. SERVER DISCOVERY

Servers may choose:

- private
- discoverable

Discoverable servers can appear in server discovery.

Search by:

- name
- description
- tags

Initial platform scale is small, so keep discovery simple.

---

# 21. MODERATION PHILOSOPHY

Do NOT build a large moderation platform.

The user explicitly prefers simplicity over extensive automated moderation.

Profanity is allowed.

Do not implement for v1:

- profanity filters
- AI message moderation
- automatic slur filtering
- sophisticated spam classifiers
- automatic image moderation
- report queues
- appeal systems
- shadow bans
- ban-evasion fingerprinting
- moderator case management

User-level safety still includes:

- block
- mute

For security/emergency administration, the owner should have the ability to:

- disable an account
- delete clearly harmful content
- remove malicious files

This should be an emergency administrative capability rather than a giant moderation subsystem.

---

# 22. NOTIFICATIONS

Build one unified notification system.

Possible notifications:

- friend request
- friend request accepted
- DM
- mention
- reply
- reaction
- server invitation
- party invitation
- game invitation
- matchmaking ready
- achievement unlocked
- friend achievement
- leaderboard record beaten
- community creation activity
- game update
- assignment deadline
- shared class document
- comment on shared content

Primary delivery:

**in-site notification center**

Browser notifications can be optionally supported.

Do not implement email notifications initially unless required later.

Users must be able to configure notification preferences.

---

# 23. GAMES HUB

Games is a major product surface.

It should include:

- Featured
- All Games
- Recently Played
- Favorites
- Multiplayer
- Single Player
- Community
- New
- Recently Updated

Game cards show:

- title
- artwork
- description
- player count
- multiplayer status
- friend activity
- last update
- achievements
- favorite button

A game details page shows:

- Play
- screenshots
- description
- controls
- developer
- version
- patch notes
- achievements
- leaderboards
- statistics
- friends playing
- community chat
- community creations if applicable

---

# 24. GAME LOADING

Games should be first-class modules inside Tell Aviv.

Avoid iframe-based architecture for official games.

Games should normally run through routes such as:

`/games/ego-trip/play`

`/games/tower-defense/play`

Games may switch to a fullscreen-style shell.

Keep essential platform overlays available:

- escape menu
- party
- notifications
- friend invitations
- game chat where relevant

---

# 25. GAME SDK

Create a reusable internal package:

`@tell-aviv/game-sdk`

Official games interact with the platform through this SDK.

Games should NOT directly manipulate unrelated core database tables.

Example conceptual interfaces:

```ts
TellAviv.user
TellAviv.presence
TellAviv.saves
TellAviv.achievements
TellAviv.leaderboards
TellAviv.party
TellAviv.matchmaking
TellAviv.inventory
TellAviv.currency
TellAviv.notifications
TellAviv.analytics
```

The exact API may differ, but maintain clear boundaries.

---

# 26. GAME MANIFEST

Every game should have a manifest.

Example conceptual file:

`game.manifest.ts`

Information:

- game ID
- name
- description
- version
- developer
- icon
- cover image
- routes
- supported player count
- single-player/multiplayer
- controller support
- mobile support
- save schema version
- SDK permissions
- category/tags
- feature flags

Possible permissions:

- saves.read
- saves.write
- achievements.unlock
- leaderboards.submit
- presence.write
- matchmaking.use
- inventory.read
- inventory.grant
- currency.read
- currency.spend

Games should receive only permissions they need.

---

# 27. SAVE SYSTEM

Create universal cloud-save infrastructure.

Each game owns namespaced save data.

Save entries contain:

- user ID
- game ID
- schema version
- updated timestamp
- save payload

Support game-controlled migration between save versions.

Games must never accidentally overwrite saves belonging to other games.

Important save writes should be atomic.

---

# 28. GAME VERSIONING

Each game maintains:

- semantic version
- changelog
- patch notes

Example:

Ego Trip
v2.3.1

Platform and individual game versions remain separate.

---

# 29. GLOBAL ACHIEVEMENTS

Support:

- game achievements
- platform achievements
- hidden achievements
- achievement rarity
- achievement points
- achievement showcase

Achievement definitions contain:

- ID
- name
- description
- icon
- hidden
- points
- criteria metadata

Profiles may display selected achievements.

---

# 30. LEADERBOARDS

Leaderboards should support:

- all-time
- weekly
- daily
- friends

Games define categories.

Examples:

Ego Trip:

- fastest completion
- highest difficulty clear
- highest endless score
- most bosses defeated

Tower Defense:

- highest wave
- fastest map clear
- highest difficulty

Incremental:

- highest prestige tier
- production milestone

Do not build complex competitive ranking/MMR until a game needs it.

---

# 31. GLOBAL CURRENCY STRATEGY

Do NOT use one gameplay currency for every game.

That would make balancing one game capable of destroying another game's economy.

Instead implement:

## Tell Coins

A limited platform currency primarily used for:

- profile cosmetics
- avatar frames
- titles
- harmless cosmetic rewards

Then allow games to define their own currencies.

Examples:

Ego Trip:
- Ego

Casino:
- Credits

Incremental:
- game-specific resources

Tycoon:
- Cash

Tell Coins should not be directly transferable into large amounts of game power.

---

# 32. NO REAL MONEY GAMBLING

The casino/gambling game uses fictional currency only.

Do not implement:

- real deposits
- real withdrawals
- cryptocurrency
- cash prizes
- real-money wagering
- purchasable gambling chips

The system is entertainment only.

---

# 33. PLATFORM INVENTORY

Create a global cosmetic inventory for items such as:

- profile frames
- badges
- titles
- chat cosmetics
- emotes
- avatar decorations

Game-specific inventories remain under individual games unless deliberately linked.

---

# 34. INITIAL GAME ROADMAP

Tell Aviv should eventually include:

1. Ego Trip
2. Casino
3. Tower Defense
4. Incremental
5. Incremental Tycoon
6. Deck Roguelike
7. Social Deduction
8. Physics Sandbox
9. Game/Level Maker
10. Party Games collection
11. Trivia
12. Drawing Game
13. Chess/Board Games
14. Survival Arena

Do not attempt to build all of these immediately.

---

# 35. EGO TRIP

Ego Trip should become a flagship Tell Aviv game.

It must be rebuilt/structured as a real maintainable game rather than an accumulation of experimental features.

Genre:

**2D action roguelike / boss rush**

Primary modes:

- solo
- co-op

Initial co-op target:

**1–4 players**

Target standard run:

approximately **45–60 minutes**

A completionist run including secrets can be considerably longer.

---

# 36. EGO TRIP CORE LOOP

General loop:

1. begin run
2. choose initial equipment
3. clear encounters
4. earn upgrades
5. fight minibosses
6. meet NPCs
7. visit shops
8. fight bosses
9. discover secret paths
10. complete or die
11. receive meta progression
12. begin another run

Runs should encourage radically different builds.

---

# 37. EGO TRIP COMBAT

Combat needs:

- immediate movement
- responsive dash
- ranged weapons
- melee weapons
- projectiles
- enemy telegraphs
- status effects
- knockback where appropriate
- invulnerability timing
- boss phases
- environmental mechanics
- helper AI

Avoid combat where the strongest strategy is simply running circles around bosses.

Bosses need attacks that force:

- repositioning
- directional dodging
- timing
- arena awareness

---

# 38. EGO TRIP BOSSES

Use the established Ego Trip identity as the foundation.

The existing character-driven boss concept should remain recognizable.

Major names from the project can remain part of the roster, including characters such as:

- Rowan
- Bennett
- Austin
- Dakota
- Andrew
- Logan
- Gabriel
- Owen

Additional bosses/minibosses/secrets may be designed as needed.

Do not make them palette-swapped versions of one another.

Every significant boss needs:

- visual identity
- arena identity
- at least 3 major attack concepts
- phase transition
- signature mechanic
- recognizable telegraphs
- unique reward
- unique dialogue/personality

Late bosses should become mechanically complex rather than merely gaining absurd health.

---

# 39. EGO TRIP FRICK OFF ATTACKS

Major bosses may have a signature high-threat attack internally described as a **Frick Off attack**.

Requirements:

- clearly telegraphed
- dangerous
- avoidable
- counterable
- tied to boss identity

Each should include some weakness or counterplay.

---

# 40. EGO TRIP ENCOUNTERS

Possible rooms:

- normal battle
- elite encounter
- miniboss
- treasure
- challenge
- shop
- shrine
- cursed room
- helper encounter
- NPC event
- trade room
- risk/reward room
- weapon room
- secret encounter
- extremely rare encounter

Choices should trade resources such as:

- health
- Ego
- weapon
- mod
- helper
- safety
- difficulty
- reward quality

---

# 41. EGO TRIP WEAPONS

Support meaningful weapon identities.

Categories:

- melee
- projectile
- explosive
- unusual/special

Weapons should differ through mechanics rather than only numbers.

Possible parameters:

- damage
- attack rate
- projectile speed
- range
- spread
- crit
- knockback
- reload
- ammo
- status
- alternate fire

---

# 42. EGO TRIP MOD SYSTEM

Mods should create builds.

Categories may include:

- weapon-specific
- projectile
- melee
- defensive
- movement
- helper
- tradeoff
- boss-focused
- synergy
- rare transformational mods

Use rarity tiers.

Example:

- Common
- Uncommon
- Rare
- Epic
- Legendary
- Exotic/Ultra-Rare

Avoid excessive raw multiplicative scaling.

Use diminishing returns where appropriate.

---

# 43. EGO TRIP HELPERS

Helpers should actually contribute.

They need:

- meaningful HP
- reliable following
- targeting
- boss usefulness
- unique identity
- readable UI

A helper can provide:

- damage
- healing
- shielding
- buffs
- debuffs
- utility

---

# 44. EGO TRIP META PROGRESSION

Permanent upgrades should matter without trivializing runs.

Meta progression may unlock:

- weapons
- mods
- encounters
- helpers
- cosmetics
- secret paths
- alternative starting options

Raw permanent stat increases should be restrained.

---

# 45. EGO TRIP MODES

Eventually support:

- Normal
- difficulty modifiers
- Daily Challenge
- seeded runs
- Endless
- secrets/completionist path
- co-op

Potential future mode:

- speedrun mode

---

# 46. TOWER DEFENSE

Tower Defense should be another major game.

Primary modes:

- solo
- co-op
- eventual versus

Gameplay:

- map-based
- tower placement
- enemy waves
- boss waves
- temporary run upgrades
- long-term unlocks

Recommended initial tower families:

- rapid fire
- heavy
- splash
- slowing
- support
- economy
- sniper
- damage-over-time
- special

Each family can eventually branch into upgrades.

---

# 47. TOWER DEFENSE ROGUELIKE SYSTEM

During matches, periodically offer randomized upgrades.

Example:

Choose one:

- projectiles split
- attack speed +20%
- poisoned enemies explode
- support towers affect larger radius

This makes identical maps replayable.

---

# 48. TOWER DEFENSE MODES

Support eventually:

- Campaign
- Endless
- Challenge
- Co-op
- Daily Seed

Possible later mode:

**Versus**

Players defend separate paths and can influence opponents.

Do not implement PvP until the core TD is stable.

---

# 49. INCREMENTAL GAME

Create an extremely deep browser incremental game.

It should not simply be:

click button -> buy generator -> repeat.

Design around:

- resources
- automation
- production chains
- upgrades
- milestones
- multiple prestige layers
- unlockable systems
- offline progress

Theme may become increasingly absurd as progression continues.

The game should gradually transform in complexity.

Early game:

simple resource generation.

Mid game:

automation and interacting production systems.

Late game:

multiple prestige systems and large-scale optimization.

---

# 50. OFFLINE PROGRESS

Incremental game should calculate offline production.

Cap extreme offline durations if necessary for balance.

Never trust client clock alone.

Use server timestamps.

---

# 51. INCREMENTAL TYCOON

Separate from the pure incremental game.

This game focuses on building a business empire.

Players can:

- create businesses
- hire workers
- upgrade facilities
- research improvements
- automate operations
- expand into new industries

Include a simulated market.

Possible systems:

- supply
- demand
- pricing
- competitors
- market events
- recessions/booms
- research
- employee quality
- business reputation

Multiplayer interaction should initially be asynchronous.

Avoid making the entire economy dependent on all 15–20 users being online.

---

# 52. CASINO GAME

Casino is a fictional-money social game.

Use game-specific **Credits**.

Games may include:

- Blackjack
- Poker
- Plinko
- Mines
- Roulette-style game
- Dice
- simple social wagers

Poker should support betting decisions throughout a hand rather than one fixed wager.

Include:

- private tables
- friend tables
- public tables
- statistics
- leaderboard where sensible

Again:

NO REAL MONEY.

---

# 53. CASINO SOCIAL ECONOMY

Beyond casino minigames, this game may include:

- player transfers
- fictional loans
- interest
- collectible items
- marketplace
- trading
- limited items
- businesses
- periodic rewards

Because it is fictional, admins/developers should have debugging tools.

All financial changes must be transactional.

Maintain an internal transaction ledger.

Do not let the client directly set its balance.

---

# 54. DECK ROGUELIKE

Create a card-based roguelike inspired by the structure of modern deckbuilders without copying copyrighted cards/art/content.

Support:

- multiple playable characters
- character-specific mechanics
- cards
- relics
- status effects
- energy/resource system
- branching routes
- events
- shops
- elite enemies
- bosses

Initial target:

approximately 100–150 cards across the first set of playable characters.

Do not try to create 500 meaningless cards.

Quality and synergy matter more.

---

# 55. DECK ROGUELIKE RUN STRUCTURE

Map nodes may include:

- combat
- elite
- event
- shop
- rest
- treasure
- boss

Support:

- daily seeded run
- unlocks
- achievements
- run history

PvP is not required initially.

---

# 56. SOCIAL DEDUCTION GAME

Create an original social-deduction game inspired by the genre, not a literal Among Us clone.

Initial target:

**4–12 players**

Top-down 2D perspective.

Core concepts:

- cooperative objectives
- hidden hostile roles
- meetings
- voting
- elimination
- sabotage
- information gathering

Support:

- private rooms
- room codes
- public matchmaking
- custom roles
- text chat
- dead-player chat

Do not implement live voice initially.

---

# 57. SOCIAL DEDUCTION CUSTOM ROLES

Design role architecture that permits new roles later.

Example conceptual categories:

- Crew
- Hostile
- Neutral

Roles may have:

- abilities
- cooldowns
- win conditions
- visibility rules

Avoid hardcoding every role into one giant match controller.

---

# 58. PHYSICS SANDBOX

Make the physics sandbox **2D initially**.

This keeps it practical on Chromebooks and allows much more content.

Use physics inspired by sandbox/contraption games.

Support:

- ragdolls
- props
- joints
- vehicles
- explosives
- weapons
- environmental hazards
- NPCs
- triggers
- destructible objects where practical

Allow:

- save sandbox
- load sandbox
- share creation

Possible future:

multiplayer sandbox.

Do not require multiplayer initially.

---

# 59. GAME MAKER

The Tell Aviv creator should start as a constrained but powerful **2D level maker**.

Do not attempt a complete Roblox competitor.

Initial inspiration:

- Happy Wheels level editor
- Ultimate Chicken Horse
- Mario Maker
- physics sandbox editors

Users can create platform/physics levels.

---

# 60. GAME MAKER EDITOR

Editor features:

- select
- move
- rotate
- scale where appropriate
- duplicate
- delete
- undo
- redo
- grid snapping
- layers
- object browser
- property inspector
- play-test
- save
- publish

Object types:

- terrain
- platforms
- moving platforms
- slopes
- spikes
- saws
- explosives
- springs
- launch pads
- checkpoints
- finish zones
- doors
- buttons
- switches
- enemies
- NPCs
- vehicles
- physics props
- decorative objects
- trigger regions

---

# 61. VISUAL LOGIC

Eventually add accessible event/action logic.

Examples:

WHEN:
- player enters region

THEN:
- open door

WHEN:
- button pressed

THEN:
- activate platform

WHEN:
- enemies remaining equals zero

THEN:
- unlock exit

Potential logic blocks:

- event
- condition
- action
- variable
- timer

Avoid arbitrary JavaScript from users.

User-created scripting must be sandboxed or constrained.

---

# 62. COMMUNITY CREATIONS

Published creations include:

- title
- description
- creator
- thumbnail
- tags
- creation date
- update date
- plays
- likes
- favorites
- completion rate
- fastest completion
- difficulty

Users may:

- play
- favorite
- like
- comment
- follow creator

Do not implement creator payments.

---

# 63. PARTY GAMES

Create a flexible Party Games section for small games.

Examples:

- drawing/guessing
- trivia
- reaction games
- word games
- simple racing
- memory games
- elimination minigames

These should be easy to add.

Build shared lobby infrastructure.

---

# 64. BOARD/CASUAL GAMES

Eventually provide simple browser games such as:

- Chess
- Checkers
- Connect Four
- simple card games

These are useful for short school breaks and require little GPU power.

---

# 65. CLASSES

Classes is a complete private school-work area.

Every user receives their own workspace.

Users create classes manually.

Example:

Biotechnology
APUSH
Physics
English

Each class contains:

- folders
- documents
- notes
- assignments
- resources
- uploads
- flashcards
- quizzes
- links

---

# 66. SCHOOL CONTENT PRIVACY

Class content is **private by default**.

This is extremely important.

Never expose a user's school documents through:

- public search
- profile
- global chat
- game API
- server API

unless the user explicitly shares that specific resource.

---

# 67. CLASS NOTES EDITOR

Build a capable browser editor.

Support:

- headings
- paragraphs
- bold
- italic
- underline
- bullet lists
- numbered lists
- checkboxes
- links
- tables
- quotes
- code blocks
- inline code
- images
- equations/LaTeX
- horizontal rules

Autosave changes.

Keep document revision metadata.

---

# 68. CLASS FILES

Support:

- PDF
- DOCX
- PPTX
- common images
- TXT
- common spreadsheet formats

Initially these may be stored/downloaded rather than perfectly edited in-browser.

Do not spend the first development cycle recreating Google Docs.

---

# 69. ASSIGNMENTS

Assignment fields:

- title
- class
- description
- due date
- status
- priority
- links
- attachments

Statuses:

- Not Started
- In Progress
- Done

Classes homepage should surface upcoming deadlines.

---

# 70. FLASHCARDS

Users may create flashcard decks.

Cards:

- front
- back
- optional image
- tags

Support simple study modes.

Future:

spaced repetition.

---

# 71. QUIZZES

Users may create quizzes.

Question types:

- multiple choice
- true/false
- short answer

Support:

- score
- retry
- random order

Future AI generation can be added later.

Do not make AI a hard dependency for the initial platform.

---

# 72. SCHOOL SHARING

Users may explicitly share:

- document
- note
- flashcard deck
- quiz
- folder

Possible permissions:

- view
- edit

Shared resources may be:

- individual users
- friends
- server
- class server

Public internet publishing should require an explicit separate action.

---

# 73. VERSION HISTORY

For Tell Aviv-native notes/documents, retain simple revision history.

Allow:

- previous versions
- restore previous version

Do not version every gigantic uploaded binary indefinitely.

---

# 74. SEARCH

Build unified search architecture.

Categories:

- Users
- Games
- Servers
- Community Creations

Private authenticated search may additionally include:

- Friends
- Chat messages
- School files
- School notes

School results must honor permissions.

---

# 75. CREATE PAGE

The Create page eventually provides:

- New Level
- My Creations
- Drafts
- Published
- Templates

Future:

- Game Maker
- Physics creation

Creator profiles should show published works.

---

# 76. UI DESIGN DIRECTION

Tell Aviv should have its own recognizable identity.

Design direction:

- modern
- dark-first
- comfortable for long sessions
- slightly playful
- clean rather than corporate
- denser than a marketing website
- less cluttered than Discord

Support:

- Dark mode
- Light mode

Default:

Dark.

Use an original palette and layout.

Avoid copying Discord's exact:

- colors
- spacing
- sidebar structure
- channel icons
- component shapes

---

# 77. GAME VISUAL IDENTITY

Individual games may use completely different visual styles.

The game shell should remain recognizable as Tell Aviv.

Example:

Ego Trip can have its own art direction.

Casino can look like a fictional neon casino.

Tower Defense can be stylized.

Do not force every game to share the same colors.

---

# 78. RESPONSIVE DESIGN

Priority order:

1. Chromebook/laptop
2. desktop
3. tablet
4. phone

Main social UI should adapt to narrow screens.

Complex editors can display a message recommending landscape/desktop where necessary, but basic access must remain usable.

---

# 79. KEYBOARD CONTROLS

Games should not interfere with browser shortcuts unnecessarily.

Provide rebindable controls for major action games.

Store control preferences per user.

Common defaults:

WASD movement.

Escape:

game menu.

Do not hijack keys globally while the user is typing in chat/forms.

---

# 80. CONTROLLER SUPPORT

Create shared controller utilities.

Support standard browser Gamepad API.

Prioritize:

- Xbox-compatible mappings
- PlayStation-style mappings

Individual games decide which controls are needed.

Controller support is important for Ego Trip.

---

# 81. TECH STACK

Preferred baseline:

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS

## Backend

- Node.js
- TypeScript

Use Next.js server capabilities where reasonable, but do not force high-frequency realtime game logic into request/response routes.

## Database

PostgreSQL

## ORM

Drizzle ORM preferred.

Prisma acceptable only if the repository has a compelling reason.

## Realtime

Socket.IO initially.

Reasons:

- easy reconnection
- rooms
- fallback transports
- good browser support

## Cache / ephemeral state

Redis

Use Redis for:

- presence
- matchmaking
- distributed ephemeral state
- rate limits where needed
- room membership caches

Do not put durable canonical user data only in Redis.

## 2D games

Phaser

## Physics

Matter.js, either directly or through Phaser where practical.

## Storage

S3-compatible object storage.

For initial self-hosting, MinIO may be used if appropriate.

---

# 82. MONOREPO

Use a monorepo.

Recommended tooling:

pnpm workspaces.

Possible structure:

```text
/apps
  /web
  /realtime
  /worker

/games
  /ego-trip
  /tower-defense
  /incremental
  /casino
  /tycoon
  /deck-roguelike
  /social-deduction
  /physics-sandbox
  /party-games

/packages
  /game-sdk
  /game-runtime
  /auth
  /database
  /ui
  /chat
  /friends
  /presence
  /parties
  /leaderboards
  /achievements
  /storage
  /notifications
  /config
  /logging
  /shared
```

Do not make every directory an independent microservice.

This platform is initially for 15–20 users.

Prefer modular code over premature distributed architecture.

---

# 83. APPLICATION ARCHITECTURE

Start with a **modular monolith + realtime service**.

Do not build 20 microservices.

Core architecture:

### Web application

Responsible for:

- normal UI
- profiles
- games hub
- classes
- server management
- API endpoints
- authentication

### Realtime service

Responsible for:

- chat
- presence
- parties
- game lobbies
- multiplayer session signaling
- realtime game traffic where appropriate

### PostgreSQL

Durable state.

### Redis

Ephemeral realtime state.

### Object Storage

Files.

This is sufficient for initial scale.

---

# 84. DATA MODEL

Use proper normalized database design.

Expected major entities include approximately:

## Identity

- User
- Session
- UserProfile
- UserBadge
- UserSetting

## Social

- Friendship
- FriendRequest
- Block
- FavoriteFriend
- FriendNote

## Chat

- Conversation
- ConversationMember
- Channel
- Message
- MessageReaction
- MessageAttachment
- Thread
- Poll
- PollOption
- PollVote

## Servers

- Server
- ServerMember
- ServerRole
- ServerMemberRole
- ServerChannel
- ServerInvite

## Presence

Mostly Redis-backed, with durable settings where needed.

## Parties

- Party
- PartyMember

Active party state can use Redis with durable records only where necessary.

## Games

- Game
- GameVersion
- GameSave
- GameStatistic
- PlaySession

## Achievements

- AchievementDefinition
- UserAchievement

## Leaderboards

- LeaderboardDefinition
- LeaderboardEntry

## Inventory

- ItemDefinition
- UserItem

## Currency

- CurrencyDefinition
- CurrencyAccount
- CurrencyTransaction

## School

- SchoolClass
- SchoolFolder
- SchoolDocument
- SchoolFile
- Assignment
- FlashcardDeck
- Flashcard
- Quiz
- QuizQuestion
- SharedResource

## Creations

- Creation
- CreationVersion
- CreationLike
- CreationFavorite
- CreationComment
- CreationPlay

Exact table names may differ.

Do not blindly generate enormous schemas before understanding feature relationships.

---

# 85. IDENTIFIERS

Use stable unique IDs.

UUID, UUIDv7, or similarly robust IDs are acceptable.

Never rely on:

- usernames
- display names
- email addresses

as primary identifiers.

---

# 86. API DESIGN

Use typed APIs.

Keep clear separation between:

- authenticated platform API
- Game SDK
- realtime events

Validate all external inputs.

Use shared schemas where appropriate.

Zod is a reasonable choice.

---

# 87. REALTIME EVENTS

Use explicit namespaced events.

Examples:

```text
chat:message:create
chat:message:update
chat:typing:start

presence:update

friend:request

party:invite
party:update

game:lobby:join
game:lobby:leave
```

Game traffic should be namespaced per game.

Avoid an unstructured socket message handler containing dozens of unrelated if statements.

---

# 88. MULTIPLAYER ARCHITECTURE

For games where cheating matters, the server should be authoritative.

Examples:

- social deduction
- Casino
- competitive games
- leaderboard-relevant gameplay

For low-risk cooperative/single-player experiences, use the simplest reliable approach.

Do not blindly send every physics simulation frame through the central server.

Design multiplayer per game.

---

# 89. CONNECTION RECOVERY

Realtime features must tolerate brief connectivity failures.

Implement:

- reconnect
- lobby rejoin
- party recovery
- chat recovery
- presence refresh

Multiplayer games should define reconnect windows.

Example:

player may reconnect to an active match within 60 seconds.

Exact value game-specific.

---

# 90. SCHOOL NETWORK COMPATIBILITY

Use normal ports:

- HTTPS 443

Socket.IO should support fallback transport when WebSocket is unavailable.

Avoid designs that require direct peer-to-peer connectivity.

Do not depend on UDP.

This improves compatibility with restrictive networks.

---

# 91. SECURITY

Even though initial scale is small, Tell Aviv is publicly accessible.

Implement baseline web security properly.

Requirements:

- validate input
- escape user-generated HTML
- prevent XSS
- prevent SQL injection
- secure native registration, login and recovery
- CSRF protection where appropriate
- secure cookies
- authorization checks
- server-side permission checks
- file validation
- file size limits
- secrets in environment variables
- no secret keys shipped to browser

Never trust a user ID supplied by the client when session identity is available.

---

# 92. FILE SECURITY

Validate uploaded files by:

- extension
- MIME
- size

Store generated safe filenames internally.

Do not place user uploads directly inside executable application directories.

Serve uploads from controlled storage.

---

# 93. ECONOMY SECURITY

Currency mutations must happen server-side.

Every transaction should create an immutable ledger record.

Do not expose endpoints such as:

```text
POST /setBalance
```

Instead use actions such as:

- award reward
- purchase item
- transfer credits
- repay loan

Balances derive from legitimate transactions.

---

# 94. GAME CHEATING

For leaderboard-critical statistics:

Do not accept arbitrary final scores blindly from the browser.

Use server verification or server-authoritative state when practical.

For casual games, perfect anti-cheat is unnecessary.

Prioritize protection where cheating would meaningfully damage:

- economy
- leaderboard
- multiplayer match

---

# 95. ADMIN AREA

Tell Aviv should have a simple owner/admin dashboard.

Do not turn this into a giant enterprise moderation suite.

Include:

- user search
- service status
- game enable/disable
- feature flags
- announcements
- game version status
- server statistics
- active users
- active games
- database health
- object storage health
- Redis health
- recent errors
- economy debugging
- leaderboard reset tools
- emergency account disable
- emergency content removal

Potential game debugging:

- grant test currency
- reset game save
- view save metadata

Dangerous operations require clear confirmation.

---

# 96. FEATURE FLAGS

Implement feature flags early.

Examples:

```text
games.egoTrip
games.towerDefense
create.levelEditor
classes.flashcards
social.servers
```

This allows unfinished sections to remain disabled without deleting code.

---

# 97. GAME ENABLE/DISABLE

Each game can be:

- development
- beta
- public
- disabled

Disabled games should display a proper status page rather than crashing.

---

# 98. DEVELOPER MODE

Trusted developer accounts may access development tools.

Support:

- game debug UI
- test saves
- reset save
- test achievements
- fake lobby users where useful
- development currency

Developer features must never accidentally apply to normal users.

---

# 99. ANALYTICS

Use lightweight first-party analytics.

Track useful product statistics:

- active users
- game launches
- play duration
- crash rate
- matchmaking failures
- game completion
- creation plays

Avoid invasive tracking.

Do not add advertising trackers.

---

# 100. ERROR REPORTING

Implement structured server logging.

Logs should include:

- timestamp
- level
- component
- error
- request/session correlation ID where safe

Never log:

- authentication tokens
- session secrets
- private document contents

Add client error boundary reporting.

---

# 101. BACKUPS

Automated backup strategy:

PostgreSQL:

- daily backup

Object storage metadata/config:

- regular backup

Maintain multiple recent backups.

Document restore procedure.

A backup is not considered implemented until restoration is documented/testable.

---

# 102. DEPLOYMENT

Initial deployment should use:

**Docker Compose**

Target one reasonably capable VPS initially.

Services may include:

```text
web
realtime
postgres
redis
object-storage
reverse-proxy
```

Use a reverse proxy such as Caddy.

HTTPS required.

Do not deploy Kubernetes for 15–20 users.

---

# 103. ENVIRONMENTS

Support:

- development
- production

Staging is recommended once active development becomes risky.

Do not require staging before the first prototype.

---

# 104. ENVIRONMENT VARIABLES

Provide `.env.example`.

Validate required environment variables at application startup.

Never silently use unsafe production defaults.

---

# 105. CI

Use GitHub Actions.

At minimum:

On pull request/push:

- install
- typecheck
- lint
- unit tests
- build

Do not automatically deploy broken builds.

---

# 106. TESTING

Testing priorities:

## High priority

- authentication
- permissions
- friendships
- server roles
- chat
- school privacy
- currency
- save system
- game SDK

## Games

Test:

- critical progression
- save/load
- multiplayer state where applicable
- major boss/state transitions
- economy mutations

Do not attempt meaningless 100% coverage.

---

# 107. END-TO-END TESTS

Use Playwright for web application E2E tests.

This is unrelated to using Playwright as a browser-streaming system.

E2E flows:

- login mock/test flow
- create profile
- friend request
- server creation
- chat message
- upload school file
- create assignment
- launch game
- save/load game

---

# 108. ACCESSIBILITY

Implement reasonable accessibility.

Include:

- keyboard navigation
- visible focus
- readable contrast
- semantic elements
- labels
- reduced motion preference

Games should support:

- screen shake toggle
- flashing effects reduction where applicable

---

# 109. PWA

Tell Aviv may become an installable Progressive Web App.

Initial PWA functionality may include:

- manifest
- app icon
- home-screen installation

Do not make offline game support a v1 requirement.

Future offline support can focus on:

- notes
- selected class resources

---

# 110. DEVELOPMENT DOCUMENTATION

Maintain:

`README.md`

`docs/ARCHITECTURE.md`

`docs/DATABASE.md`

`docs/GAME_SDK.md`

`docs/ADDING_A_GAME.md`

`docs/REALTIME.md`

`docs/DEPLOYMENT.md`

`docs/BACKUP_RESTORE.md`

`docs/SECURITY.md`

`docs/CLASSES.md`

`docs/CREATOR.md`

Each major game gets:

`games/<game>/README.md`

---

# 111. PROJECT STATE

Maintain:

`PROJECT_STATE.md`

It should contain:

- completed
- working
- partially working
- planned
- known issues
- next priorities

Update it when significant work is completed.

Do not mark a feature "complete" simply because files exist.

---

# 112. CODING STANDARDS

Use:

- TypeScript strict mode
- clear naming
- modular components
- reusable hooks/services
- typed database access
- consistent error handling

Avoid:

- giant 2,000-line React components
- global mutable state everywhere
- unexplained magic numbers
- `any` as a convenient escape hatch
- enormous game manager classes
- duplicated authentication logic

---

# 113. GAME CODE ISOLATION

Each official game should primarily modify its own directory.

Shared changes require deliberate edits to packages.

This is important because multiple coding agents may eventually work simultaneously.

A developer building:

`/games/tower-defense`

should not casually modify:

`/games/ego-trip`.

---

# 114. ASTRA / SOL / OTHER AI GAME DEVELOPMENT

The architecture must support games created by separate AI coding agents.

Codex owns the shared platform architecture.

Other coding agents can be assigned a game directory.

They should receive:

- Game SDK documentation
- manifest specification
- UI integration contract
- save contract
- multiplayer contract

Codex should review shared integration.

---

# 115. ART ASSETS

Early development may use:

- simple original geometric art
- generated placeholder assets
- developer-created temporary sprites

Do not block game logic waiting for final art.

However:

avoid copyrighted ripped sprites/music/assets.

All placeholders should be easy to replace.

---

# 116. AUDIO

Games may use audio.

Support:

- master volume
- music volume
- sound effects volume
- mute

Browser autoplay restrictions must be handled correctly.

Do not play loud audio before user interaction.

---

# 117. DATA OWNERSHIP

Users should eventually be able to:

- delete account
- export basic account data

This does not need to be the first feature implemented.

Design schemas so account deletion is feasible.

---

# 118. SCHOOL MODE

Add a useful mode named:

**Focus Mode**

Focus Mode temporarily emphasizes:

- Classes
- assignments
- documents
- notes

and deemphasizes:

- games
- active game invitations

It should NOT pretend the site is something else.

It is simply a productivity mode.

Users can turn it on/off.

---

# 119. GAME PATCH NOTES

Each game has a patch-note page.

Examples:

`/games/ego-trip/patch-notes`

Patch note entry:

- version
- date
- additions
- changes
- fixes

The main Tell Aviv site also has platform changelogs.

---

# 120. INITIAL DEVELOPMENT ORDER

Do NOT start by generating all games.

The first objective is establishing a reliable platform.

---

## MILESTONE 0 — REPOSITORY FOUNDATION

Create:

- monorepo
- TypeScript config
- lint
- formatting
- testing
- environment config
- Docker dev environment
- PostgreSQL
- Redis
- initial documentation

Acceptance:

- repo installs cleanly
- dev environment starts
- test command works
- production build works

---

## MILESTONE 1 — IDENTITY

Implement:

- native username/password authentication
- account onboarding
- username selection
- user profile
- avatar
- banner
- bio
- status
- profile privacy
- settings

Acceptance:

Two separate users can authenticate and see independent profiles.

---

## MILESTONE 2 — SOCIAL

Implement:

- friend requests
- friends
- blocking
- muting
- favorites
- online presence

Acceptance:

Two browsers can establish friendship and see presence updates.

---

## MILESTONE 3 — CHAT

Implement:

- global chat
- realtime delivery
- history
- replies
- reactions
- edit/delete
- attachments
- typing
- search
- DMs
- group DMs

Implement richer features incrementally:

- polls
- GIFs
- stickers
- voice messages

Acceptance:

Chat survives refresh and multiple connected clients.

---

## MILESTONE 4 — SERVERS

Implement:

- create server
- roles
- text channels
- permissions
- invites
- discovery

Acceptance:

Users with different roles receive correct channel permissions.

---

## MILESTONE 5 — CORE GAME PLATFORM

Implement:

- game registry
- game detail page
- game manifest
- Game SDK
- cloud saves
- achievements
- leaderboards
- play sessions
- presence integration
- game community chat

Acceptance:

A tiny sample game can:

- identify player
- save progress
- unlock achievement
- submit leaderboard entry
- update presence

---

# 121. FIRST THREE GAMES

After platform foundations are verified, implement:

1. Incremental
2. Tower Defense
3. Small Party Game

These prove:

- saves
- game lifecycle
- achievements
- multiplayer
- leaderboards

Do NOT begin full Ego Trip before the Game SDK has been proven.

---

# 122. MILESTONE 6 — CLASSES

Implement:

- classes
- folders
- notes
- files
- assignments
- sharing
- flashcards
- quizzes

Acceptance:

A user can maintain a private class workspace and explicitly share one resource without exposing the rest.

---

# 123. MILESTONE 7 — CASINO + TYCOON + DECK ROGUELIKE

Build these after shared game infrastructure is mature.

Casino validates:

- secure transactions
- social game tables

Tycoon validates:

- persistent simulation

Deck Roguelike validates:

- large structured game content

---

# 124. MILESTONE 8 — EGO TRIP

Begin the proper Ego Trip implementation once:

- cloud saves are reliable
- controller abstraction works
- party system works
- multiplayer patterns are established
- leaderboard system works
- Game SDK is stable

Treat Ego Trip as a substantial game project, not a quick demo.

---

# 125. MILESTONE 9 — CREATOR

Implement:

- editor
- save drafts
- play-test
- publish
- community discovery
- stats

Then expand into visual logic.

---

# 126. MILESTONE 10 — PHYSICS SANDBOX + SOCIAL DEDUCTION

These require more specialized technical architecture.

Build them after shared platform systems have matured.

---

# 127. CODEx OPERATING RULES

This section is mandatory.

When working on Tell Aviv:

## Rule 1

Inspect existing code before changing architecture.

Do not regenerate the repository from scratch if functional systems already exist.

## Rule 2

Do not claim a feature works without validating it.

Run the relevant:

- tests
- typecheck
- build
- lint

and where practical test the actual flow.

## Rule 3

Do not fake completion.

If a UI button is not implemented:

- disable it
- label it appropriately
- track it as incomplete

Do not create a working-looking button that does nothing.

## Rule 4

Preserve functioning systems unless replacement is necessary.

## Rule 5

When discovering technical debt, document it instead of silently layering more complexity on top.

## Rule 6

Prefer straightforward code for 15–20 users over architecture designed for millions.

## Rule 7

Still maintain clean boundaries so later scale is possible.

## Rule 8

Never use real money for the casino system.

## Rule 9

Never expose private school data through games/social APIs.

## Rule 10

Never trust browser-generated currency, inventory, achievement, or leaderboard state.

---

# 128. WORK SESSION BEHAVIOR

At the beginning of a substantial task:

1. inspect relevant files
2. inspect documentation
3. determine dependencies
4. identify affected systems
5. implement
6. run tests
7. run typecheck
8. run build where reasonable
9. update documentation
10. update PROJECT_STATE.md

Do not spend excessive time writing plans while nothing is implemented.

---

# 129. DATABASE MIGRATIONS

Every schema modification must use migrations.

Never casually reset production data.

Development reset scripts may exist separately.

---

# 130. GAME SAVE MIGRATIONS

Every complex game should include save schema versions.

Example:

```ts
saveVersion: 3
```

When upgrading:

v2 -> v3 migration

Do not silently discard older saves.

---

# 131. CONFIG-DRIVEN GAME DESIGN

Where reasonable, gameplay balance should live in configuration.

Especially useful for:

- Ego Trip boss HP
- weapons
- mods
- Tower Defense towers
- enemies
- Deck Roguelike cards
- Tycoon businesses

Avoid burying every balance number in gameplay code.

---

# 132. ADMIN BALANCE TOOLS

Eventually provide developer-only interfaces for selected configuration.

Do not start by building a giant CMS.

JSON/TypeScript config files are acceptable initially.

---

# 133. BACKWARD COMPATIBILITY

The Game SDK should use explicit versions when major changes occur.

Example conceptual:

```text
sdkVersion: 1
```

Avoid breaking every game when one shared interface changes.

---

# 134. GAME EVENTS

Games should emit useful standardized events where appropriate:

- session started
- session ended
- achievement unlocked
- match started
- match ended
- run completed

These help activity feeds and analytics.

---

# 135. PRIVACY BOUNDARIES

Games may access only required account information.

A game may know:

- user ID
- username
- avatar
- party
- game-specific save

A game should NOT automatically receive:

- private DMs
- private school documents
- password hashes or private authentication tokens
- private server information

---

# 136. AUTHENTICATION DATA

Native authentication is isolated from game and public profile data.

Do not expose password hashes, opaque session tokens, reset-token digests,
recovery-code digests or private email in public DTOs or game snapshots.
Only the account owner can manage the optional email and recovery credentials.
Any future external provider must request only explicitly needed permissions.

---

# 137. STORAGE QUOTAS

Because the platform is small, start with generous but bounded limits.

Suggested:

Regular user:

**2 GB**

This covers:

- school files
- images
- voice messages
- community creation assets

Make quota configurable.

Do not create a complex billing/storage system.

---

# 138. DELETED FILES

Implement soft deletion/trash for school files where practical.

Trash retention:

approximately 30 days.

Users may:

- restore
- permanently delete

---

# 139. CACHE STRATEGY

Do not over-cache.

Cache appropriate items such as:

- presence
- frequently requested public game metadata
- server membership permissions where safe

PostgreSQL remains canonical.

---

# 140. HOMEPAGE ACTIVITY

Create activity entries intentionally.

Avoid turning every action into a feed item.

Good examples:

- major achievement
- level published
- leaderboard record
- friend started a public multiplayer lobby

Bad examples:

- user opened settings
- user changed volume
- user viewed a profile

---

# 141. USER SETTINGS

Settings categories:

- Account
- Profile
- Privacy
- Friends
- Notifications
- Appearance
- Accessibility
- Games
- Controls
- Storage

---

# 142. APPEARANCE

Support:

- dark
- light
- system

Eventually support accent customization.

Do not let custom CSS compromise site security.

---

# 143. SEARCH PERFORMANCE

Use PostgreSQL search initially.

Do not deploy Elasticsearch/OpenSearch for 20 users.

Upgrade search infrastructure only if necessary.

---

# 144. LIVE PLAYER COUNT

Game pages may show:

- players online
- friends playing

Use realtime/presence data.

Do not permanently write player count updates every few seconds to PostgreSQL.

---

# 145. MATCHMAKING

Create a lightweight shared matchmaking abstraction.

Games specify:

- game
- mode
- party
- desired player count
- optional skill data

Initial implementation can be queue/room based.

Do not prematurely implement complex ranked matchmaking.

---

# 146. PRIVATE GAME LOBBIES

Multiplayer games should support private room codes where appropriate.

Example:

```text
ABC123
```

Users can share the code in Tell Aviv chat.

---

# 147. GAME INVITES

Chat/profile presence may include:

**Invite to Game**

The recipient gets a notification containing:

- game
- lobby
- inviter
- join button

---

# 148. SPECTATING

Build spectator functionality game-by-game.

Do not pretend all games support spectating.

The Game SDK exposes whether the current activity is:

- joinable
- spectatable

---

# 149. USER CREATIONS STORAGE

Community creations should use structured level data rather than storing huge opaque blobs where possible.

Version creation schemas.

A creation stores:

- current version
- previous versions if appropriate

---

# 150. CREATOR SAFETY

Do not allow arbitrary executable code uploaded by users.

Visual logic is preferred.

If custom scripting ever exists later, it requires a real sandbox.

---

# 151. CODE OWNERSHIP

Shared platform packages should have clear responsibilities.

Example:

`packages/achievements`

should not contain Tower Defense logic.

Game-specific code remains in the game.

---

# 152. NO COPY-PASTE GAME ENGINES

If several games need:

- input
- audio
- user identity
- game shell
- controller detection

put common functionality in shared packages.

Do not create eight different versions.

---

# 153. DO NOT OVER-SHARE GAME STATE

Multiplayer servers should send clients only state they need.

For hidden-information games such as social deduction:

Never send secret roles or hidden information to unauthorized clients merely because the UI doesn't display them.

Authorization belongs on the server.

---

# 154. FINAL QUALITY BAR

Tell Aviv should eventually feel like one product.

A user should be able to:

1. Create a Tell Aviv account or sign in with username and password.
2. Check who is online.
3. Chat with friends.
4. Join a server.
5. Receive a party invite.
6. Launch a game.
7. Finish a run.
8. Unlock an achievement.
9. See that achievement on their profile.
10. Challenge a friend's leaderboard record.
11. Return to Classes.
12. Open school notes.
13. Share a flashcard deck with a friend.
14. Receive another game invitation.
15. Join without leaving the platform ecosystem.

That cohesion is the entire point of Tell Aviv.

---

# 155. FIRST IMPLEMENTATION COMMAND

Do not attempt to implement this entire document in one uncontrolled code-generation pass.

Begin by:

1. Inspecting the repository if one exists.
2. Creating or validating the monorepo structure.
3. Creating the architecture documentation.
4. Setting up PostgreSQL and Redis.
5. Setting up the Next.js web application.
6. Establishing native Tell Aviv authentication.
7. Implementing user onboarding/profile basics.
8. Adding tests for the authentication/profile foundation.
9. Confirming the production build succeeds.
10. Updating PROJECT_STATE.md.

Once the foundation is working, proceed through the milestones in order.

At the end of each milestone:

- test it
- document it
- record known issues
- leave the repository in a buildable state

The purpose is not to generate the most code.

The purpose is to build **Tell Aviv into a stable, extensible platform capable of supporting dozens of games and social/school features without collapsing under its own architecture.**