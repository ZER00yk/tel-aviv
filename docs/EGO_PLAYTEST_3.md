# Ego Trip campaign quality measurements

This is historical evidence for the October 3 compact campaign. [Current journey pacing](EGO_JOURNEY_PACING.md) supersedes its timing results. Running the current playtest script writes `ego-playtest-goals5.json`; reproducing these original results requires the preserved October 4 source archive from the earlier handoff.

Measured on 2026-10-03 with the current casual solo campaign. The deterministic bot completed **140 of 140 full campaigns**, each with 40 rooms and eight major bosses. Complete simulation time ranged from **139.72 to 488.44 seconds**, with **299.08 seconds (4.98 minutes) median**. The requested **45–60-minute normal human run remains unverified and unmet as a demonstrated pacing target**. No waiting, enemy HP padding, teleportation, outcome mutation, free upgrades or resource grants were used to reach these results.

## Reproduce the measurement

From the repository root:

```sh
node --expose-gc --import tsx scripts/ego-playtest.ts
```

The script writes `.local/verification/ego-playtest-goals3.json`, containing every room, per-run summaries, room/boss/district comparisons, environment details and source SHA-256 fingerprints before and after measurement. It exits with status 2 if those sources changed during measurement. The final measured matrix had unchanged source fingerprints during its run. It used seeds **81, 481, 2026, 20261003 and 3735928559**, all seven weapons, both standard and volatile difficulty, and safer and objective-first routes: **5 × 7 × 2 × 2 = 140** runs. Each weapon has 20 runs; each route and difficulty has 70. A separate warm-up run is excluded from the counts.

The bot reads visible positions, telegraphs, bullets and terrain. It moves, aims, attacks, uses alternates and dashes through the ordinary `Input` interface at 25 fixed simulation steps per second. It selects actual offered upgrades, pays actual shop costs, makes supported event choices and chooses actual available routes. Menus and route decisions take no simulated time. The runs are deterministic simulations, not human sessions or browser frame measurements. Route, weapon and upgrade comparisons share a heuristic rather than an independent human evaluator; they identify candidates for balance work without proving a causal ranking of every build.

## Full-run results

| Measurement                        | Minimum | Median | Maximum |
| ---------------------------------- | ------: | -----: | ------: |
| Simulated combat duration, seconds |  139.72 | 299.08 |  488.44 |
| Damage dealt                       |  10,269 | 13,616 |  20,145 |
| Incoming combat damage             |      20 |     70 |     234 |
| Actual healing                     |      79 |    130 |     294 |
| Upgrades held                      |      32 |     34 |      34 |
| Remaining Ego                      |     237 |    250 |     250 |

Mean run duration was 299.58 seconds; the 95th percentile was 468.04 seconds. The matrix exercised 5,600 cleared rooms and **1,120 major boss clears**, totaling 41,940.76 simulation seconds. It produced zero losses and zero timeouts after the bot learned to move around visible cover.

Healing telemetry includes actual healing from max-health upgrades; it is not exclusively consumable or helper healing. Incoming combat damage excludes voluntary HP trades in events and shops. Room entries retain starting/ending health, max health, resource deltas, actual acquired mods, observed enemy kinds, and boss phases/attacks so the underlying numbers can be audited.

| Comparison             | Median duration, seconds | Median incoming damage |
| ---------------------- | -----------------------: | ---------------------: |
| Safer routes           |                   204.24 |                     71 |
| Objective-first routes |                   390.72 |                     64 |
| Standard difficulty    |                   295.36 |                     60 |
| Volatile difficulty    |                   305.72 |                     82 |

Objective-first routes lengthen the campaign through defending a relay and moving through ordered beacons. These rooms require a distinct activity; their duration is not added downtime. Volatile increases observed combat damage more substantially than duration. Across all completed campaigns, the median upgrade count was already 13 by the third district and reached 34 at the end. Median room-exit resources reached the 250-Ego cap in district three; the bot spent an average of **75.24% of combat time at the cap**. Its avoidance of optional spending and risk choices affects this result, but late resource decisions deserve further attention.

## Weapons and upgrade progression

Every weapon completed all 20 runs in the final matrix.

| Starting weapon | Median complete run, seconds | Median incoming damage | Median initial room, seconds |
| --------------- | ---------------------------: | ---------------------: | ---------------------------: |
| Pulse           |                       366.28 |                     61 |                         3.28 |
| Scatter         |                       305.72 |                     84 |                         4.32 |
| Blade           |                       345.80 |                    114 |                         3.40 |
| Comet           |                       358.52 |                     82 |                         4.28 |
| Lance           |                       295.36 |                     54 |                         2.42 |
| Boomerang       |                       327.80 |                     63 |                         4.00 |
| Prism           |                       339.60 |                     72 |                         3.42 |

Initial-room comparisons use one safer-route run for each seed/difficulty pair, giving ten samples per weapon without duplicating the identical initial room from the other route strategy. Combat in that room happens before the first reward upgrade is applied. Lance cleared this shared opening fastest under this control policy. Blade incurred the most median full-run damage, consistent with its close-range approach. Different random offers and later route selections mean full-run medians do not isolate weapon damage alone.

Mean measured room damage per second rose from 29.55 in district one to 64.46 in district eight. Mean incoming damage per cleared room was 3.28 in the first district, 0.68 in district seven and 2.63 in district eight. Upgrade accumulation currently outruns this bot's observed late-room pressure. This is an actionable quality concern, not proof that a particular human build is invulnerable.

## Boss and encounter audit

| Boss    | Median fight, seconds | Median incoming damage | Median attack calls |
| ------- | --------------------: | ---------------------: | ------------------: |
| Rowan   |                  8.52 |                      0 |                   4 |
| Bennett |                  8.76 |                      0 |                   4 |
| Austin  |                  9.80 |                    6.4 |                   4 |
| Dakota  |                 11.20 |                      0 |                   4 |
| Mira    |                  9.52 |                      0 |                   4 |
| Sol     |                 10.08 |                      9 |                   4 |
| Inez    |                  9.20 |                    3.6 |                   4 |
| Noa     |                  9.32 |                   10.8 |                   4 |

All three phases were observed in every major boss clear, but a median four attack calls per fight means most fights expose relatively little of each boss's attack catalog. An attack call can produce multiple hazards or projectiles; it is not an attack-count estimate for those individual objects. Major boss duration ranged from 3.08 to 25.28 seconds across this matrix. Boss identity/phase transitions work under ordinary input, while sustained boss depth and punish-window pacing still need further balance work and human evaluation.

Median combat-room duration was 4.12 seconds for battle, 5.04 for miniboss, 9.40 for elite, 10.08 for environmental patrols and 15.84 for survival. Protect-objective rooms lasted a median 35.08 seconds under enemy pressure; movement trials lasted 7.56 seconds and required the bot to reach ordered beacons. Shops and events record zero simulation seconds because the bot decides immediately, which must not be presented as their human reading/decision time.

The route strategies exercised **16 of 19 available room kinds**. They did not select trade, curse or rare rooms, so these measurements do not validate those event branches. Equal adjacent room kinds occurred in 311 of 5,460 transitions (5.70%). The fixed miniboss and boss itinerary accounts for 16 of the 40 rooms; a low adjacent-repeat rate alone does not establish that a full run feels varied. All six patrol enemy kinds appeared in recorded rooms.

An earlier matrix exposed three projectile-bot stalls against pillars and three relay losses. The bot initially preferred a safe firing position even when a pillar blocked every shot. Visible line-of-fire scoring now makes it move around cover when fighting an enemy, while preserving beacon/relay navigation priority. The final matrix resolved those stalls with ordinary movement and shooting. No engine progression fix was inferred from a heuristic limitation.

## Performance, memory and state size

The run environment was Node 24.19.0 on cloud Linux x64 with an AMD EPYC 9V74 CPU; the JSON records the full environment details. Median bot wall-clock duration was 58.38 ms per complete run, including input selection, engine execution and measurement work. Median per-run engine-step 95th percentile was **0.007 ms**; the highest per-run 95th percentile was **0.019 ms**. The longest individual observed engine step was **11.132 ms**. This timing excludes browser drawing, GPU work, browser event scheduling, network round trips and co-op simulation, so it cannot establish a frame-rate guarantee.

World serialization used actual UTF-8 byte lengths. The largest sampled world was **7,283 bytes**; observed object maxima were **36 bullets, 20 hazards and 11 enemies**. State bytes are sampled every five simulation seconds and at room exits, so transient between-sample serialization peaks may be larger. Late state size stayed bounded in the tested routes, and final worlds contain at most the measured room/history/build data rather than an unbounded input trace.

With explicit garbage collection before and after each run, the median collected heap difference was **57,536 bytes**, ranging from −265,136 to 320,240 bytes. The largest periodically observed process heap was 77,401,472 bytes. These measurements include JIT/runtime allocations, bot instrumentation and accumulated report objects. They neither prove a gameplay memory leak nor substitute for a long browser heap profile; the retained report grows intentionally as each run is recorded.

## Actual ranked browser campaign

A separate Chromium pass completed all forty rooms and eight bosses through the ordinary ranked canvas, keyboard, pointer and offered choice buttons. It read only the fixture account's authenticated snapshots to select those inputs. It did not edit gameplay SQL, submit an outcome, change elapsed time or call the simulation directly. The server generated seed **1168070956** and recorded version **ego-ranked-3.0.0-fae20653e1a6**. Campaign wall time was **255.061 seconds (4.25 minutes)**, excluding **2.450 seconds** of account/page/run setup; accumulated server simulation was **191.813 seconds**. This automated local browser run also falls far short of demonstrating the 45–60-minute human target.

The pass recorded 15,104 `requestAnimationFrame` intervals: median **16.7 ms**, 95th percentile **16.8 ms**, maximum **300 ms**, with **seven intervals over 50 ms**. These measure browser scheduling, not game rendering. The ranked canvas was repainted **1,547 times**, approximately **6.07 paints per second** over the measured run; it follows server snapshots rather than drawing a new combat state at 60 Hz. There were **zero page errors**. Final canonical world serialization was **2,145 bytes**.

Twenty-five `performance.memory` samples were collected approximately every ten seconds. Used JS heap ranged from **123,277,043 to 168,860,043 bytes**; the first sample was **149,000,893 bytes** and the last **123,277,043 bytes**. These are development-tab measurements including Next/React, framework caches, the meter and runtime garbage collection. They do not isolate gameplay allocations, establish a memory-leak conclusion or demonstrate a mobile budget. This is one automated player and server-generated seed on local cloud Chromium, with no production latency or representative device measurements.

Reproduce with `node --env-file=.env --import tsx scripts/ego-browser-playtest.ts`. The report and full-page capture are `.local/verification/ego-browser-playtest-goals3.json` and `.local/verification/ego-browser-playtest-goals3.png`; the rerun log is `.local/verification/ego-browser-playtest-goals4.log`. The meter uses plain JavaScript initialization to avoid a tsx helper being serialized into the browser realm, and the script now fails if timing, paint or heap measurements are empty. An earlier attempt completed the campaign but failed meter initialization with `__name is not defined`; its zero timing/paint and empty heap data were invalid and were replaced by this measured pass.

## Remaining quality work

- Measure complete runs with human players, including reading and route/build decisions, before claiming the 45–60-minute target.
- Address the short miniboss/major-boss windows and late upgrade/resource saturation with meaningful pressure, decisions and attack opportunities rather than global HP increases or mandatory waiting.
- Exercise the three unselected room kinds, less defensive builds and additional route policies.
- Measure rendering and heap over sustained actual browser play, including co-op and ranked, on representative desktop/mobile hardware.
- Repeat this source-fingerprinted matrix after any subsequent balance/content change; the numbers above describe the measured source snapshot, not future revisions.
