# Paper Odyssey

A server-run twelve-floor deckbuilder with **44 base cards**, three character loadouts and passives, ten relics, six choice events, six ordinary enemies, two elite enemies, and three different guardians. The original eighteen card IDs and eight-card starting decks remain available.

## Build and combat

Read the next enemy intent before ending your turn. Intent displays actual damage after weak/vulnerable modifiers, hit count, guarding, strength, status effects, and ink cleansing. Block absorbs each hit; ink ticks before the enemy acts, then decays by one. Guarding creates enemy block for your next turn. Enemy attack patterns differ; the Final Index strengthens future attacks below half health.

The new cards support several interacting builds:

- **Attack:** strength scales each Cross-reference hit, vulnerable rewards sequencing, and Running commentary scales with cards played that turn. Striker adds two damage to the first hit of the first attack each turn.
- **Defense:** dexterity improves block cards; Permanent edition carries unspent block; Weight of evidence spends it as an attack. Firm boundaries grants block per later attack card. Warden starts with 75 health and adds two block to the first block card each turn.
- **Ink:** Bottomless inkwell adds ink from later non-attacks; Spreading blot multiplies existing stacks; Waterproof margins turns stacks into block; Blotting paper consumes them for burst damage. Spark adds one ink to the first card that increases ink each turn.
- **Exhaust:** Recycled pages and Ashen cover trigger on each exhausted card, including themselves. Kindling and A ruthless revision exhaust the leftmost remaining card; Redaction and Out of the archive scale with the exhausted count. Exhaust only removes a card for this battle; the permanent deck is preserved.

Hand size is ten. Combat powers and exhausted cards reset between battles. Save your place grants energy for the next turn only. Paying health requires enough health to survive the cost.

## Routes and progression

New expeditions must face the Glass Archivist on floor 4, Clockwork Editor on floor 8, and Final Index on floor 12. Other floors offer battles, elites, reading rooms, bookstalls, and choice events. Elites and the first two guardians award a random unowned relic. Relics have visible descriptions and actual combat/economy effects.

Reading rooms offer either 30% maximum-health recovery or one card upgrade. Each card can be upgraded once; upgraded IDs use `original+` and retain the original string-based save format. Upgrades improve a card's damage, block, ink, draw, healing, energy, or effect; power cards usually cost less. Bookstalls sell offered cards for 45 gold and remove a selected deck card for 55 gold, increasing by 15 after each shop removal. Keep at least five cards. Leaving a bookstall clears its offers.

Events show their choices, costs, and outcomes. Some trade health or gold for relics, strengthen the binding, upgrade/remove a chosen card, or add a build card. Unaffordable choices are disabled and rechecked by the server. A resolved event cannot be replayed.

## Saves, daily runs, and trust

Run RNG, combat, routes, offers, and final scores live on the server. Future draw/discard order, RNG state, and enemy pattern tables are withheld. Daily expeditions use the existing UTC-date seed; equal character/action sequences reproduce draws, events, offers, and relics. Run IDs remain unique and stable throughout each expedition.

Existing first-pass saves hydrate missing combat fields without resetting their run ID, cards, health, or progress. They keep their original route options, automatic rest/event behavior, and enemy attack cycle. A newly started expedition uses the expanded route and guardian rules. The original three relic IDs still apply their effects.

## Validation and boundaries

Rules tests cover all card upgrades, multihit/status math, defense/ink/exhaust synergies, real enemy guarding/actions, relic effects, costs, replay rejection, deterministic daily content, legacy saves, and an entire prepared-build expedition through all three guardians. A browser test starts a daily Warden run, upgrades a card, resolves a choice event, reaches the Glass Archivist, plays a card, and checks persistence after reload.

This is a meaningful content expansion, with text-based card presentation. It does not provide card art, character-exclusive catalogs, or a hundred-card collection. Long-run balance across all random routes/builds still needs playtesting.
