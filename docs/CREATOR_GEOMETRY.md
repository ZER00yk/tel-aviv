# Creator geometry, rail carts and explosives

The shared Creator runtime adds nine object types to the existing sixteen: `slope`, `angled-platform`, `polygon-platform`, `one-way-platform`, `moving-hazard`, `rotating-hazard`, `cart`, `explosive` and `destructible`. Existing schema versions 1 and 2, original objects and declarative logic remain supported. These are structured mechanics; a level cannot upload executable code.

## Geometry and hazards

Slopes are triangular solids with a left/right rise direction. Angled platforms are rotated rectangular solids. Polygon platforms have three to eight normalized vertices; resizing preserves their shape. The schema rejects concavity, crossing edges, duplicate/degenerate edges, small area and nonfinite/out-of-range coordinates. The editor offers triangle, trapezoid and hexagon presets plus individual vertex controls.

The scene SVG and server/browser simulation use the same world-space polygon vertices. A bounded separating-axis test resolves the player rectangle against the new convex solids. Grounded players follow an upper slope surface while walking down it; empty corners of the enclosing rectangle do not become invisible walls. Original platform/door collision behavior is retained for older creations.

One-way platforms remain horizontal. Rising players pass through them; falling players land when their feet cross the upper face from above. The editor and server reject rotation for this type. There is no drop-through command.

Moving hazards use deterministic cosine motion. Their complete path must stay in the level, their distance is at most 300 pixels, and their cycle lasts at least two seconds. Rotating hazards turn at 5–180 degrees per second in either direction. Both hazard types have dimensions bounded to 240 pixels and use polygon collision against the visible body. Contact causes the normal death/checkpoint respawn.

## Rail carts

The initial vehicle is a horizontal rail cart with one player seat. Press **E** within the seat's interaction range to board, move with left/right or A/D, and press E again to exit. Holding E cannot repeatedly toggle the seat. Touch playtests expose an Interact button.

Drive speed is capped at an authored 40–180 pixels per second, with bounded acceleration and braking. The cart stops at solids, closed doors and world edges. Collision checks use eight bounded subdivisions to locate a safe stopping position. A seated player's death resets that cart to its authored position and clears its speed; an explicit exit leaves it at the current position. A forceful blast ejects the driver. This release does not provide free-driving cars, wheel physics, passenger seats or vertical cart tracks.

Levels may author at most sixteen carts. Spawn logic also bounds live carts, in addition to its existing 32 total runtime-spawn cap.

## Explosions

Explosives have contact or nearby-E fuses, with these validated settings:

| Setting | Allowed range   |
| ------- | --------------- |
| Radius  | 40–240 pixels   |
| Damage  | 1–100           |
| Force   | 0–500           |
| Fuse    | 0.25–10 seconds |

Blasts damage the player and enemies, apply capped player impulses, remove destructible solids, emit existing destruction/enemy-defeat events, and ignite nearby explosives. A destruction event can change an objective or open a door through the existing visual logic editor. Destructibles break immediately when inside a blast; they do not have a separate damage meter.

The simulation permits at most **32 active fuses**, **16 blasts per fixed tick**, **64 affected object targets per blast** and **eight links from a chain's origin in one tick**. Longer chains retain a zero fuse and continue on a later tick. A chain honors the active-fuse cap while running, including spawned explosives. It does not use recursive calls. Work also remains bounded by the level's 300 objects, 32 runtime spawns and existing event/action budgets. Explosion visuals last 0.3 seconds and their count is bounded.

## Deterministic verification and templates

Authoring playtests and server input replay use the same 60 Hz implementation. E is part of the allowlisted input protocol; completion requests carry inputs rather than a claimed finish time. Persisted attempt JSON from before these mechanics initializes missing vehicle, fuse, impulse and visual fields to safe defaults. Runtime revision `creator-geometry-1` is exported by the shared package so verified attempts and rankings can be scoped to an exact simulation release.

Six editable templates include the existing platformer, key collection, timed gate and moving-platform levels, plus **Slopes & precise geometry** and **Rail cart & chain reaction**. The cart template requires boarding, driving into a contact-fuse chain, breaking the barrier and reaching the finish. It is not completed by a client-side result flag.

## Verification

Focused unit coverage preserves all 28 legacy runtime cases and exercises slope traversal, rotated empty corners, convex validation, one-way jump/landing, moving/rotating hazards, old attempt JSON, cart boarding/exit/stopping/reset, contact and interaction fuses, bounded deferred chains, spawned-fuse cap enforcement and all six templates. Browser coverage edits and saves geometry, reloads it and completes a playtest; a separate account boards the published cart template, breaks its barrier and receives server-verified completion.

General multiplayer physics, custom assets, collaboration and autosave are separate work. These new mechanics do not make existing single-player levels multiplayer-safe.
