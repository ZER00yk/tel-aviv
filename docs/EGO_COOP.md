# Ego Trip private co-op

The private 2–4-player play screen offers the original four-boss gauntlet and a synchronized forty-room/eight-district campaign. Both use the shared authenticated room-code, readiness, block, reconnect and host framework. Solo checkpoints stay separate. The server owns every encounter, enemy, combat timer, reward and outcome.

## Campaign

Each district contains an opening patrol, a shared route choice, a rest/event room, an elite/challenge/environment encounter, and a major boss. Players vote for combat, elite or treasure branches; connected players' majority wins when everyone votes or after thirty seconds. Seeded tie breaking is deterministic. Another player's vote and the future seed/rooms remain private.

Four enemy identities chase, shoot, strike delayed circles or fire spread projectiles. Environmental rooms require surviving twenty-eight seconds of telegraphed lanes. Eight bosses use the shared content identities and twelve additional signature patterns beyond the original four. Arena geometry supplies cover, conveyors, heat and slowing zones; projectiles cannot pass through cover. Phase changes, recovery openings and position-locked pressure discourage stationary corner play. Scaling uses the expedition's participant count.

Clears grant personal expedition shards and a damage, armor, tempo or companion upgrade. Stacks are bounded at four, with diminishing damage/tempo returns. Nobody can choose for another account or claim a room twice. Shops charge eighteen shards per upgrade. New shard grants stop at 250 while preserving larger legacy balances. Shards cannot be exchanged for platform or casino currency.

NPC bargains, curses and secrets are deliberately shared and voted; mechanical rewards belong to each retained account. Eliminated spectators cannot vote. Ties use seeded encounter identity. An accepted archivist bargain carries one party key and replaces the next event junction with a relay. Opening it consumes the key, records `restored-relay`, and grants each retained teammate Prism plus extended refraction chains. Three refused bargains instead reveal `pilgrims-refuge`, personal mercy recovery and healing. Glass confidence is a shared risk decision granting personal modifiers: 25% more dealt and 20% more incoming damage. Flags, votes, discoveries, consumed objects and ownership remain canonical across reconnect.

Helper stops grant each account one companion choice per room. Gunner damage belongs to its owner; a medic heals only its owner for four health every five seconds. Enemy projectiles can damage companions. Kind, health, cooldown, upgrade level and chosen-room marker survive reconnect. Shops remain individual purchases and ordinary upgrades remain individual once-only claims. Voluntary departures exclude an account from later shared event grants and victory.

Between rooms, connected teammates continue together, or the server moves on after forty-five seconds (sixty at a rest stop). Boss checkpoints restore eliminated teammates at sixty percent maximum health, halve their shards and refresh their rescue allowance. Voluntary departures remain eliminated and are excluded from victory. Clearing all forty server encounters produces the canonical team win; no browser completion claim is accepted. A two-hour active expedition limit bounds runs. Forty rooms are implemented, but 45–60-minute pacing and cooperative balance are not yet measured.

## Controls and revives

WASD/arrows or touch move; Shift dashes; mouse/Space or sustained fire shoots; Q/right mouse uses an alternate. Controller inputs and host audio preferences work. Lance has directional reach; Prism chains. Boomerang returns and hits each target once per pass; a return without a living owner expires. Comet splashes separate nearby targets. The relay's refraction modifier extends Prism chains. Physical projectiles collide with cover.

At zero health, a player becomes downed for thirty seconds. A living teammate within seventy world units holds E for two uninterrupted seconds to restore forty-five health. Each player can receive two rescues per boss checkpoint. An expired or exhausted rescue makes the player a spectator until the next boss checkpoint. The team loses when nobody remains standing. The classic gauntlet keeps four bosses, twelve-second intermissions and its fifteen-minute limit.

## Durable recovery and trust

Strict input schemas accept only increasing sequence numbers, bounded movement/aim and action booleans. Movement uses server time, normalizes diagonals and expires stale input after 400 ms. Clients cannot submit positions, health, damage, enemies, helper state, shards, outcomes or currency. Explicit public views exclude input schedules, another player's sequence, future rooms and private personal upgrades.

Migration 015 stores bounded server-only JSON snapshots and account-to-checkpoint membership in PostgreSQL. Room/status/connection changes save immediately; ordinary active input/ticks save at most once per second. An abrupt crash can roll back up to approximately one second of combat/input. Redis retains active state for quick delivery; missing room/membership keys are rehydrated from SQL. Hidden player views are reconstructed after recovery, including private drawing words and deduction roles in other games.

A per-namespace five-second lease permits one realtime worker to tick and serve actions. Restart waits for the crashed worker's lease to expire. Recovered rooms freeze timers until an authenticated participant rejoins. A campaign also pauses when everyone disconnects. Snapshots expire after twenty-four hours; the database retention cleanup runs at service startup. A separated teammate has a two-minute grace while the others continue. Its expiry eliminates that teammate and transfers host ownership. A voluntary leader departure transfers ownership immediately and lets the remaining team continue. The classic gauntlet retains team-forfeit departure behavior.

Deleted/disabled accounts are pruned before mutations and cannot keep an active Redis lobby stuck on result foreign-key failures. Account erasure invalidates complete SQL snapshots through membership foreign keys and a deletion trigger. Match outcomes persist once in `multiplayer_matches`/`multiplayer_results`, with server damage scores and no platform XP, TellCoins, casino credits or ranked reward.

## Permanent options

Migration 036 stores a per-match/per-account completion receipt. Inside the same outcome/checkpoint transaction, only a canonical forty-room campaign win with the final boss/checkpoint complete grants permanent weapon/helper options, verified secrets, first-boss discovery insight and ten completion insight. Winners are filtered against enabled existing accounts under sorted owner locks. Deleted, disabled and departing accounts receive no grant. Replayed settlement cannot duplicate insight; ranked completion counts stay separate. Receipt summaries/discoveries appear in account export and cascade on deletion. Co-op grants options and insight, without ranked achievements, competitive scores, XP or currency.

## Verification and limits

Rules tests cover both modes, deterministic rooms, scaled enemies, shared votes, private rewards, duplicate rejection, helpers, all forty clears, all twelve added boss signatures, arena collision, bounded movement/dash/projectiles, revives, private views and legacy gauntlet compatibility. Real-process tests on isolated port 3993 kill and restart a worker with Redis retained, then emulate fixture-scoped Redis loss and prove SQL restoration keeps the drawer's word private. They also erase an active fixture account and verify a clean forfeit with valid result rows. Two-account Chromium tests verify real combat, shared choices, personal rewards, reload and leader departure, alongside the original gauntlet flow.

Parity regressions cover seeded event ties, carried/consumed keys, individual modifiers, medic/gunner ownership, frozen reconnects, returning-disc hit deduplication and explosive splash. Three PostgreSQL cases cover concurrent receipt settlement, disabled/departed owners, incomplete/losing/gauntlet/mismatched checkpoints, deletion cascades, zero economic/ranked rewards and later ranked achievement eligibility.

The current shared-worker Chromium pass passed the legacy gauntlet, campaign and new secret-parity cases. The parity case verifies actual initial firing damage, two-account votes, one carried key, its shared consumption, each account's Prism/refraction grant, reload recovery and separately claimed companion upgrades. Its privileged fixture selects an NPC seed and shortens only that fixture room's later encounters; it does not measure an ordinary full co-op completion or pacing. Fixture changes acquire the server's scoped lobby lock and await the expected next room/fight, preventing a tick or pending transition from replacing the test update. The parity report is `.local/verification/ego-coop-parity-browser-4.json` (one pass, zero skips).

Solo protect-relay/movement-beacon encounters, every solo modifier, additional companion identities and rare/trade events are not yet mirrored. Late new-player joins, ranked co-op rewards, multi-worker scaling and network-impairment validation remain. Balance, mobile ergonomics and measured long-run cooperative pacing still need playtesting.

## Longer journey continuation

New normal cooperative campaigns use the same pacing-version-one mission definitions as solo: mixed patrols, ordered courier recovery/delivery, ward surveys, relay escorts and two mission gates for each of three major-boss phases. A disconnected carrier drops at their physical position and must be recovered; stale input cannot hand a connected guide's objective to another player. Missing-flag checkpoints and the classic gauntlet preserve their prior behavior. Shared sustain, carrying movement limits and build limits are described in [journey pacing](EGO_JOURNEY_PACING.md).

Verification passed 27 focused engine tests, three PostgreSQL progression tests and a fresh two-account browser journey case that completes the first mixed patrol and deliveries through ordinary controls without health or objective-state rewrites. Three explicitly compact legacy browser cases also passed. This is objective/reconnect compatibility evidence, not a full human cooperative timing measurement.
