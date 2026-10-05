# Private poker financial settlement

Private Hold'em hands use server-owned chips backed by fictional casino Credits. Wallet balances, buy-ins, chip journals and final returns live in SQL. Client requests supply poker decisions; they never supply wallet payouts or hidden cards.

## Legacy one-hand checkpoints

`syncCasinoPoker(sql,lobby,namespace)` runs inside the realtime store's canonical private checkpoint transaction. The store forces a checkpoint for every poker mutation. Starting a hand checks active accounts, table privacy, bidirectional blocks and the one-active-financial-hand-per-player rule, then locks wallets in user-ID order and reserves every participant's buy-in. The initial private hand checkpoint and all wallet debits commit together. A failed snapshot transaction also rolls back every debit.

A table has two to six seats and a buy-in of 100–10,000 fictional Credits. During betting, each seat's stack plus total contribution equals its buy-in; total contributions equal the pot, and remaining stacks plus pot equal the initial reserve. On a settled hand, final stacks and payout keys must match all original seats and sum to the same initial reserve. Every state revision appends a financial/action journal; stale revisions or changed state under the same revision fail closed.

The engine calculates legal betting, all-in eligibility, side pots, showdown ties and final stacks. Financial settlement pays those final stacks once, journals every nonzero wallet return, marks escrow terminal, and commits the final canonical checkpoint in the same transaction. Repeating the committed final revision returns its terminal status without another payout. Unique wallet-journal keys provide an additional database guard against repeated buy-in or cash-out.

State digests recursively sort object keys while preserving array order, so PostgreSQL JSONB recovery cannot change the identity of an unchanged hand. A same-revision hand with an older digest is accepted only when its original raw digest or exact seat-order payout/score reconstruction matches; that digest is upgraded without a payout or additional journal. Changed values or reordered seat/action/card arrays still fail.

Departed seats remain part of the financial hand until settlement. A fold leaves contributed chips in the pot; an all-in player remains eligible for the pots their contribution covers. An empty table must settle/cancel its financial hand before removing the last canonical snapshot.

## Cancellation, erasure and recovery limits

A server-cancelled hand returns the original buy-ins instead of inventing a winning allocation. Account erasure aborts any active hand and returns remaining participants' original buy-ins before deleting the account. A database trigger protects the same behavior for direct account deletion. A stale live process observes the refunded terminal hand and cannot award it again.

The recovery store retains the private canonical state, including its deck, and reconstructs only authorized player views. A bounded maintenance routine refunds an active hand only after twenty-four hours with no surviving unexpired canonical checkpoint. A reconnectable hand with a valid checkpoint retains its escrow. Expiry selects rows with `FOR UPDATE SKIP LOCKED`; fixtures can scope it to one participant.

## History and privacy

Participant-only history contains the user's own pocket cards, public community cards, public betting actions, buy-in and final wallet return. It never includes deck order. Opponent cards appear in the financial history only after a five-card board and a genuine multi-player showdown. A player winning because everyone else folded keeps their pocket cards private. Generic public profiles and outsiders have no poker history endpoint. Account export reads all the requesting participant's history without the interactive fifty-hand cap.

## Validation

Twelve isolated database tests pass: checkpoint/debit rollback and commit, racing repeated final payout, settled JSONB recovery and legacy digest upgrade, rejected forged chip totals/revisions/identities, whole-table insufficient-funds rollback, private/block/one-active-hand eligibility, cancellation refunds, pocket-card/fold-winner privacy, account-erasure refunds and stale-state protection, scoped orphan expiry, an actual server-engine hand that journals every street and pays its computed showdown, and administrator reset rejection during active escrow followed by an allowed reset after settlement. Existing marketplace and casino database tests also continue to pass.

The separate realtime poker engine/client tests verify betting rules, hidden views and table behavior. The legacy mode returns a completed hand’s stack to the wallet and reserves a fresh buy-in for the next match. Opt-in [persistent tables](PERSISTENT_POKER.md) now retain their seat escrow across hands, use unequal starting stacks and distinct hand journals, and debit only explicit reserve/rebuy operations. Migration 033 leaves the original one-hand schema and behavior intact. Thirteen additional SQL/Redis tests cover persistent conservation and lifecycle behavior. Tournaments, rake, friends/public table discovery and multi-table sessions remain outside this implementation.
