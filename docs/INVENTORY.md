# Profile inventory and achievement showcase

Settings → Inventory displays the player's TellCoin balance, the three cosmetic shop items, owned equipment, and earned achievements. Neon frame costs 40 TellCoins, Night owl costs 60, and Foundry badge costs 100. Equipping a frame changes the profile avatar border; the equipped title and badge appear beside the profile achievement showcase. Cosmetics give no gameplay advantage.

Purchases continue through the transactional economy handler: the server selects the catalog price, locks the currency account, debits TellCoins into the ledger, and inserts one owned copy. Duplicate purchases and insufficient balances roll back. `COSMETIC_CATALOG` in `packages/platform/src/inventory.ts` is shared by the purchase handler and inventory view.

## Routes

- `GET /api/inventory` returns the current user's TellCoin balance, shop ownership, inventory acquisition dates, equipment, earned achievements, and selected showcase.
- `POST /api/economy/purchase` accepts `{itemId}` and purchases a cosmetic at its server catalog price.
- `POST /api/inventory/equip` accepts `{slot: "frame" | "title" | "badge", itemId: string | null}`. Only owned items matching the selected slot can be equipped; `null` removes that slot.
- `POST /api/inventory/showcase` accepts `{achievementIds: string[]}`. Every selected achievement must already belong to the user. The maximum is five, duplicates are rejected, and selection order is preserved.
- `GET /api/inventory/profile/:userId` returns equipped cosmetics and selected achievements for an authenticated viewer. It excludes currency balances, unequipped inventory, and unrelated settings.

Equipment and showcase selections are stored under server-managed `users.settings.cosmetics` and `users.settings.achievementShowcase`. Updates lock the user row and preserve unrelated settings, including simultaneous ordinary profile edits. The generic profile settings schema rejects these keys, preventing a client from bypassing ownership checks. Public views recheck ownership and earned achievements rather than trusting stored presentation IDs. Disabled accounts and block relationships are excluded. The existing Activity privacy choice hides achievements from other viewers; the owner can still manage their selection. Presentation changes grant no XP, currency, or achievements.

## Validation

`tests/inventory-database.test.ts` contains six opt-in local database tests for purchase races and prices, ownership/slot checks, concurrent settings preservation, earned-only ordered selections, privacy/blocks, and invalid stored state or disabled accounts. `tests/e2e/inventory.spec.ts` buys and equips all three cosmetics, verifies the public profile frame/title/badge and achievement showcase, and checks that Activity privacy hides the showcase. All accounts and seeded balances/achievements belong to isolated test fixtures.

The initial catalog has one cosmetic per equipment slot. Chat cosmetics, banner cosmetics, seasonal cosmetics, inventory trading, and a wider cosmetic catalog remain future work. The current frame applies to the profile avatar; chat and friends-list avatar decorators are not connected yet.
