# Ego Trip

Ego Trip has a Phaser casual campaign, private server-simulated co-op, and a separate authoritative ranked solo mode. New casual campaigns span forty rooms and eight districts. Existing twenty-room checkpoints and the original four-boss rush keep their original itinerary.

## Content and combat

Eight major bosses keep stable identities: Rowan, Bennett, Austin, Dakota, Mira, Sol, Inez, and Noa. Each has three normal attack patterns, phase transitions at half health and roughly one fifth health, dialogue, a signature pattern, and a distinct mechanical reward. Position-locked warnings discourage corner camping. A green recovery ring identifies a punishable opening with bonus hit damage. Boss rewards are Orbit breaker, Margin shield, Second wind, Signal companion, Prismatic memory, Heat sink, Unbroken promise, and Open ending.

Arenas change movement and cover: the blueprint has blocking pillars; Austin's express lane moves players along opposing conveyors; Dakota's transmitter court has four pylons; Mira's gallery uses a diamond of mirrors; Sol's furnace grates pulse; Inez's archive combines stacks and slowing loose pages; Noa's arena provides two small refuges. Solid cover blocks player and ordinary projectile movement; warning beams cross cover. Telegraphed circles, lines, and rings remain readable with reduced motion enabled.

Patrols contain six enemy roles: pursuing runners, shooting sentries, beam anchors, strafing weavers, splitting enemies, and ring-emitting bulwarks. Elite and environmental rooms have two waves; survival encounters have three. New waves change enemy composition. Environmental encounters add district-dependent beams or rings. The Redactor and Metronome minibosses retain separate three-pattern cycles.

Seven weapons have actual roles: accurate Pulse pen, short-range Static bloom, directional Margin blade, explosive Pocket comet, a narrow Underline lance with an alternate lunge, a returning Return receipt disc that can hit on each pass, and Prism argument's beam with nearby enemy chains. Alternate attacks work with keyboard, controller, and a touch button. Twenty-three mods cover weapon interactions, movement, defense, companions, recovery openings, and explicit damage tradeoffs. Stacks have finite limits; armor and tempo have diminishing returns. Saturating the entire mod pool never leaves an empty choice screen.

## Routes and secrets

Each district has a patrol/route choice, branching combat or an event, a miniboss, a shop/event junction, and a major boss. Nineteen kinds include battle, elite, miniboss, boss, shop, shrine, helper, treasure, trade, weapon, challenge, secret, environment, survival, NPC, curse, rare, protect-relay and movement trial. Seeded generation preserves placement, route offers, rare encounter rolls, and build rewards across checkpoint loads. A protect relay charges only while defended under enemy pressure, and can be destroyed independently of player health. Movement trials require reaching four ordered beacons across telegraphed lanes; firing cannot complete them. Both objectives survive checkpoint reload.

The archivist offers a carried signal key. Carrying it reveals an abandoned relay at an event junction; consuming it restores the Prism weapon and Prismatic memory. Three refused shrine/NPC/curse bargains reveal the pilgrim's refuge, which grants Held breath and healing. These are visible, stateful route conditions. They are not invisible click targets or random secret buttons. A rare stranded relay offers a key, supplies, or a paid companion with Companion bond. Glass confidence increases damage dealt and taken. All event choices resolve once, and rejected purchases preserve the current state.

New campaign modes are normal, daily UTC seed, custom seed, and endless eight-district cycles. Standard and Volatile difficulties change combat pressure. The classic rush stays four bosses. [140 complete automated runs](../../docs/EGO_PLAYTEST_3.md) measured 2.33–8.14 simulated combat minutes, with a 4.98-minute median. These ordinary-input bot results expose short boss encounters and late upgrade/resource saturation. **The requested 45–60 minute normal human pacing remains unmet as a demonstrated target**; menu decisions, human learning and browser performance were not measured. This pass adds meaningful objectives and bounded resource grants rather than mandatory waiting or HP padding.

## Controls

WASD/arrows move; pointer aims; click/Space attacks; Shift dashes; Q uses the alternate attack. Controller and touch controls provide nearest-enemy aiming. The touch bar includes movement, fire, dash, and alternate attack. Host pause affects casual solo play. Host audio supplies optional procedural combat cues and an ambient theme.

## Casual saves and authoritative progression

The schema-one casual save stores the checkpoint, lifetime runs, best clears, local weapon unlocks, Insight, permanent starting companion/rare-route options, and a discovery journal. Weapons unlock from local boss discoveries and the relay secret. Permanent options add choices rather than base health or damage. The journal clearly describes casual discoveries; it is separate from verified platform achievements.

New fields are optional compatible extensions. A checkpoint without the new campaign length/content version resumes its original twenty rooms and four bosses. Boss-rush saves without a boss count retain four bosses. Old weapons, mods, routes, and progress remain supported. Unsupported versions or damaged saves disable writes and preserve the existing data. Run completion markers prevent repeatedly granting local Insight for restoring a finished checkpoint.

Casual simulation and its namespaced save never mint verified XP, Tell Coins, ranked scores, or platform achievements. The Ranked solo tab uses a separate server-owned simulation and validated durable run records; its progression does not trust casual save edits. See [ranked runs](../../docs/EGO_RANKED.md) and [co-op](../../docs/EGO_COOP.md) for their contracts and limits.

## Validation

Fifty-four solo engine/campaign/flagship/quality tests cover all seven weapons making actual hits and clearing a live target; all eight district bosses in sequence; new boss telegraphs, phases, and openings; cover and conveyors; disc hit deduplication; Prism chains; melee parry; one-use lethal recovery; bounded mod saturation; multiwave rewards; condition-driven secrets; rejected purchase immutability; defended relays and movement beacons; bounded resource grants; old twenty-room endings; new checkpoint round trips; and unsupported-version preservation. Browser tests cover route/save/reload, future-save preservation, a carried key and mechanical relay reward, and the mobile alternate control. A separate ordinary-control ranked Chromium run completed forty rooms/eight bosses in 255.061 wall seconds with valid scheduling, canvas-paint and heap samples; the full method and limitations appear in [the measurement report](../../docs/EGO_PLAYTEST_3.md).

The fully authored completionist target, additional NPC dialogue trees, polished art/animations/sound assets, measured full-run pacing, and extensive human balance testing remain partial.
