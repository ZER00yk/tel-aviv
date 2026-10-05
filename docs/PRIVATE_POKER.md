# Private multiplayer Hold'em

Velvet Casino's **Private poker** tab hosts server-authoritative Texas Hold'em for two to six invited accounts. Legacy one-hand mode remains the default; hosts can opt into [persistent private tables](PERSISTENT_POKER.md) with chosen per-seat reserves, retained stacks, sit-out, rebuy and multiple hands in the same room. The existing heads-up house-bot Poker tab remains available separately. Credits are fictional and have no cash value.

Create a private room, share its code, choose a 100–10,000 Credit buy-in and have every participant mark Ready. Readiness authorizes the displayed buy-in; changing it clears everyone’s readiness. The host starts only when all seats are connected and ready. Wallets reserve every seat’s buy-in in the same SQL transaction that saves the initial private hand. An unaffordable seat rolls back the entire start.

## Rules and controls

The button rotates when the same room starts another hand. Blinds are 5/10. Heads-up, the button posts the small blind and acts first preflop; the other seat acts first after the flop. Three or more seats use the ordinary clockwise blind/action order. Cards use a server cryptographic shuffle; the server deals pocket cards, burns cards, then deals flop, turn and river.

Legal controls are Fold, Check, Call, Raise to a street total and All-in. The server validates turn order, available chips, minimum full raises and raising rights. A short all-in does not reopen an earlier actor until cumulative short raises reach the last full-raise increment. The big blind retains its option after limps. When no further betting is possible the server runs out the board and evaluates the seven-card hands.

Contributions form layered pots. Folded chips remain in those pots; only nonfolded seats whose contribution reaches a layer can win it. Ties split each pot and odd chips go clockwise from the button. Final seat stacks conserve the original reserved total. In default legacy mode, every seat begins each match with the same chosen buy-in. Persistent private mode uses each seat’s retained or explicitly reserved starting stack.

Each turn allows thirty seconds. An expired turn checks when no chips are owed, otherwise it folds. Pausing or backgrounding the browser does not pause the table clock. Leaving folds an active seat; a seat already all-in stays eligible for its pots. Departed seats remain in the server hand until their wallet return commits. Leader departure transfers room controls to a remaining member.

## Privacy, settlement and recovery

The client receives only its own pocket cards while betting. Deck order, internal action-tracking state and other pockets are excluded from every response. A five-card multi-player showdown reveals nonfolded hands. Winning because everyone else folded keeps the winner’s pocket private, including on the river. In legacy mode, new entrants after a finished hand see the waiting room and receive no previous participant’s hand state. Persistent room members outside a deal receive only its public view with masked pockets until a genuine showdown.

In the default legacy mode, each match is one hand. Its final stacks return to the wallet exactly once, atomically with the final canonical checkpoint and match result. Another match reserves a new buy-in and rotates the button. The casino shows currently held Credits and participant-only hand history, including the participant’s own cards, public board and final return. History never includes the deck.

Every accepted poker mutation saves immediately to SQL, including waiting-room readiness and buy-in consent. Poker reads the SQL checkpoint as canonical even when an older Redis room still exists. This covers a process crash after SQL commits and before Redis updates; an unlocked read never overwrites a newer concurrent cache write. Reload/reconnect restores the existing authenticated participant’s private view without dealing again or reserving the stakes twice. Recovered turn clocks resume after an authenticated participant returns. Account erasure aborts an active hand and refunds the remaining players; stale Redis state cannot award a refunded hand again. In legacy mode, removing or disabling a participant after settlement prunes room membership and preserves the paid outcome. In persistent mode, account removal closes the table and returns the remaining retained stacks while preserving previously settled hands.

See [the financial contract](CASINO_POKER_ECONOMY.md) for escrow invariants, locks, journals and twenty-four-hour orphan cleanup, and [the realtime contract](REALTIME.md) for namespace leases and recovery limits.

## Validation and remaining scope

`games/casino/multiplayer-poker.test.ts` covers private dealing, blinds, illegal and forged actions, street progression, all-ins, layered/tied pots, odd chips, fold-winner privacy, timeouts, departed all-ins, JSON restoration and cumulative short-raise reopening. Dedicated SQL tests exercise atomic checkpoint/debit rollback, concurrent payout, conservation, blocks, active-hand exclusivity, cancellation, account erasure, expiry and an actual engine hand through every street.

`apps/realtime/src/recovery.integration.test.ts` starts an isolated realtime process on port 3993. Poker cases exercise an unaffordable start, recovery from a legitimate older Redis revision both live and after SIGKILL, another SIGKILL with scoped Redis loss, identical recovered own cards, hidden opponent cards, a real all-in showdown, duplicate payout prevention, new-entrant privacy, account-deletion refunds, and account erasure/disable after settlement. The browser case in `tests/e2e/private-poker.spec.ts` covers real separate-account controls, reload, readiness reset, fold privacy, dealer rotation, showdown and durable participant history.

Public poker matchmaking, friends/public discovery, tournaments, table spectators, rake and competitive poker rankings are not implemented. Persistent private mode now supports retained stacks and variable per-seat buy-ins; its financial and gameplay limits are documented in [Persistent poker](PERSISTENT_POKER.md). Private room-code invitations check active accounts and bidirectional blocks; they do not require a pre-existing friendship. The runtime uses one exclusive worker per environment namespace, not a proven multi-node table scheduler.
