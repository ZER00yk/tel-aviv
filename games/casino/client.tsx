"use client";
import { useEffect, useRef, useState } from "react";
import { useGameState, getGameSocket } from "@tell-aviv/game-runtime";
import type { GameSDK } from "@tell-aviv/game-sdk";
import { PrivatePokerClient, type PokerHandHistory } from "./poker-client";
import { MarketplaceOffers, type CasinoOffersState } from "./marketplace";
interface Loan {
  principal: number;
  interest: number;
  total: number;
  nextBorrowAt: string | null;
}
interface CollectibleDefinition {
  itemId: string;
  name?: string;
  icon?: string;
  description?: string;
  price: number;
  supply: number;
  issued: number;
}
interface OwnedCollectible {
  id: string;
  itemId: string;
  serial: number;
  acquiredAt: string;
  listingId: string | null;
  price: number | null;
  reservationOfferId: string | null;
}
interface MarketplaceListing {
  id: string;
  price: number;
  sellerId: string;
  sellerUsername: string;
  itemId: string;
  serial: number;
  createdAt: string;
}
interface State extends CasinoOffersState {
  pokerHands?: PokerHandHistory[];
  pokerEscrowCredits?: number;
  loan: Loan;
  collectibleShop: CollectibleDefinition[];
  collectibles: OwnedCollectible[];
  marketplace: MarketplaceListing[];
  credits: number;
  wins: number;
  rounds: number;
  netWon: number;
  lastResult?: Record<string, unknown>;
  poker?: {
    phase: string;
    street: string;
    playerCards: number[];
    botCards: number[];
    community: number[];
    pot: number;
    toCall: number;
    baseBet: number;
    playerContribution: number;
    botContribution: number;
    outcome?: string;
    log: string[];
  };
  blackjack?: {
    player: unknown[];
    dealer: unknown[];
    phase: string;
    outcome?: string;
    playerValue?: number;
    dealerValue?: number;
    bet: number;
  };
  mines?: {
    revealed: number[];
    bombs: number;
    bet: number;
    phase: string;
    outcome?: string;
    mineCells?: number[];
    multiplier?: number;
  };
}
const describe = (value: unknown) =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : JSON.stringify(value);
export default function Casino({
  sdk,
  paused,
}: {
  sdk: GameSDK;
  paused: boolean;
}) {
  const { state, error, busy, action } = useGameState<State>(sdk);
  const [tab, setTab] = useState("blackjack"),
    [bet, setBet] = useState(10),
    [target, setTarget] = useState(50),
    [direction, setDirection] = useState("under"),
    [choice, setChoice] = useState("red"),
    [bombs, setBombs] = useState(3),
    [recipient, setRecipient] = useState(""),
    [raise, setRaise] = useState(20),
    [loanAmount, setLoanAmount] = useState(500),
    [salePrice, setSalePrice] = useState(200);
  const live = useRef({ busy, paused, tab });
  live.current = { busy, paused, tab };
  const pendingOperations = useRef(new Map<string, string>());
  const marketAction = async (
    name: string,
    details: Record<string, unknown> = {},
  ) => {
    const digest = JSON.stringify({ name, details });
    if (!pendingOperations.current.has(digest)) {
      if (pendingOperations.current.size >= 24)
        pendingOperations.current.delete(
          pendingOperations.current.keys().next().value!,
        );
      pendingOperations.current.set(digest, crypto.randomUUID());
    }
    const result = await action(name, {
      ...details,
      operationId: pendingOperations.current.get(digest)!,
    });
    if (result) pendingOperations.current.delete(digest);
    return result;
  };
  useEffect(() => {
    const socket = getGameSocket();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (
        !live.current.busy &&
        !live.current.paused &&
        !document.hidden &&
        ["collection", "marketplace", "offers"].includes(live.current.tab)
      ) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!live.current.busy && !live.current.paused) void action("state");
        }, 250);
      }
    };
    socket.on("casino:market:changed", refresh);
    socket.on("connect", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = setInterval(refresh, 15000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      socket.off("casino:market:changed", refresh);
      socket.off("connect", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [action]);
  if (!state) return <p>{error || "Entering the casino…"}</p>;
  const disabled = busy || paused;
  return (
    <div>
      <div className="game-stats">
        <div className="game-stat">
          <small>Fictional Credits</small>
          <strong>{Math.floor(state.credits).toLocaleString()}</strong>
        </div>
        <div className="game-stat">
          <small>Wins / rounds</small>
          <strong>
            {state.wins} / {state.rounds}
          </strong>
        </div>
        <div className="game-stat">
          <small>Lifetime game profit</small>
          <strong>
            {state.netWon > 0 ? "+" : ""}
            {state.netWon.toLocaleString()}
          </strong>
        </div>
      </div>
      <p className="game-hint">
        Fictional money only. No deposits, purchases, or cash value. Cards,
        rolls, mines, and balances come from the server.
      </p>
      <div className="game-tabs">
        {[
          "blackjack",
          "poker",
          "private poker",
          "plinko",
          "dice",
          "roulette",
          "mines",
          "friends",
          "loans",
          "collection",
          "marketplace",
          "offers",
        ].map((mode) => (
          <button
            key={mode}
            className={tab === mode ? "selected" : ""}
            onClick={() => setTab(mode)}
          >
            {mode[0].toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>
      {!["loans", "collection", "marketplace", "offers", "private poker"].includes(tab) && (
        <label className="game-row">
          Bet{" "}
          <input
            aria-label="Bet in fictional Credits"
            type="number"
            min={1}
            max={100000}
            value={bet}
            onChange={(e) => setBet(Number(e.target.value))}
          />
        </label>
      )}
      {tab === "private poker" && (
        <PrivatePokerClient
          sdk={sdk}
          paused={paused}
          history={state.pokerHands}
          escrowCredits={state.pokerEscrowCredits}
          onBalanceChange={() => {
            void action("state");
          }}
        />
      )}
      {tab === "blackjack" && (
        <section className="game-card">
          <h3>Blackjack · reach 21 without going over</h3>
          {state.blackjack && (
            <>
              <p>Dealer</p>
              <div className="game-row">
                {state.blackjack.dealer.map((card, index) => (
                  <Card key={index} value={card} />
                ))}
              </div>
              <p>
                Your hand{" "}
                {state.blackjack.playerValue !== undefined &&
                  `· ${state.blackjack.playerValue}`}
              </p>
              <div className="game-row">
                {state.blackjack.player.map((card, index) => (
                  <Card key={index} value={card} />
                ))}
              </div>
              <p className="positive">
                {state.blackjack.outcome ?? state.blackjack.phase}
              </p>
            </>
          )}
          <div className="game-row">
            <button
              disabled={disabled || state.blackjack?.phase === "playing"}
              onClick={() => void action("blackjack.start", { bet })}
            >
              Deal hand
            </button>
            <button
              disabled={
                disabled ||
                !state.blackjack ||
                state.blackjack.phase !== "playing"
              }
              onClick={() => void action("blackjack.hit")}
            >
              Hit
            </button>
            <button
              disabled={
                disabled ||
                !state.blackjack ||
                state.blackjack.phase !== "playing"
              }
              onClick={() => void action("blackjack.stand")}
            >
              Stand
            </button>
          </div>
        </section>
      )}
      {tab === "poker" && (
        <section className="game-card">
          <h3>Heads-up poker · the house bot</h3>
          <p className="game-hint">
            Make betting decisions through preflop, flop, turn, and river.
            Server deals hidden cards and evaluates the best five-card hand.
          </p>
          {state.poker && (
            <>
              <p>House hand</p>
              <div className="game-row">
                {state.poker.botCards.map((card, index) => (
                  <Card key={index} value={card} />
                ))}
              </div>
              <p>
                Community · {state.poker.street} · pot {state.poker.pot} Credits
              </p>
              <div className="game-row">
                {state.poker.community.map((card, index) => (
                  <Card key={index} value={card} />
                ))}
              </div>
              <p>Your hand · call {state.poker.toCall} Credits</p>
              <div className="game-row">
                {state.poker.playerCards.map((card, index) => (
                  <Card key={index} value={card} />
                ))}
              </div>
              <p className="positive">
                {state.poker.outcome ?? state.poker.phase}
              </p>
              <div className="game-log">
                {state.poker.log.map((line, index) => (
                  <div key={index}>{line}</div>
                ))}
              </div>
            </>
          )}
          <div className="game-row">
            <button
              disabled={disabled || state.poker?.phase === "playing"}
              onClick={() => void action("poker.start", { bet })}
            >
              New hand
            </button>
            <button
              disabled={
                disabled ||
                state.poker?.phase !== "playing" ||
                (state.poker?.toCall ?? 1) > 0
              }
              onClick={() => void action("poker.check")}
            >
              Check
            </button>
            <button
              disabled={
                disabled ||
                state.poker?.phase !== "playing" ||
                !state.poker?.toCall
              }
              onClick={() => void action("poker.call")}
            >
              Call
            </button>
            <button
              disabled={disabled || state.poker?.phase !== "playing"}
              onClick={() => void action("poker.fold")}
            >
              Fold
            </button>
            <input
              aria-label="Raise contribution"
              type="number"
              min={1}
              value={raise}
              onChange={(e) => setRaise(Number(e.target.value))}
              style={{ width: 110 }}
            />
            <button
              disabled={disabled || state.poker?.phase !== "playing"}
              onClick={() => void action("poker.raise", { amount: raise })}
            >
              Raise
            </button>
          </div>
          <p className="game-hint">
            Raise specifies your additional contribution and must cover the call
            plus the opening bet. Multiplayer poker tables remain a later
            addition.
          </p>
        </section>
      )}
      {tab === "plinko" && (
        <section className="game-card">
          <h3>Plinko · follow the fall</h3>
          <p>
            Drop through eight rows of pegs. Each server-generated left/right
            bounce determines a slot and payout.
          </p>
          <Plinko result={state.lastResult} />
          <button
            disabled={disabled}
            onClick={() => void action("plinko", { bet })}
          >
            Drop ball
          </button>
        </section>
      )}
      {tab === "dice" && (
        <section className="game-card">
          <h3>Percentile dice</h3>
          <p>
            Choose a target. Harder predictions pay more. Under wins below the
            target; over wins on or above it.
          </p>
          <div className="game-row">
            <select
              aria-label="Prediction direction"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="under">Roll under</option>
              <option value="over">Roll over</option>
            </select>
            <input
              aria-label="Dice target"
              type="number"
              min={2}
              max={98}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
            <button
              disabled={disabled}
              onClick={() => void action("dice", { bet, target, direction })}
            >
              Roll
            </button>
          </div>
        </section>
      )}
      {tab === "roulette" && (
        <section className="game-card">
          <h3>Roulette</h3>
          <div className="game-row">
            <select
              aria-label="Roulette prediction"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
            >
              {[
                "red",
                "black",
                "even",
                "odd",
                ...Array.from({ length: 37 }, (_, i) => String(i)),
              ].map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
            <button
              disabled={disabled}
              onClick={() =>
                void action("roulette", {
                  bet,
                  choice: ["red", "black", "even", "odd"].includes(choice)
                    ? choice
                    : Number(choice),
                })
              }
            >
              Spin
            </button>
          </div>
        </section>
      )}
      {tab === "mines" && (
        <section className="game-card">
          <h3>Mines · stop while you are ahead</h3>
          <div className="game-row">
            <label>
              Bombs{" "}
              <input
                aria-label="Mine count"
                type="number"
                min={1}
                max={20}
                value={bombs}
                onChange={(e) => setBombs(Number(e.target.value))}
              />
            </label>
            <button
              disabled={disabled || state.mines?.phase === "playing"}
              onClick={() => void action("mines.start", { bet, bombs })}
            >
              New board
            </button>
            <button
              disabled={
                disabled || !state.mines || state.mines.phase !== "playing"
              }
              onClick={() => void action("mines.cashout")}
            >
              Cash out
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5,1fr)",
              gap: 8,
              maxWidth: 400,
            }}
          >
            {Array.from({ length: 25 }, (_, cell) => (
              <button
                aria-label={`Reveal tile ${cell + 1}`}
                style={{ height: 54, fontSize: 24 }}
                key={cell}
                disabled={
                  disabled ||
                  !state.mines ||
                  state.mines.phase !== "playing" ||
                  state.mines.revealed.includes(cell)
                }
                onClick={() => void action("mines.reveal", { cell })}
              >
                {state.mines?.revealed.includes(cell) ? "♦" : "·"}
              </button>
            ))}
          </div>
          {state.mines && (
            <p>
              {state.mines.phase} · {state.mines.revealed.length} safe tiles
            </p>
          )}
        </section>
      )}
      {tab === "friends" && (
        <section className="game-card">
          <h3>A little generosity</h3>
          <p>
            Send fictional Credits to another player. Transfers are recorded in
            the server ledger.
          </p>
          <div className="game-row">
            <input
              aria-label="Recipient username"
              placeholder="Username"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
            <button
              disabled={disabled}
              onClick={() =>
                void action("transfer", { username: recipient, amount: bet })
              }
            >
              Send {bet} Credits
            </button>
            <button disabled={disabled} onClick={() => void action("reward")}>
              Claim periodic allowance
            </button>
          </div>
        </section>
      )}
      {tab === "loans" && (
        <section className="game-card">
          <h3>Fictional credit loans</h3>
          <p>
            Borrow 100–1,000 Credits. One loan per 24 hours, with one
            outstanding loan at a time. Interest accrues at 1% of the principal
            per elapsed server day, rounded down and capped at the principal.
            Repayment settles the whole amount.
          </p>
          <div className="game-stats">
            <div className="game-stat">
              <small>Principal</small>
              <strong>{state.loan.principal}</strong>
            </div>
            <div className="game-stat">
              <small>Accrued interest</small>
              <strong>{state.loan.interest}</strong>
            </div>
            <div className="game-stat">
              <small>Total repayment</small>
              <strong>{state.loan.total}</strong>
            </div>
          </div>
          <div className="game-row">
            <input
              aria-label="Fictional loan amount"
              type="number"
              min={100}
              max={1000}
              value={loanAmount}
              onChange={(e) => setLoanAmount(Number(e.target.value))}
            />
            <button
              disabled={
                disabled ||
                state.loan.principal > 0 ||
                (!!state.loan.nextBorrowAt &&
                  Date.parse(state.loan.nextBorrowAt) > Date.now())
              }
              onClick={() =>
                void action("loans.borrow", { amount: loanAmount })
              }
            >
              Borrow Credits
            </button>
            <button
              disabled={
                disabled ||
                !state.loan.principal ||
                state.credits < state.loan.total
              }
              onClick={() => void action("loans.repay")}
            >
              Repay {state.loan.total} Credits
            </button>
            <button disabled={disabled} onClick={() => void action("state")}>
              Refresh debt
            </button>
          </div>
          {state.loan.nextBorrowAt && (
            <p className="game-hint">
              Next loan becomes available{" "}
              {new Date(state.loan.nextBorrowAt).toLocaleString()}.
            </p>
          )}
        </section>
      )}
      {tab === "collection" && (
        <section className="game-card">
          <h3>Limited editions</h3>
          <p>
            Numbered collectibles bought with fictional Credits. Copies are
            cosmetic and have no gameplay advantage. Listed copies must be
            delisted before they can be sent directly.
          </p>
          <div className="game-grid">
            {state.collectibleShop.map((item) => (
              <article className="game-card" key={item.itemId}>
                <h4>
                  {item.icon} {item.name ?? item.itemId}
                </h4>
                <p>{item.description}</p>
                <p>
                  {item.supply - item.issued} of {item.supply} remain ·{" "}
                  {item.price} Credits
                </p>
                <button
                  disabled={
                    disabled ||
                    item.issued >= item.supply ||
                    state.credits < item.price
                  }
                  onClick={() =>
                    void action("collect.buy", { itemId: item.itemId })
                  }
                >
                  Buy {item.name ?? item.itemId}
                </button>
              </article>
            ))}
          </div>
          <h4>Your collection</h4>
          <div className="game-row">
            <label>
              Recipient{" "}
              <input
                aria-label="Collectible recipient username"
                value={recipient}
                placeholder="Username"
                onChange={(e) => setRecipient(e.target.value)}
              />
            </label>
            <label>
              Listing price{" "}
              <input
                aria-label="Collectible listing price"
                type="number"
                min={1}
                max={100000}
                value={salePrice}
                onChange={(e) => setSalePrice(Number(e.target.value))}
              />
            </label>
          </div>
          {state.collectibles.length === 0 && (
            <p>Your numbered copies will appear here.</p>
          )}
          {state.collectibles.map((copy) => (
            <article className="game-card" key={copy.id}>
              <h4>
                {state.collectibleShop.find(
                  (item) => item.itemId === copy.itemId,
                )?.name ?? copy.itemId}{" "}
                #{copy.serial}
              </h4>
              <div className="game-row">
                {copy.reservationOfferId ? (
                  <span>
                    Reserved in a pending offer · resolve it in Offers.
                  </span>
                ) : copy.listingId ? (
                  <>
                    <span>Listed for {copy.price} Credits</span>
                    <button
                      disabled={disabled}
                      onClick={() =>
                        void marketAction("marketplace.cancel", {
                          listingId: copy.listingId,
                        })
                      }
                    >
                      Cancel listing
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      disabled={disabled || recipient.trim().length < 3}
                      onClick={() =>
                        void marketAction("collect.transfer", {
                          copyId: copy.id,
                          username: recipient.trim(),
                        })
                      }
                    >
                      Send to {recipient || "player"}
                    </button>
                    <button
                      disabled={
                        disabled ||
                        !Number.isInteger(salePrice) ||
                        salePrice < 1 ||
                        salePrice > 100000
                      }
                      onClick={() =>
                        void marketAction("marketplace.list", {
                          copyId: copy.id,
                          price: salePrice,
                        })
                      }
                    >
                      List for {salePrice} Credits
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
      {tab === "marketplace" && (
        <section className="game-card">
          <h3>Player marketplace</h3>
          <p>
            Buy numbered collectibles from players with fictional Credits. The
            server commits payment and ownership together.
          </p>
          <button disabled={disabled} onClick={() => void action("state")}>
            Refresh marketplace
          </button>
          {state.marketplace.length === 0 && (
            <p>No active listings yet. List a copy from your collection.</p>
          )}
          {state.marketplace.map((listing) => {
            const own = state.collectibles.some(
              (copy) => copy.listingId === listing.id,
            );
            return (
              <article className="game-card" key={listing.id}>
                <h4>
                  {state.collectibleShop.find(
                    (item) => item.itemId === listing.itemId,
                  )?.name ?? listing.itemId}{" "}
                  #{listing.serial}
                </h4>
                <p>
                  From @{listing.sellerUsername} · {listing.price} Credits
                </p>
                {own ? (
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void marketAction("marketplace.cancel", {
                        listingId: listing.id,
                      })
                    }
                  >
                    Cancel your listing
                  </button>
                ) : (
                  <button
                    disabled={disabled || state.credits < listing.price}
                    onClick={() =>
                      void marketAction("marketplace.buy", {
                        listingId: listing.id,
                      })
                    }
                  >
                    Buy for {listing.price} Credits
                  </button>
                )}
              </article>
            );
          })}
        </section>
      )}
      {tab === "offers" && (
        <MarketplaceOffers
          state={state}
          disabled={disabled}
          action={marketAction}
        />
      )}
      {state.lastResult !== undefined && state.lastResult !== null && (
        <p className="game-log" aria-live="polite">
          {resultMessage(state.lastResult)}
        </p>
      )}
      {error && (
        <p className="game-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function resultMessage(result: Record<string, unknown>): string {
  const amount =
    typeof result.amount === "number" ? result.amount.toLocaleString() : "0";
  if (result.game === "offer") {
    if (result.operation === "create")
      return `Trade offer sent; ${String(result.reservedCredits ?? 0)} fictional Credits reserved.`;
    if (result.operation === "accept")
      return "Barter accepted. Credits and collectible ownership settled together.";
    return `Trade offer ${String(result.status)}. Reserved Credits and copies were released.`;
  }
  if (result.game === "loan")
    return result.operation === "borrow"
      ? `Borrowed ${amount} fictional Credits.`
      : `Repaid ${amount} fictional Credits, including interest.`;
  if (result.game === "reward")
    return `Allowance claimed: ${amount} fictional Credits.`;
  if (result.game === "transfer")
    return `Sent ${amount} fictional Credits to @${String(result.username ?? "player")}.`;
  if (result.game === "collectible")
    return result.operation === "transfer"
      ? `Collectible sent to @${String(result.username ?? "player")}.`
      : `Edition #${String(result.serial)} added to your collection.`;
  if (result.game === "marketplace") {
    if (result.operation === "cancel")
      return "Listing cancelled. Your copy is available to keep, send, or relist.";
    return result.operation === "buy"
      ? `Collectible purchased for ${String(result.price)} fictional Credits.`
      : `Collectible listed for ${String(result.price)} fictional Credits.`;
  }
  const game =
    typeof result.game === "string"
      ? result.game[0].toUpperCase() + result.game.slice(1)
      : "Round";
  const profit = typeof result.profit === "number" ? result.profit : 0;
  const detail =
    result.game === "dice" || result.game === "roulette"
      ? ` · roll ${String(result.roll)}`
      : typeof result.outcome === "string"
        ? ` · ${result.outcome}`
        : "";
  return `${game}${detail} · wager ${String(result.bet)} · returned ${String(result.payout)} · profit ${profit > 0 ? "+" : ""}${profit} Credits.`;
}
function Card({ value }: { value: unknown }) {
  const text =
    typeof value === "number"
      ? value === -1
        ? "?"
        : `${["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"][value % 13]}${["♠", "♥", "♦", "♣"][Math.floor(value / 13)]}`
      : value === null
        ? "?"
        : typeof value === "object" && value && "rank" in value
          ? `${String((value as { rank: unknown }).rank)} ${String((value as { suit?: unknown }).suit ?? "")}`
          : describe(value);
  return (
    <div
      style={{
        background: "#f3eee6",
        color: "#54274c",
        minWidth: 58,
        height: 80,
        display: "grid",
        placeItems: "center",
        fontWeight: 750,
        borderRadius: 8,
        fontSize: 20,
      }}
    >
      {text}
    </div>
  );
}

function Plinko({ result }: { result?: Record<string, unknown> }) {
  const path =
    result?.game === "plinko" && Array.isArray(result.path)
      ? (result.path as number[])
      : [];
  let x = 250;
  const points = [
    "250,15",
    ...path.map((side, index) => {
      x += side ? 20 : -20;
      return `${x},${45 + index * 34}`;
    }),
  ].join(" ");
  return (
    <svg
      viewBox="0 0 500 340"
      style={{
        width: "100%",
        maxWidth: 500,
        background: "#122033",
        borderRadius: 12,
      }}
      role="img"
      aria-label="Plinko board and the most recent ball path"
    >
      {Array.from({ length: 8 }, (_, row) =>
        Array.from({ length: row + 1 }, (_, column) => (
          <circle
            key={`${row}-${column}`}
            cx={250 - row * 20 + column * 40}
            cy={35 + row * 34}
            r={4}
            fill="#7188a7"
          />
        )),
      )}
      {path.length > 0 && (
        <>
          <polyline
            points={points}
            fill="none"
            stroke="#bfff75"
            strokeWidth={3}
          />
          <circle cx={x} cy={283} r={8} fill="#e1ffad" />
        </>
      )}
      {Array.from({ length: 9 }, (_, slot) => (
        <g key={slot}>
          <rect
            x={70 + slot * 40}
            y={307}
            width={36}
            height={23}
            rx={4}
            fill={result?.slot === slot ? "#537844" : "#263953"}
          />
          <text
            x={88 + slot * 40}
            y={323}
            textAnchor="middle"
            fontSize={12}
            fill="#d1dff0"
          >
            {slot}
          </text>
        </g>
      ))}
    </svg>
  );
}
