/goal Implement as much of Tell Aviv as possible according to /docs/TELL_AVIV_SPEC.md.

PRIMARY OBJECTIVE

The priority of this Goal is MAXIMUM IMPLEMENTED PRODUCT COVERAGE.

Work through the Tell Aviv specification and implement as many complete or substantially functional systems, features, and games as possible before this Goal ends.

Do not stop after completing only the platform foundation.

Do not stop after one milestone unless there is no useful implementation work remaining or the Goal budget/system limits prevent further work.

Continue through subsequent milestones and game development whenever dependencies are sufficiently functional.

The desired outcome of this first pass is a very large working implementation of Tell Aviv that can later receive a dedicated debugging, integration, balance, performance, and polish pass.

AUTHORITATIVE SPECIFICATION

Treat:

/docs/TELL_AVIV_SPEC.md

as the authoritative product specification.

Also maintain:

/PROJECT_STATE.md
/docs/KNOWN_ISSUES.md

If these files do not exist, create them.

GENERAL STRATEGY

Favor implementation breadth while maintaining reasonable architectural quality.

This is a BUILD PASS, not the final stabilization pass.

Do not spend disproportionate amounts of the available Goal budget trying to perfect one subsystem while major parts of the specification remain entirely unimplemented.

When encountering a non-blocking issue:

1. determine whether it prevents meaningful continued development;
2. if not, document it in KNOWN_ISSUES.md;
3. continue implementing the next useful feature;
4. return to it later if time/budget remains.

When encountering a blocking issue:

1. investigate it;
2. fix it if a defensible fix is available;
3. verify enough functionality to continue;
4. resume feature implementation.

Do not knowingly build large amounts of dependent functionality on top of completely broken foundational systems.

However, do not require every warning, edge case, cosmetic defect, optimization issue, or minor test failure to be solved before proceeding.

PRIORITY ORDER

Prioritize work approximately in this order:

1. architecture and repository foundation
2. authentication and user accounts
3. profiles and settings
4. friends and presence
5. global chat and direct messages
6. servers and server permissions
7. notifications and parties
8. core Game SDK
9. cloud saves
10. achievements
11. leaderboards
12. game registry and game launcher
13. first playable games
14. Classes workspace
15. additional games
16. Ego Trip
17. Creator / level editor
18. remaining larger games and systems
19. polish and optional enhancements

Dependencies take precedence over this order when necessary.

Do not interpret the priority order as permission to stop after early items.

KEEP GOING.

Once one area is sufficiently functional to support dependent work, move forward.

FIRST-PASS COMPLETION PHILOSOPHY

For this Goal, a feature may be considered sufficiently implemented to continue development when:

- its primary intended functionality exists;
- its major data flow works;
- it is connected to the rest of Tell Aviv where applicable;
- obvious catastrophic errors are fixed;
- dependent features can reasonably build on it.

A feature does NOT need to be perfect before moving forward.

Examples of issues that generally should NOT stop this build pass:

- imperfect responsive layout
- minor visual inconsistency
- non-critical animation bugs
- rare edge cases
- incomplete accessibility polish
- small performance opportunities
- minor game balancing problems
- incomplete test coverage
- a failing test for a non-critical edge case
- rough placeholder art
- imperfect error copy
- minor mobile layout problems
- optional feature polish
- non-critical warnings

Record these and continue.

Examples of problems that SHOULD normally be addressed before building dependent systems:

- authentication fundamentally broken
- database migrations cannot run
- application cannot start
- Game SDK cannot load users
- saves destroy or overwrite unrelated data
- core authorization is missing
- private school documents are publicly exposed
- currency can be arbitrarily modified by clients
- realtime architecture fundamentally cannot connect
- TypeScript/build errors prevent running the application
- a shared package is so broken that dependent games cannot load

MILESTONE HANDLING

Use the milestones in TELL_AVIV_SPEC.md as an implementation sequence, not hard stopping points.

When a milestone is substantially functional:

1. update PROJECT_STATE.md;
2. record remaining defects in KNOWN_ISSUES.md;
3. run a reasonable smoke verification;
4. proceed immediately to the next milestone.

Do NOT stop and wait for the user after every milestone.

Continue autonomously.

PROJECT_STATE.md

Maintain a detailed project state.

Use categories such as:

COMPLETE
SUBSTANTIALLY IMPLEMENTED
PARTIAL
NOT STARTED
BLOCKED

For every major system, record its current state.

Example:

Chat
- Global messages: complete
- DMs: substantially implemented
- Group DMs: partial
- Voice messages: not started
- GIF picker: partial

Do not mark something COMPLETE unless its main expected behavior actually works.

KNOWN_ISSUES.md

Maintain a structured technical debt and bug backlog.

For each issue include:

- area
- severity
- symptoms
- suspected cause if known
- reproduction information if known
- whether it blocks other development
- recommended follow-up

Severity levels:

CRITICAL
HIGH
MEDIUM
LOW
POLISH

This file will be used extensively in the second Goal pass.

DO NOT GET STUCK

If a feature proves disproportionately difficult relative to its importance:

1. attempt the most defensible implementation;
2. investigate obvious failures;
3. if the problem remains non-foundational, document its current status;
4. isolate it behind a feature flag if necessary;
5. continue with other independent work.

Do not burn the entire Goal budget endlessly retrying one optional feature.

Likewise, do not abandon a feature after one failed attempt when a reasonable next approach exists.

Use engineering judgment.

PARALLELIZABLE WORK

When one feature is blocked by an external dependency, continue work that does not require that dependency.

Examples:

If Google OAuth requires credentials that are not available:
- finish the authentication abstraction;
- provide development authentication where appropriate;
- continue building profiles and other systems against the abstraction;
- clearly document what production OAuth still needs.

If object storage credentials are unavailable:
- implement the storage abstraction;
- use a development/local provider if appropriate;
- continue work that can be verified locally.

Never pretend external integration has been verified when it has not.

CODE QUALITY

Breadth does NOT mean producing disposable code.

Continue following the architecture in the specification.

Requirements remain:

- TypeScript strict mode
- modular code
- database migrations
- validation
- clear boundaries
- Game SDK isolation
- authorization
- server-side economy mutations
- private school data boundaries
- no arbitrary user scripting
- no real-money gambling

Avoid:

- giant monolithic files
- duplicated platform logic inside games
- hardcoded fake account state
- fake buttons presented as functional
- TODO-only implementations labeled complete
- static screenshots replacing functionality
- client-trusted currency
- client-trusted leaderboard scores where important

TESTING DURING THIS PASS

Testing is still required, but optimize testing effort for continued construction.

After major architectural changes, run relevant:

- typechecking
- build
- migrations
- critical unit tests
- important integration tests
- targeted E2E tests

If the entire suite contains non-blocking failures:

- identify them;
- document them in KNOWN_ISSUES.md;
- confirm they do not invalidate foundational functionality;
- continue implementation.

Do not intentionally leave the repository unable to build for long periods.

Prefer returning it to a runnable state before making another major architectural jump.

SMOKE TESTS

Periodically verify high-value user flows.

Examples:

- application loads
- authentication/session works in available environment
- profile loads
- users can interact socially
- chat sends and persists messages
- game can launch
- game can identify logged-in user
- game can save/load
- achievements can unlock
- leaderboard can accept valid results
- Classes content remains private
- files can be associated with a class
- multiplayer lobby can connect where implemented

GAMES

After the Game SDK is sufficiently functional, begin implementing games rather than endlessly expanding platform abstractions.

Prioritize games that validate shared infrastructure while also providing real entertainment.

Suggested initial sequence:

1. Incremental
2. Tower Defense
3. Party Games
4. Casino
5. Incremental Tycoon
6. Deck Roguelike
7. Ego Trip
8. Social Deduction
9. Physics Sandbox
10. Creator / Game Maker

This sequence may change when technical dependencies make another order more efficient.

Do not create ten empty game shells.

A smaller number of actually playable games is more valuable than a catalog of placeholders.

However, once a game reaches a meaningful playable state, move on rather than attempting endless content expansion during this first build pass.

GAME IMPLEMENTATION DEPTH

For each game, prioritize:

1. core gameplay loop
2. saving
3. platform identity integration
4. achievements
5. leaderboards where appropriate
6. multiplayer where part of the game's core
7. settings/controls
8. enough content to meaningfully play
9. polish
10. massive content expansion

Once points 1–6 are substantially functional where applicable, continuing to another game may provide more value than adding dozens more content items.

EGO TRIP

Ego Trip is an exception because it is intended to be a flagship game.

Once prerequisites are stable enough, give Ego Trip substantial implementation effort.

Prioritize:

- responsive movement
- dash
- combat
- weapon architecture
- mod architecture
- procedural encounter structure
- miniboss infrastructure
- boss infrastructure
- several complete bosses
- shops
- helpers
- run progression
- meta progression
- saves
- achievements
- leaderboards
- co-op architecture

Do not spend the entire first build pass creating every planned Ego Trip boss if major Tell Aviv systems remain unimplemented.

CLASSES

Implement Classes as a real functional product surface, not a placeholder.

Prioritize:

- classes
- folders
- native notes
- uploads
- assignments
- search
- sharing permissions
- flashcards
- quizzes

The most important constraint is:

PRIVATE SCHOOL CONTENT MUST REMAIN PRIVATE BY DEFAULT.

CREATOR

If sufficient Goal budget remains after major platform/game implementation, build the level creator.

Prioritize:

- place objects
- select
- move
- rotate
- duplicate
- delete
- undo/redo
- save
- load
- play-test
- publish
- community play

Visual logic may follow after the editor itself works.

FEATURE FLAGS

If incomplete systems would destabilize the normal user experience, put them behind feature flags.

Do not delete substantial partial work merely because it is unfinished.

Document the state and proceed.

EXTERNAL BLOCKERS

Only stop for user input when an issue truly cannot be progressed without the user.

Examples:

- unavailable secret/credential with no usable development substitute
- external service requiring an interactive action by the user
- risk of destructive loss of existing production data
- a genuinely ambiguous major product decision not resolved by the specification
- no defensible technical path remains

Before declaring a blocker:

- inspect the repository;
- inspect logs/errors;
- try reasonable alternatives;
- continue unrelated work where possible.

Do not stop the entire Goal because one external integration is blocked if other useful implementation work remains.

AUTONOMY

Make reasonable implementation decisions yourself.

Do not repeatedly ask for:

- naming of internal database columns
- exact component filenames
- library choices already covered by the specification
- minor UI spacing decisions
- minor game balance values
- ordinary implementation details

TELL_AVIV_SPEC.md defines the product direction.

Use engineering judgment for low-level choices.

DOCUMENTATION

Continuously maintain relevant documentation, especially:

README.md
PROJECT_STATE.md
docs/KNOWN_ISSUES.md
docs/ARCHITECTURE.md
docs/DATABASE.md
docs/GAME_SDK.md
docs/ADDING_A_GAME.md
docs/REALTIME.md
docs/DEPLOYMENT.md
docs/BACKUP_RESTORE.md
docs/SECURITY.md

Do not spend excessive implementation budget producing verbose documentation for trivial details.

Documentation should enable the next coding pass to understand the system quickly.

GOAL STOP CONDITION

Do NOT mark this Goal complete merely because:

- the first milestone is complete;
- the first three games work;
- the foundation works;
- one development session ended;
- there are bugs remaining;
- a non-critical test is failing;
- one feature is blocked.

Continue implementing useful parts of TELL_AVIV_SPEC.md.

This Goal should end only when one of the following is true:

A. Essentially every reasonably implementable major requirement in TELL_AVIV_SPEC.md has received a functional implementation during this pass;

OR

B. The available Goal/system budget has been exhausted;

OR

C. Remaining work is blocked on user/external actions and no meaningful independent implementation work remains;

OR

D. Continuing implementation would create unreasonable risk to existing data or repository integrity.

If stopping because of B, C, or D, do NOT pretend the project is complete.

Instead provide an exact state report.

FINAL STATE REPORT

At the end of this Goal, provide:

1. major systems completed;
2. substantially implemented systems;
3. partial systems;
4. games and their playable state;
5. unimplemented systems;
6. known critical/high-priority bugs;
7. failing tests/build checks;
8. external blockers;
9. technical debt introduced;
10. recommended order for the stabilization pass.

Ensure PROJECT_STATE.md and KNOWN_ISSUES.md contain the same information before ending.

MOST IMPORTANT INSTRUCTION

KEEP BUILDING.

The objective of this Goal is not to produce a perfect first subsystem.

The objective is to turn as much of TELL_AVIV_SPEC.md as possible into real, integrated, runnable software during this pass, while keeping foundational systems sufficiently healthy that the next dedicated pass can focus on fixing, verifying, optimizing, balancing, and polishing the resulting application.