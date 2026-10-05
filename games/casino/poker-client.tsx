"use client";
import { useEffect, useRef, useState } from "react";
import { LobbyControls, useLobby } from "@tell-aviv/game-runtime";
import type { GameSDK } from "@tell-aviv/game-sdk";
import type { PokerView } from "./multiplayer-poker";
export interface PokerHandHistory {
  matchId: string;
  status: "active" | "settled" | "refunded";
  yourBuyIn: number;
  yourPayout: number | null;
  tableId?: string | null;
  handNumber?: number | null;
  yourCards: number[];
  summary: {
    reason?: string;
    community?: number[];
    revealed?: { userId: string; hole: number[] }[];
  };
}
interface PersistentTableView {
  id: string;
  minBuyIn: number;
  maxBuyIn: number;
  handNumber: number;
  closed?: boolean;
  seats: {
    userId: string;
    stack: number;
    sittingOut: boolean;
    pendingLeave: boolean;
  }[];
}
function cardName(card: number) {
  if (card < 0) return "Hidden card";
  return `${["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"][card % 13]}${["♣", "♦", "♥", "♠"][Math.floor(card / 13)]}`;
}
function Card({ value }: { value: number }) {
  return (
    <span
      aria-label={cardName(value)}
      className="game-stat"
      style={{
        display: "inline-flex",
        padding: "12px 14px",
        margin: 3,
        minWidth: 48,
        justifyContent: "center",
        background: value < 0 ? "#334469" : "#eaf0e7",
        color: value >= 13 && value < 39 ? "#a02b40" : "#111e32",
        fontSize: 22,
      }}
    >
      {value < 0 ? "▧" : cardName(value)}
    </span>
  );
}
export function PrivatePokerClient({
  sdk,
  paused,
  onBalanceChange,
  history = [],
  escrowCredits = 0,
}: {
  sdk: GameSDK;
  paused: boolean;
  onBalanceChange?: () => void;
  history?: PokerHandHistory[];
  escrowCredits?: number;
}) {
  const network = useLobby(),
    [userId, setUserId] = useState(""),
    [buyIn, setBuyIn] = useState(100),
    [persistent, setPersistent] = useState(false),
    [minBuyIn, setMinBuyIn] = useState(100),
    [maxBuyIn, setMaxBuyIn] = useState(10000),
    [seatAmount, setSeatAmount] = useState(100),
    [raiseTo, setRaiseTo] = useState(20),
    [now, setNow] = useState(Date.now());
  const changed = useRef(onBalanceChange);
  changed.current = onBalanceChange;
  const state =
    network.lobby?.gameId === "poker"
      ? (network.lobby.state as unknown as PokerView | null)
      : null;
  const matchId = (network.lobby as unknown as { matchId?: string } | null)
    ?.matchId;
  const tableBuyIn =
    (network.lobby as unknown as { pokerBuyIn?: number } | null)?.pokerBuyIn ??
    100;
  const table = (
    network.lobby as unknown as { pokerTable?: PersistentTableView } | null
  )?.pokerTable;
  const ownTableSeat = table?.seats.find((seat) => seat.userId === userId);
  const playing = network.lobby?.status === "playing";
  const fundedPlayers =
    table?.seats.filter(
      (seat) => seat.stack > 0 && !seat.sittingOut && !seat.pendingLeave,
    ) ?? [];
  const canStartNextHand =
    fundedPlayers.length >= 2 &&
    fundedPlayers.every((seat) =>
      network.lobby?.players.some(
        (player) =>
          player.id === seat.userId && player.connected && player.ready,
      ),
    );
  const ownLobbyPlayer = network.lobby?.players.find(
    (player) => player.id === userId,
  );
  useEffect(() => {
    let active = true;
    void sdk
      .user()
      .then((u) => {
        if (active) setUserId(u.id);
      })
      .catch(() => {});
    network.send("game:lobby:recover");
    return () => {
      active = false;
    };
  }, [sdk, network.send]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    changed.current?.();
  }, [state?.phase, matchId, ownTableSeat?.stack, table?.closed]);
  useEffect(() => {
    if (table) setSeatAmount(table.minBuyIn);
  }, [table?.id, table?.minBuyIn]);
  useEffect(() => {
    if (state)
      setRaiseTo(
        Math.min(state.self.maxRaiseTo, Math.max(state.self.minRaiseTo, 20)),
      );
  }, [state?.self.minRaiseTo, state?.self.maxRaiseTo]);
  const send = (type: string, extra: Record<string, unknown> = {}) =>
    network.send("game:action", { type, revision: state?.revision, ...extra });
  const updateSeat = (amount: number, sittingOut?: boolean) =>
    network.send("game:lobby:poker-seat", {
      amount,
      ...(sittingOut === undefined ? {} : { sittingOut }),
      requestId: crypto.randomUUID(),
    });
  const self = state?.seats.find((seat) => seat.userId === userId),
    canAct = !!state?.self.canAct && !paused;
  const names = (id: string) =>
    network.lobby?.players.find((player) => player.id === id)?.username ??
    "Departed player";
  return (
    <section aria-label="Private multiplayer poker">
      <h3>Private Texas Hold&apos;em</h3>
      <p className="game-hint">
        {table
          ? "Persistent table for 2–6 invited accounts. Reserve your seat before readying. Hand endings retain chips at this table; leaving or closing it returns your final stack to your wallet. Blinds increase every ten hands, up to 100/200."
          : "2–6 invited accounts, one cash-out hand per match. Each player reserves the displayed buy-in when the host starts. Blinds are 5/10. Readying authorizes that reservation; changing the buy-in clears everyone's readiness."}{" "}
        Fictional Credits have no cash value.
      </p>
      <p>Currently reserved: {escrowCredits.toLocaleString()} Credits</p>
      {network.lobby && network.lobby.gameId !== "poker" ? (
        <div className="game-card">
          <p>
            You are in another game&apos;s room. Leave it to open a poker table.
          </p>
          <button onClick={() => network.send("game:lobby:leave")}>
            Leave other room
          </button>
        </div>
      ) : (
        <>
          {network.lobby && !table && (
            <div className="game-row">
              <strong>
                Table buy-in: {tableBuyIn.toLocaleString()} Credits per seat
              </strong>
              {network.lobby.hostId === userId &&
                network.lobby.status !== "playing" && (
                  <>
                    <label>
                      Buy-in{" "}
                      <input
                        aria-label="Poker table buy-in"
                        type="number"
                        min={100}
                        max={10000}
                        value={buyIn}
                        onChange={(e) => setBuyIn(Number(e.target.value))}
                      />
                    </label>
                    <button
                      onClick={() =>
                        network.send("game:lobby:poker-options", {
                          buyIn,
                          persistent,
                          minBuyIn,
                          maxBuyIn,
                        })
                      }
                    >
                      Set table buy-in
                    </button>
                    <label>
                      <input
                        type="checkbox"
                        checked={persistent}
                        onChange={(e) => setPersistent(e.target.checked)}
                      />
                      Keep table open between hands
                    </label>
                    {persistent && (
                      <>
                        <label>
                          Minimum seat buy-in{" "}
                          <input
                            aria-label="Poker minimum buy-in"
                            type="number"
                            min={100}
                            max={10000}
                            value={minBuyIn}
                            onChange={(e) =>
                              setMinBuyIn(Number(e.target.value))
                            }
                          />
                        </label>
                        <label>
                          Maximum seat buy-in{" "}
                          <input
                            aria-label="Poker maximum buy-in"
                            type="number"
                            min={minBuyIn}
                            max={10000}
                            value={maxBuyIn}
                            onChange={(e) =>
                              setMaxBuyIn(Number(e.target.value))
                            }
                          />
                        </label>
                      </>
                    )}
                  </>
                )}
            </div>
          )}
          {table && network.lobby ? (
            <div className="game-card" aria-label="Persistent poker table">
              <h3>Room {network.lobby.code}</h3>
              <p className="game-hint">
                {network.connected
                  ? "Realtime connected"
                  : "Connecting to realtime…"}
              </p>
              <p>
                Table {table.id.slice(0, 8)} ·{" "}
                {table.closed ? "Closed" : `Hand ${table.handNumber || 0}`} ·
                seat buy-in {table.minBuyIn.toLocaleString()}–
                {table.maxBuyIn.toLocaleString()} Credits
              </p>
              <div aria-label="Retained poker seats" className="game-grid">
                {table.seats.map((seat) => (
                  <div
                    className="game-stat"
                    key={seat.userId}
                    data-poker-table-seat={seat.userId}
                  >
                    <strong>{names(seat.userId)}</strong>
                    <span>
                      {seat.stack.toLocaleString()} retained chips
                      {seat.pendingLeave
                        ? " · Leaves after hand"
                        : seat.sittingOut
                          ? " · Sitting out"
                          : " · Active"}
                    </span>
                  </div>
                ))}
              </div>
              {!table.closed && !playing && (
                <>
                  <p>
                    Reserve or rebuy between hands. Your retained stack is not
                    cashed out when a hand ends. All funded, active seats must
                    be connected and ready for the host to deal.
                  </p>
                  <div className="game-row">
                    <label>
                      {ownTableSeat ? "Add seat chips" : "Reserve seat chips"}{" "}
                      <input
                        aria-label="Poker seat amount"
                        type="number"
                        min={ownTableSeat?.stack ? 1 : table.minBuyIn}
                        max={Math.max(
                          0,
                          table.maxBuyIn - (ownTableSeat?.stack ?? 0),
                        )}
                        value={seatAmount}
                        onChange={(e) => setSeatAmount(Number(e.target.value))}
                      />
                    </label>
                    <button
                      disabled={
                        !network.connected ||
                        !Number.isInteger(seatAmount) ||
                        seatAmount <
                          (ownTableSeat?.stack ? 1 : table.minBuyIn) ||
                        seatAmount + (ownTableSeat?.stack ?? 0) >
                          table.maxBuyIn ||
                        !!ownTableSeat?.pendingLeave
                      }
                      onClick={() => updateSeat(seatAmount)}
                    >
                      {ownTableSeat ? "Rebuy seat chips" : "Reserve poker seat"}
                    </button>
                    {!!ownTableSeat && ownTableSeat.stack >= table.maxBuyIn && (
                      <p>
                        Your retained stack meets or exceeds the buy-in cap.
                        Play with those chips or leave to return them to your
                        fictional wallet.
                      </p>
                    )}
                    {ownTableSeat && (
                      <button
                        disabled={ownTableSeat.pendingLeave}
                        onClick={() => updateSeat(0, !ownTableSeat.sittingOut)}
                      >
                        {ownTableSeat.sittingOut
                          ? "Return to table"
                          : "Sit out next hand"}
                      </button>
                    )}
                  </div>
                  <div className="game-row">
                    <button
                      disabled={
                        !network.connected ||
                        !ownTableSeat ||
                        ownTableSeat.stack <= 0 ||
                        ownTableSeat.sittingOut ||
                        ownTableSeat.pendingLeave
                      }
                      onClick={() =>
                        network.send("game:lobby:ready", {
                          ready: !ownLobbyPlayer?.ready,
                        })
                      }
                    >
                      {ownLobbyPlayer?.ready ? "Unready" : "Ready"}
                    </button>
                    {network.lobby.hostId === userId && (
                      <>
                        <button
                          disabled={!network.connected || !canStartNextHand}
                          onClick={() => network.send("game:lobby:start", {})}
                        >
                          Start next hand
                        </button>
                        <button
                          disabled={!network.connected}
                          onClick={() =>
                            network.send("game:lobby:poker-close", {})
                          }
                        >
                          Close poker table
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
              <div className="game-row">
                <button onClick={() => network.send("game:lobby:leave", {})}>
                  {playing ? "Leave after this hand" : "Leave room"}
                </button>
              </div>
              {network.error && (
                <p className="game-error" role="alert">
                  {network.error}
                </p>
              )}
            </div>
          ) : (
            <LobbyControls {...network} gameId="poker" userId={userId} />
          )}
        </>
      )}
      {state && (
        <>
          {state.table && (
            <p data-testid="poker-hand-blinds">
              Hand {state.table.handNumber} · blinds {state.table.smallBlind}/
              {state.table.bigBlind} ·{" "}
              {table?.closed
                ? "table closed; chips returned"
                : "chips remain reserved between hands"}
            </p>
          )}
          <div className="game-stats">
            <div className="game-stat">
              <small>Street</small>
              <strong data-testid="poker-table-street">{state.street}</strong>
            </div>
            <div className="game-stat">
              <small>Pot</small>
              <strong>{state.pot} Credits</strong>
            </div>
            <div className="game-stat">
              <small>Your chips</small>
              <strong>{self?.stack ?? 0}</strong>
            </div>
            <div className="game-stat">
              <small>Turn</small>
              <strong>
                {state.turn
                  ? state.turn === userId
                    ? "Your turn"
                    : names(state.turn)
                  : "Hand complete"}
              </strong>
              <small>
                {state.phase === "betting"
                  ? `${Math.max(0, Math.ceil((state.deadline - now) / 1000))} seconds`
                  : ""}
              </small>
            </div>
          </div>
          <div className="game-card">
            <h4>Community cards</h4>
            <div aria-label="Poker community cards">
              {state.community.map((card) => (
                <Card key={card} value={card} />
              ))}
              {state.community.length === 0 && <p>Flop has not been dealt</p>}
            </div>
          </div>
          <div className="game-card">
            <h4>Your private cards</h4>
            <div aria-label="Your poker cards">
              {self?.hole.map((card) => (
                <Card key={card} value={card} />
              ))}
            </div>
          </div>
          <div aria-label="Poker seats" className="game-grid">
            {state.seats.map((seat) => (
              <div
                className="game-card"
                key={seat.userId}
                data-poker-user-id={seat.userId}
              >
                <h4>
                  {names(seat.userId)}
                  {seat.userId === state.dealerId ? " · Dealer" : ""}
                  {seat.userId === state.turn ? " · To act" : ""}
                </h4>
                <p>
                  {seat.stack} chips · committed {seat.committed} ·{" "}
                  {seat.folded ? "Folded" : seat.allIn ? "All-in" : "Playing"}
                </p>
                <div aria-label={`${names(seat.userId)} pocket cards`}>
                  {seat.hole.map((card, index) => (
                    <Card key={index} value={card} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {state.phase === "betting" && (
            <div className="game-card">
              <p>
                Your call: {state.self.toCall} Credits · current street bet{" "}
                {state.currentBet}. An expired turn checks when free or folds
                against a bet. Pausing your controls keeps the table clock
                running.
              </p>
              <div className="game-row">
                <button disabled={!canAct} onClick={() => send("poker:fold")}>
                  Fold hand
                </button>
                <button
                  disabled={!canAct || state.self.toCall > 0}
                  onClick={() => send("poker:check")}
                >
                  Check hand
                </button>
                <button
                  disabled={!canAct || state.self.toCall === 0}
                  onClick={() => send("poker:call")}
                >
                  Call {state.self.toCall}
                </button>
                <button
                  disabled={
                    !canAct ||
                    (!state.self.canRaise &&
                      state.self.maxRaiseTo > state.currentBet)
                  }
                  onClick={() => send("poker:all-in")}
                >
                  All-in
                </button>
              </div>
              <div className="game-row">
                <label>
                  Raise street total to{" "}
                  <input
                    aria-label="Poker raise to"
                    type="number"
                    min={state.self.minRaiseTo}
                    max={state.self.maxRaiseTo}
                    value={raiseTo}
                    onChange={(e) => setRaiseTo(Number(e.target.value))}
                  />
                </label>
                <button
                  disabled={
                    !canAct ||
                    !state.self.canRaise ||
                    raiseTo < state.self.minRaiseTo ||
                    raiseTo > state.self.maxRaiseTo
                  }
                  onClick={() => send("poker:raise", { to: raiseTo })}
                >
                  Raise hand
                </button>
              </div>
            </div>
          )}
          {state.result && (
            <div className="game-card" role="status">
              <h4>
                {state.phase === "cancelled" ? "Hand refunded" : "Hand settled"}
              </h4>
              <p>{state.result.reason}</p>
              <p>
                Your final reserved stack: {state.payouts?.[userId] ?? 0}{" "}
                Credits.{" "}
                {table?.closed
                  ? "The table closed and the server returned each remaining retained stack to its wallet exactly once."
                  : state.table
                    ? "These chips stay at the table for the next hand. They return to your wallet when you leave or the host closes the table."
                    : "The server returned final stacks exactly once."}
              </p>
              {state.pots?.map((pot, i) => (
                <p key={i}>
                  Pot {i + 1}: {pot.amount} ·{" "}
                  {pot.winners.map(names).join(", ")}
                </p>
              ))}
            </div>
          )}
          <details>
            <summary>Hand actions</summary>
            {state.actionLog.map((entry, i) => (
              <p key={i}>
                {names(entry.userId)} · {entry.action.replace("poker:", "")}{" "}
                {entry.amount ? `· ${entry.amount}` : ""}
              </p>
            ))}
          </details>
          <p className="game-hint">
            Leaving folds an active seat. An already committed all-in remains
            eligible for showdown.{" "}
            {state.table
              ? "Leaving during a hand returns your final stack after settlement; other seats keep their chips for the next hand."
              : "Unused and won chips return when the hand ends."}{" "}
            Reconnect restores your own cards and the server checkpoint.
          </p>
        </>
      )}
      <details>
        <summary>Your poker hand history</summary>
        {history.length === 0 && <p>No private-table hands yet.</p>}
        {history.map((hand) => (
          <article
            className="game-card"
            key={hand.matchId}
            data-poker-history={hand.matchId}
          >
            <h4>
              {hand.status === "active"
                ? "Hand in progress"
                : hand.status === "refunded"
                  ? "Refunded hand"
                  : "Settled hand"}
            </h4>
            <p>
              {hand.tableId ? "Starting chips" : "Reserved"} {hand.yourBuyIn} ·{" "}
              {hand.tableId ? "ending stack" : "returned"}{" "}
              {hand.yourPayout ?? "pending"} Credits
            </p>
            {hand.tableId && (
              <p>
                Persistent table · hand {hand.handNumber ?? "—"}; hand
                settlements retain chips.
              </p>
            )}
            <p>{hand.summary.reason}</p>
            <div aria-label="Historical own poker cards">
              {hand.yourCards.map((card) => (
                <Card key={card} value={card} />
              ))}
            </div>
            <div aria-label="Historical community cards">
              {hand.summary.community?.map((card) => (
                <Card key={card} value={card} />
              ))}
            </div>
            {hand.summary.revealed
              ?.filter((seat) => seat.userId !== userId)
              .map((seat, index) => (
                <div
                  key={seat.userId}
                  aria-label={`Showdown hand ${index + 1}`}
                >
                  <small>Shown at showdown</small>
                  {seat.hole.map((card) => (
                    <Card key={card} value={card} />
                  ))}
                </div>
              ))}
          </article>
        ))}
      </details>
    </section>
  );
}
