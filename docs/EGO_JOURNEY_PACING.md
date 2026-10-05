# Ego Trip: longer journeys and measured pacing

The new forty-room campaign is designed for 45–60 minutes including human route decisions, build choices and execution. It now requires actual mixed-squad fights, signal recoveries and deliveries, ward surveys, relay escorts and three boss phases. Progress depends on combat and movement; no encounter completes merely because a minimum time passed. An automated player completes 140/140 campaigns with **42.63 active minutes median**. That evidence supports the longer campaign design; it does not establish normal human duration.

## Campaign behavior

New normal, daily, seeded and endless campaigns use `pacingVersion: 1`. The same mission definitions drive casual solo, authoritative ranked solo and cooperative campaigns. Ordinary fights have three missions, elite/challenge/environment fights four, survival fights five and minibosses three. Each major boss has three original-health phases, with two missions exposing each phase. Shields clamp projectile, explosive and poison damage at the current phase floor before telemetry; a shield never restores health or creates artificial damage credit.

Each mission begins with a mixed squad. Courier missions require ordered pickup/delivery crossings; ward missions require three ordered survey marks; escort missions require recovery and guided crossings with a real ambush. Landmarks stay clear of all eight districts' solid cover. Carrying reduces movement and disables dash. The UI shows the current mission, current marker and shield status without exposing future objectives.

Mission clears earn bounded healing. Standard and volatile damage pressure differ, and shielded bosses use reduced attack cadence while their squads and objectives are active. Exposed boss phases retain their normal attack cadence. A new journey build has eight chosen upgrades plus up to ten earned boss-reward stacks, with bounded tempo/shield/dash stacking. Resource and late-build saturation still deserve playtesting.

A disconnected cooperative carrier drops the objective at their last physical position, requiring recovery. Stale input cannot transfer a connected guide's ownership. Shared choices, revivals, personal rewards and permanent progression retain their existing contracts.

## Compatibility and ranking

Missing-flag twenty-room and compact forty-room casual/cooperative checkpoints retain their original rules. The classic rush and ranked gauntlet remain shorter choices. Existing content-version conversion remains unchanged; the pacing flag is separate.

Ranked engine version is `ego-ranked-4.0.0`. The content fingerprint includes all shared journey rules, movement, sustain, pressure and stack limits. Existing incompatible ranked runs remain available in history/export and may be abandoned, but cannot continue under the changed rules. No casual checkpoint can become ranked progress.

## Simulation measurement

Run from the repository root:

```sh
node --expose-gc --import tsx scripts/ego-playtest.ts
```

The unchanged-source matrix completed on **2026-10-04 at 17:19:58 UTC**. It uses five seeds, seven weapons, two difficulties and two route policies: 140 campaigns, **5,600 cleared rooms and 1,120 bosses**. The ordinary visible-geometry heuristic moves, attacks, dodges and selects offered purchases through the normal engine inputs. Menus take no simulated time. No HP edits, teleports, synthetic elapsed time or outcome grants are used.

| Duration in active minutes | Minimum | Median | Maximum |
| -------------------------- | ------: | -----: | ------: |
| All 140 completions        |   36.47 |  42.63 |   50.88 |
| Standard, 70 completions   |   36.47 |  41.64 |   50.88 |
| Volatile, 70 completions   |   38.38 |  43.07 |   50.38 |

The report `.local/verification/ego-playtest-goals5.json` contains source SHA-256 fingerprints before/after, every run/room, weapon/route/difficulty/district comparisons, telemetry and sampled engine budgets. Sources stayed unchanged during measurement. The initial 139-win/one-timeout report is preserved as `ego-playtest-goals5-initial.json`: its bot repeatedly fired into a cover pillar. Ordinary movement cleared that enemy in 3.2 seconds. Correcting the bot's firing-line avoidance completed the same campaign; engine balance was unchanged, and a complete-run regression protects the case.

All measured runs held at most 18 upgrades; maximum sampled world size was 10,233 UTF-8 bytes. Typical engine-step p95 was 0.007 ms in this instrumented host simulation, excluding rendering, network and SQL. Those values do not establish production capacity or physical-device performance. Remaining Ego usually reaches its 250 cap after about 29.8 active minutes; balancing late spending remains open.

## Browser and human evidence

`scripts/ego-browser-playtest.ts` drives the actual ranked browser through keyboard, pointer and buttons, reading only its own server snapshots. Native-registration mode supports the Docker HTTPS deployment, and cleanup uses password reauthentication and authenticated account deletion. It records server/wall time, all room transitions, canvas paints, bounded whole-run frame sampling, heap samples and page errors. The Docker HTTPS run completed **40 rooms and eight bosses in 43.99 wall minutes**, with zero page errors and successful authenticated cleanup. Menus were chosen automatically, so this remains an automated run rather than normal human pacing. See [deployment verification](VERIFICATION_DEPLOYMENT_2026-10-04.md) for its performance and cleanup evidence.

Cooperative evidence includes a fresh two-account browser case that completes a full first patrol, pickups and deliveries through ordinary controls and verifies carrier reload recovery, without rewriting game health or objective state. It does not measure a complete human cooperative campaign.

Human 45–60-minute duration, enjoyment of repeated crossings, long-run cooperative balance and physical/mobile performance require actual playtester sessions. Faster expert routes may finish below 45 minutes. Historical short-campaign measurements remain in [EGO_PLAYTEST_3](EGO_PLAYTEST_3.md).
