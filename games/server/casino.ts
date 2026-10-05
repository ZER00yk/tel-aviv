import { GameRuleError } from "./rules";
import { randomInt } from "node:crypto";
import { actPoker, publicPoker, startPoker, type PokerHand } from "./poker";
export interface BlackjackHand {
  bet: number;
  player: number[];
  dealer: number[];
  shoe: number[];
  phase: "playing" | "settled";
  outcome?: string;
  payout?: number;
}
export interface MinesRound {
  bet: number;
  bombs: number;
  mineCells: number[];
  revealed: number[];
  phase: "playing" | "settled";
  outcome?: string;
  payout?: number;
}
export interface CasinoState {
  wins: number;
  rounds: number;
  netWon: number;
  lastResult?: Record<string, unknown>;
  blackjack?: BlackjackHand;
  mines?: MinesRound;
  poker?: PokerHand;
}
export function newCasino(): CasinoState {
  return { wins: 0, rounds: 0, netWon: 0 };
}
export function publicCasino(
  state: CasinoState,
  credits: number,
  rewardAt?: string | null,
) {
  return {
    ...state,
    credits,
    nextRewardAt: rewardAt
      ? new Date(new Date(rewardAt).getTime() + 12 * 3600000).toISOString()
      : null,
    poker: publicPoker(state.poker),
    blackjack: state.blackjack
      ? {
          ...state.blackjack,
          shoe: undefined,
          dealer:
            state.blackjack.phase === "playing"
              ? [state.blackjack.dealer[0], -1]
              : state.blackjack.dealer,
          playerValue: cardValue(state.blackjack.player),
          dealerValue:
            state.blackjack.phase === "playing"
              ? null
              : cardValue(state.blackjack.dealer),
        }
      : undefined,
    mines: state.mines
      ? {
          ...state.mines,
          mineCells:
            state.mines.phase === "playing" ? undefined : state.mines.mineCells,
          multiplier: mineMultiplier(
            state.mines.bombs,
            state.mines.revealed.length,
          ),
        }
      : undefined,
  };
}
export function validateBet(bet: unknown) {
  const amount = Number(bet);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000)
    throw new GameRuleError("Wager 1–100,000 fictional Credits.");
  return amount;
}
export function cardValue(cards: number[]) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    const rank = card % 13;
    if (rank === 0) {
      total += 11;
      aces++;
    } else total += Math.min(10, rank + 1);
  }
  while (total > 21 && aces) {
    total -= 10;
    aces--;
  }
  return total;
}
export function mineMultiplier(bombs: number, count: number) {
  let probability = 1;
  for (let i = 0; i < count; i++) probability *= (25 - bombs - i) / (25 - i);
  return count === 0 ? 1 : Math.min(100, 0.97 / probability);
}
function record(
  state: CasinoState,
  game: string,
  bet: number,
  payout: number,
  detail: Record<string, unknown> = {},
) {
  state.rounds++;
  if (payout > bet) state.wins++;
  state.netWon += payout - bet;
  state.lastResult = { game, bet, payout, profit: payout - bet, ...detail };
  return payout;
}
/** Returns debit/credit separately. The caller commits these and the state together under row locks. */
export function actCasino(
  state: CasinoState,
  action: string,
  payload: Record<string, unknown>,
): { state: CasinoState; debit: number; credit: number } {
  let debit = 0;
  let credit = 0;
  if (action === "state") return { state, debit, credit };
  if (action === "dice") {
    const bet = validateBet(payload.bet);
    const target = Number(payload.target);
    const direction = String(payload.direction ?? "under");
    if (
      !Number.isInteger(target) ||
      target < 2 ||
      target > 98 ||
      !["under", "over"].includes(direction)
    )
      throw new GameRuleError(
        "Choose an integer target from 2 to 98 and under or over.",
      );
    const roll = randomInt(0, 10000) / 100;
    const chance = direction === "under" ? target / 100 : (100 - target) / 100;
    const win = direction === "under" ? roll < target : roll >= target;
    debit = bet;
    credit = record(
      state,
      "dice",
      bet,
      win ? Math.floor((bet * 0.97) / chance) : 0,
      { roll, target, direction, win },
    );
  } else if (action === "roulette") {
    const bet = validateBet(payload.bet);
    const choice = payload.choice;
    const valid =
      (typeof choice === "number" &&
        Number.isInteger(choice) &&
        choice >= 0 &&
        choice <= 36) ||
      ["red", "black", "even", "odd"].includes(String(choice));
    if (!valid)
      throw new GameRuleError(
        "Choose red, black, even, odd, or a number 0–36.",
      );
    const roll = randomInt(0, 37);
    const red = [
      1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
    ].includes(roll);
    const win =
      typeof choice === "number"
        ? choice === roll
        : roll !== 0 &&
          (choice === "red"
            ? red
            : choice === "black"
              ? !red
              : choice === "even"
                ? roll % 2 === 0
                : roll % 2 === 1);
    debit = bet;
    credit = record(
      state,
      "roulette",
      bet,
      win ? bet * (typeof choice === "number" ? 36 : 2) : 0,
      {
        roll,
        color: roll === 0 ? "green" : red ? "red" : "black",
        choice,
        win,
      },
    );
  } else if (action === "blackjack.start") {
    if (state.blackjack?.phase === "playing")
      throw new GameRuleError("Finish your current blackjack hand.");
    const bet = validateBet(payload.bet);
    const shoe = Array.from({ length: 52 }, (_, i) => i);
    for (let i = shoe.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
    }
    const hand: BlackjackHand = {
      bet,
      player: [shoe.pop()!, shoe.pop()!],
      dealer: [shoe.pop()!, shoe.pop()!],
      shoe,
      phase: "playing",
    };
    state.blackjack = hand;
    debit = bet;
    const playerNatural = cardValue(hand.player) === 21;
    const dealerNatural = cardValue(hand.dealer) === 21;
    if (playerNatural || dealerNatural) {
      hand.phase = "settled";
      hand.outcome =
        playerNatural && dealerNatural
          ? "push"
          : playerNatural
            ? "blackjack"
            : "dealer blackjack";
      hand.payout = playerNatural
        ? dealerNatural
          ? bet
          : Math.floor(bet * 2.5)
        : 0;
      credit = record(state, "blackjack", bet, hand.payout, {
        outcome: hand.outcome,
      });
    }
  } else if (action === "blackjack.hit" || action === "blackjack.stand") {
    const hand = state.blackjack;
    if (!hand || hand.phase !== "playing")
      throw new GameRuleError("Start a blackjack hand first.");
    if (action === "blackjack.hit") hand.player.push(hand.shoe.pop()!);
    if (cardValue(hand.player) > 21) {
      hand.outcome = "bust";
      hand.payout = 0;
      hand.phase = "settled";
      credit = record(state, "blackjack", hand.bet, 0, {
        outcome: hand.outcome,
      });
    } else if (action === "blackjack.stand" || cardValue(hand.player) === 21) {
      while (cardValue(hand.dealer) < 17) hand.dealer.push(hand.shoe.pop()!);
      const player = cardValue(hand.player);
      const dealer = cardValue(hand.dealer);
      hand.payout =
        dealer > 21 || player > dealer
          ? hand.bet * 2
          : player === dealer
            ? hand.bet
            : 0;
      hand.outcome =
        hand.payout > hand.bet
          ? "win"
          : hand.payout === hand.bet
            ? "push"
            : "dealer wins";
      hand.phase = "settled";
      credit = record(state, "blackjack", hand.bet, hand.payout, {
        outcome: hand.outcome,
      });
    }
  } else if (action === "mines.start") {
    if (state.mines?.phase === "playing")
      throw new GameRuleError("Cash out or finish your current mines board.");
    const bet = validateBet(payload.bet);
    const bombs = Number(payload.bombs ?? 3);
    if (!Number.isInteger(bombs) || bombs < 1 || bombs > 20)
      throw new GameRuleError("Choose 1–20 mines.");
    const mineCells: number[] = [];
    while (mineCells.length < bombs) {
      const cell = randomInt(0, 25);
      if (!mineCells.includes(cell)) mineCells.push(cell);
    }
    state.mines = { bet, bombs, mineCells, revealed: [], phase: "playing" };
    debit = bet;
  } else if (action === "mines.reveal" || action === "mines.cashout") {
    const mines = state.mines;
    if (!mines || mines.phase !== "playing")
      throw new GameRuleError("Start a mines board first.");
    if (action === "mines.reveal") {
      const cell = Number(payload.cell);
      if (
        !Number.isInteger(cell) ||
        cell < 0 ||
        cell > 24 ||
        mines.revealed.includes(cell)
      )
        throw new GameRuleError("Choose an unrevealed cell from 0 to 24.");
      if (mines.mineCells.includes(cell)) {
        mines.phase = "settled";
        mines.outcome = "mine";
        mines.payout = 0;
        credit = record(state, "mines", mines.bet, 0, { outcome: "mine" });
      } else mines.revealed.push(cell);
    }
    if (
      mines.phase === "playing" &&
      (action === "mines.cashout" || mines.revealed.length === 25 - mines.bombs)
    ) {
      if (!mines.revealed.length)
        throw new GameRuleError("Reveal a safe cell before cashing out.");
      mines.payout = Math.floor(
        mines.bet * mineMultiplier(mines.bombs, mines.revealed.length),
      );
      mines.phase = "settled";
      mines.outcome = "cashout";
      credit = record(state, "mines", mines.bet, mines.payout, {
        outcome: "cashout",
        safeCells: mines.revealed.length,
      });
    }
  } else if (action === "poker.start") {
    if (state.poker?.phase === "playing")
      throw new GameRuleError("Finish your current poker hand.");
    const bet = validateBet(payload.bet);
    state.poker = startPoker(bet);
    debit = bet;
  } else if (action.startsWith("poker.")) {
    if (!state.poker) throw new GameRuleError("Start a poker hand first.");
    const result = actPoker(state.poker, action, payload);
    debit = result.debit;
    credit = result.credit;
    if (state.poker.phase === "settled")
      record(state, "poker", state.poker.playerContribution, credit, {
        outcome: state.poker.outcome,
        pot: state.poker.pot,
      });
  } else if (action === "plinko") {
    const bet = validateBet(payload.bet);
    const path = Array.from({ length: 8 }, () => randomInt(0, 2));
    const slot = path.reduce((total, direction) => total + direction, 0);
    const multiplier = [12, 3, 1.7, 0.4, 0.5, 0.4, 1.7, 3, 12][slot];
    debit = bet;
    credit = record(state, "plinko", bet, Math.floor(bet * multiplier), {
      path,
      slot,
      multiplier,
    });
  } else throw new GameRuleError("Unknown casino action.");
  return { state, debit, credit };
}
