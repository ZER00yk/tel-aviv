# Neon Defense

Server-simulated defense on an 8×5 board with three playable maps, 20-wave campaigns and Endless runs. Choose Solo defense for verified HTTP waves and replays, or Live co-op defense for two to four accounts sharing interactive server combat. The original City Boulevard remains the default for older saves. Canal Switchback changes travel time and building space; Two-Way Crossing splits enemies between two routes. Blue high-ground tiles add 0.6 range and gold power nodes add 15% damage.

## Controls

Choose one of eight tower families and click a non-path tile. Click a placed tower to upgrade, sell or select first, strongest or support-enemy targeting. Send a wave to receive a verified outcome and watch the enemies, health, shields and attacks replay. Skip replay advances the display only. Choose one offered run upgrade every three waves.

Rapid marks targets for stronger sniper hits. Slow combines with Heavy/Splash for extra damage and with Ink for stronger damage over time. Beacons boost damage/range and reveal stealth enemies, with a maximum of four nearby auras. Mint earns cash after waves. Selling returns 60% of purchase and upgrade costs.

Ten enemy roles include runners, armored infantry, shields, medics, splitters, regenerators, jammers and stealth enemies. Boss waves cycle through Iron Ram (enrage), Prism Keeper (regenerating shield), Brood Engine (runner reinforcements) and Overseer (healing, jamming and enrage). The next wave's roster and counterplay are shown before sending it.

## State and trust

Server validates placement, funds, targeting, upgrades, waves and outcomes. The Phaser client renders bounded simulation traces; client-provided scores are never accepted. Campaign clears survive when starting another map. Campaign leaderboards use `default`, `switchback` and `crossroads`; Endless uses its own `endless` category. A failed wave scores only the last wave survived.

Each wave is bounded to 80 initial enemies, 160 total enemies including reinforcements, 1,500 simulation ticks, 800 replay events and 16 position samples per enemy. Any unresolved enemy is counted as a leak. Endless difficulty and enemy counts have caps, and runs stop accepting waves after 10,000 rather than allowing unbounded work.

## Validation and limits

Unit cases cover real route changes, enemy roles, armor/healing/detection, shields, splitters, combinations, targeting, legacy saves, campaign/Endless outcomes and late-wave bounds. Chromium coverage uses actual canvas placement and HTTP actions, verifies split-route replay and separate leaderboard categories, and reloads the saved run.

Solo waves resolve before replay. Live co-op allows build, upgrade, sell and targeting commands during waves; the host sends waves and chooses the map before building. All members share funds and rewards. Everyone disconnecting pauses combat, and rejoining restores the wave from a server checkpoint. An explicit room leave ends an active shared match. Live results are server-owned multiplayer outcomes, separate from the solo ranked leaderboard. See [live authority and recovery](../../docs/NEON_REALTIME.md).

There is no versus mode or map editor. Long-run balance and other browsers/devices still need broader playtesting.
