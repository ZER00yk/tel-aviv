# Casino offers, barter, and escrow

Velvet Casino's marketplace uses fictional Credits and numbered collectibles. Listings, direct gifts, targeted offers and barter settle on the server. There is no purchasing with real money, cash-out, cryptocurrency, or real-world value.

The Offers tab builds a proposal without browsing another player's private collection. The sender chooses up to five owned copies, offered Credits, requested Credits, and up to five requested collectible editions/copies in total. The recipient chooses their own matching numbered copies when accepting. The UI separates incoming and outgoing offers, supports accept/reject/cancel, shows reserved copies, and displays private gift/sale/barter history.

## Reservation and settlement

Creating an offer debits its offered Credits into escrow and records that debit in the currency ledger. A separate reservation row locks each offered numbered copy while ownership remains with the sender. Reserved copies cannot be gifted, listed, purchased through an old listing, or used in another offer. Creation refuses already-listed copies, duplicate copies, unowned copies, unknown requested editions and invalid participants.

Acceptance locks the offer, all participating collectible rows in ID order, then both currency accounts in user ID order. It rechecks participants, current blocks, active sender, matching editions, ownership, reservation, expiry and recipient funds. Only then does it debit requested Credits, pay escrow to the recipient, pay the sender, exchange both sets of copies, remove reservations, and write a completed trade record. All changes commit together. Failed acceptance preserves the pending offer, balances and ownership.

Rejecting or cancelling returns escrow and releases copies. A passed deadline never settles the proposed trade; resolving it releases it as expired. The maintenance worker calls `expireCasinoOffers` in bounded batches and skips rows currently being resolved. Refunds remain possible when later earnings fill the normal spending limit: a refund restores previously debited Credits rather than issuing new Credits.

Account deletion cancels owned pending offers before erasure. A defensive database trigger also refunds another sender's escrow if its recipient is deleted directly. Historical gift/trade records are visible only to their participating accounts; counterpart usernames and item serials remain historical transaction snapshots when an account disappears. They contain no email, OAuth identifiers, session credentials, hidden card state, or private collection inventory.

## API and retries

The existing server game-action endpoint dispatches these commands:

| Action                     | Payload                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `marketplace.offer.create` | `operationId`, `username`, `copyIds`, `offeredCredits`, `requestedCredits`, `requestedItems: [{itemId,count}]`, `expiresInHours` |
| `marketplace.offer.accept` | `operationId`, `offerId`, `copyIds` selected from the recipient's matching unreserved collection                                 |
| `marketplace.offer.reject` | `operationId`, `offerId`                                                                                                         |
| `marketplace.offer.cancel` | `operationId`, `offerId`                                                                                                         |

New offer commands require a UUID operation ID. User-scoped operation records bind that ID to exact action/payload details and retain the committed result. Retrying the same operation returns that result without another debit or ownership mutation. Reusing an ID with changed terms returns a conflict. Existing gift/list/buy/cancel actions also support an optional operation ID; their old payloads remain compatible. The browser retains failed operation IDs for retries after a response is lost.

Offers expire after 1–72 server hours. Offered/requested Credits are bounded at 100,000 per side. At most twenty outgoing offers remain pending, and successful creation is limited to ten per minute per account. Interactive views include the newest hundred participant offers/history rows. Account export uses the full participant record set.

## Updates and maintenance

Successful market/collectible actions publish a server-generated `casino:market:changed` refresh signal after commit. Realtime sends a fixed `{refresh:true}` payload to authenticated, freshly validated sessions; clients re-fetch their own filtered view. No offer, inventory, balance, or hidden game data is broadcast. Reconnect, visibility/focus refresh and fifteen-second polling recover missed signals while a marketplace/collection/offers tab is visible. Redis interruption does not affect SQL settlement.

The scheduled ops worker expires offers and emits a refresh after committed expiration. A one-shot cleanup is available with:

```sh
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/marketplace-cleanup.ts
```

The one-shot command relies on the normal next refresh/poll for UI updates and exits without retaining a Redis publisher connection.

## Validation and limits

Ten dedicated database tests and five existing casino database tests pass. They cover both-sided barter and ledger conservation, racing accept/cancel, retry deduplication/conflicts, participant/ownership checks, listing/gift reservation locks, mismatched and unaffordable rollback, new blocks, racing expiry workers, deletion refunds, and existing gift/listing retries. Three casino browser cases pass, including real two-player barter controls, changed balances, exchanged serials, and private history.

The separate [private multiplayer poker mode](PRIVATE_POKER.md) now supports two to six invited accounts, ready-consented stakes, rotating blinds, legal betting/all-ins, layered side pots, private views, table recovery and participant hand history. Its [financial contract](CASINO_POKER_ECONOMY.md) reserves and returns Credits atomically with canonical checkpoints. The heads-up house-bot game remains available. Public poker queues, tournaments and persistent table bankrolls are outside that mode.
