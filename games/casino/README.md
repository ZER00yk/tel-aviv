# Velvet Casino

Server-generated blackjack, heads-up Texas Hold'em against the house bot, private multiplayer Hold'em for two to six accounts, Plinko, dice, roulette, and mines. Fictional Credits have a durable server ledger, a periodic allowance, and transactional player transfers. The casino also includes fictional loans, finite numbered collectibles, gifts, and a player marketplace.

## Controls

Select a minigame, set a fictional Credits wager, and use its action controls. Blackjack Hit/Stand finish the hand; Mines requires at least one safe reveal before cashout. Poker deals preflop, flop, turn, and river with Check/Call/Raise/Fold decisions. Plinko displays the eight server-generated bounces and resulting slot.

The Loans tab allows a 100–1,000 Credit loan once per 24 hours, with one outstanding loan at a time. Interest is 1% of principal per elapsed server day, rounded down and capped at the original principal. Repayment settles the whole amount. The Collection tab sells finite editions, displays copy serials, sends copies to another active username, and lists owned copies for sale. Listed copies must be cancelled before gifting. The Marketplace tab refreshes active listings and commits payment and copy ownership in one transaction.

## State and trust

Credits, cards, concealed dealer/house hands, mine locations, Plinko paths, round state, loans, edition issuance, transfers, and listings live on the server. Generic client save writes are denied. Starting stakes and decisions debit real server balances, even when a winning payout could cover the stake. Server locks prevent duplicate issuance, loan races, repeated rewards, and double sales. Failed purchases roll back the payment, listing status, and ownership together. Blocked players cannot transfer Credits or collectibles to each other or settle each other's marketplace listings.

Validation: `tests/casino.test.ts` covers hand ranking, secret-state filtering, street progression, illegal decisions, one-time settlement, server Plinko payout derivation, and interest limits. `tests/casino-database.test.ts` runs only with `RUN_DB_TESTS=true` and covers loan races and cooldown, edition races, marketplace race/conservation, owner/block checks, gifts, and rollback on insufficient funds. Its stock and accounts are isolated fixtures.

`tests/e2e/casino-economy.spec.ts` verifies the poker, Plinko, loan repayment/cooldown controls and a two-player marketplace purchase followed by a collectible gift in Chromium. Its numbered editions use isolated fixture stock and do not consume the shared shop supply.

## Remaining scope

The currency is fictional and has no cash value. The Private poker tab supports room-code invitations, ready-consented equal buy-ins, rotating blinds, legal betting, all-ins, layered side pots, private pocket views, one-time wallet settlement, participant hand history and SQL-backed reconnect/process recovery. Each match is one hand; it cashes out before another buy-in. See [the private table contract](../../docs/PRIVATE_POKER.md) and [financial settlement](../../docs/CASINO_POKER_ECONOMY.md). Public poker queues, tournaments, continuous table bankrolls, spectators and poker rankings remain outside this implementation. Offers, barter and safe market refresh are described below.

## Offers and barter update

The Offers tab now reserves up to five numbered copies and offered fictional Credits, requests editions and/or Credits, and supports incoming/outgoing accept, reject, cancel, and expiration. Recipients choose their own matching copies. Settlement exchanges both sets of copies and journaled Credits atomically; concurrent acceptance cannot duplicate ownership or payment. Reserved copies cannot be gifted or listed. Participant gift, sale and barter history is available in the same tab.

Market mutations have user-scoped operation-ID retries. Post-commit refresh signals contain no private data; the client recovers missed updates on reconnect/focus or visible-tab polling. The maintenance worker releases expired escrow, and recipient deletion refunds the sender. See [the marketplace contract](../../docs/CASINO_MARKETPLACE.md) for limits, cleanup and validation.
