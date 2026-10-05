"use client";
import { useEffect, useState } from "react";
import { LobbyControls, type useLobby } from "@tell-aviv/game-runtime";
import { Chess } from "chess.js";
import {
  applyBoardGameAction,
  boardGameView,
  createBoardGame,
  type BoardGameState,
  type BoardGameView,
  type BoardVariant,
} from "./host";
import { checkersBotMove, checkerSquare } from "./checkers";
const localIds = ["local-white", "local-black"];
const pieceNames: Record<string, string> = {
  p: "pawn",
  r: "rook",
  n: "knight",
  b: "bishop",
  q: "queen",
  k: "king",
};
const chessGlyphs: Record<string, [string, string]> = {
  p: ["♙", "♟"],
  r: ["♖", "♜"],
  n: ["♘", "♞"],
  b: ["♗", "♝"],
  q: ["♕", "♛"],
  k: ["♔", "♚"],
};
const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function chessBot(s: BoardGameState) {
  if (s.kind !== "chess") return;
  const chess = new Chess(s.position.fen),
    side = chess.turn();
  const evaluate = () =>
    chess.isCheckmate()
      ? chess.turn() === side
        ? -10000
        : 10000
      : chess.isDraw()
        ? 0
        : chess
            .board()
            .flat()
            .reduce(
              (total, p) =>
                total + (p ? values[p.type] * (p.color === side ? 1 : -1) : 0),
              0,
            );
  const candidates = chess
    .moves({ verbose: true })
    .sort(
      (a, b) =>
        (b.captured ? values[b.captured] : 0) -
          (a.captured ? values[a.captured] : 0) ||
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to),
    );
  let best = candidates[0],
    bestScore = -Infinity;
  const deadline = performance.now() + 70;
  let nodes = 0;
  for (const move of candidates) {
    if (nodes > 1500 || performance.now() > deadline) break;
    chess.move(move);
    let score = evaluate();
    if (!chess.isGameOver()) {
      let worst = Infinity;
      for (const reply of chess.moves({ verbose: true })) {
        if (nodes++ > 1500 || performance.now() > deadline) break;
        chess.move(reply);
        worst = Math.min(worst, evaluate());
        chess.undo();
      }
      score = Number.isFinite(worst) ? worst : score;
    }
    chess.undo();
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best
    ? {
        type: "board:move",
        from: best.from,
        to: best.to,
        ...(best.promotion ? { promotion: best.promotion } : {}),
      }
    : undefined;
}
export function BoardVariantClient({
  variant,
  network,
  userId,
  paused,
}: {
  variant: BoardVariant;
  network: ReturnType<typeof useLobby>;
  userId: string;
  paused: boolean;
}) {
  const [local, setLocal] = useState<BoardGameState>(() =>
      createBoardGame(variant, localIds),
    ),
    [opponent, setOpponent] = useState("friend"),
    [selected, setSelected] = useState<string | null>(null),
    [promotion, setPromotion] = useState("q"),
    [error, setError] = useState("");
  useEffect(() => {
    setLocal(createBoardGame(variant, localIds));
    setSelected(null);
    setError("");
  }, [variant]);
  const remote =
    network.lobby?.gameId === variant
      ? (network.lobby.state as unknown as BoardGameView | null)
      : null;
  const localTurn =
    local.kind === "checkers"
      ? localIds[local.position.turn - 1]
      : new Chess(local.position.fen).turn() === "w"
        ? localIds[0]
        : localIds[1];
  const view =
    remote ??
    boardGameView(local, opponent === "bot" ? localIds[0] : localTurn);
  const waiting = !!network.lobby && !remote;
  const viewerId = remote
    ? userId
    : opponent === "bot"
      ? localIds[0]
      : localTurn;
  useEffect(() => {
    if (
      remote ||
      paused ||
      opponent !== "bot" ||
      local.result ||
      localTurn !== localIds[1]
    )
      return;
    const timer = setTimeout(() => {
      const action =
        local.kind === "checkers"
          ? (() => {
              const move = checkersBotMove(local.position);
              return move
                ? {
                    type: "board:move",
                    from: checkerSquare(move.from),
                    to: checkerSquare(move.to),
                  }
                : undefined;
            })()
          : chessBot(local);
      if (action) {
        const next = structuredClone(local);
        applyBoardGameAction(next, localIds[1], action);
        setLocal(next);
      }
    }, 160);
    return () => clearTimeout(timer);
  }, [remote, paused, opponent, local, localTurn]);
  const send = (payload: Record<string, unknown>) => {
    setError("");
    if (paused) return;
    if (remote) {
      network.send("game:action", payload);
      return;
    }
    try {
      const next = structuredClone(local);
      applyBoardGameAction(next, viewerId, payload);
      setLocal(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "This move is unavailable");
    }
  };
  const play = (square: string) => {
    if (paused || waiting || view.result || view.turn !== viewerId) return;
    const move =
      selected &&
      view.legalMoves.find((m) => m.from === selected && m.to === square);
    if (move) {
      const promotions = view.legalMoves.some(
        (m) => m.from === selected && m.to === square && m.promotion,
      );
      send({
        type: "board:move",
        from: selected,
        to: square,
        ...(promotions ? { promotion } : {}),
      });
      setSelected(null);
    } else if (view.legalMoves.some((m) => m.from === square))
      setSelected(square);
    else {
      setSelected(null);
      setError(
        view.forcedFrom
          ? `Continue the capture from ${view.forcedFrom}`
          : variant === "checkers"
            ? "Select a piece with a legal move. Captures are mandatory."
            : "Select a piece with a legal move. Your king must stay safe.",
      );
    }
  };
  const names = (id: string) =>
    network.lobby?.players.find((p) => p.id === id)?.username ??
    (id === localIds[0]
      ? variant === "chess"
        ? "White"
        : "Coral"
      : variant === "chess"
        ? "Black"
        : "Gold");
  return (
    <section aria-label={`${view.name} game`}>
      <h2>{view.name}</h2>
      <p className="game-hint">
        {variant === "checkers"
          ? "American rules: capture is mandatory. Men move and capture forward; kings move both directions. Continue a multi-jump with the same piece. Promotion ends the turn."
          : "Standard legal chess: check, castling, en passant and promotion are validated. Repetition, stalemate, insufficient material and the fifty-move rule can end in a draw."}{" "}
        Network moves use the same rules on the server. Local play is unranked.
      </p>
      <div className="game-row">
        <label>
          Local opponent{" "}
          <select
            aria-label="Board local opponent"
            value={opponent}
            disabled={!!network.lobby}
            onChange={(e) => {
              setOpponent(e.target.value);
              setLocal(createBoardGame(variant, localIds));
              setSelected(null);
            }}
          >
            <option value="friend">Pass and play</option>
            <option value="bot">Shallow local tactician</option>
          </select>
        </label>
        <button
          disabled={!!network.lobby}
          onClick={() => {
            setLocal(createBoardGame(variant, localIds));
            setSelected(null);
            setError("");
          }}
        >
          New local game
        </button>
        {variant === "chess" && (
          <label>
            Promotion{" "}
            <select
              aria-label="Chess promotion"
              value={promotion}
              onChange={(e) => setPromotion(e.target.value)}
            >
              <option value="q">Queen</option>
              <option value="r">Rook</option>
              <option value="b">Bishop</option>
              <option value="n">Knight</option>
            </select>
          </label>
        )}
      </div>
      <p role="status" data-testid="board-game-status">
        {waiting
          ? "Ready the room, then start the match"
          : view.result
            ? view.result.winners.length
              ? `${names(view.result.winners[0])} wins — ${view.result.reason}`
              : `Draw — ${view.result.reason}`
            : `${view.turn === viewerId ? (remote ? "Your turn" : `${names(view.turn)} to move`) : "Waiting for opponent"}${view.inCheck ? " · Check" : ""}${view.forcedFrom ? ` · continue capture from ${view.forcedFrom}` : ""}`}
      </p>
      <div
        role="grid"
        aria-label={`${view.name} board`}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(8,minmax(0,1fr))",
          width: "100%",
          maxWidth: 560,
          border: "6px solid #33443b",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        {view.board.flatMap((row, r) =>
          row.map((cell, c) => {
            const target =
                !!selected &&
                view.legalMoves.some(
                  (m) => m.from === selected && m.to === cell.square,
                ),
              own = cell.side === view.selfSide,
              side =
                variant === "chess"
                  ? cell.side === 1
                    ? "White"
                    : "Black"
                  : cell.side === 1
                    ? "Coral"
                    : "Gold";
            const label = `${cell.square}${cell.piece ? ` ${side} ${pieceNames[cell.piece] ?? cell.piece}` : " empty"}`;
            return (
              <button
                role="gridcell"
                key={cell.square}
                aria-label={label}
                aria-selected={selected === cell.square}
                data-square={cell.square}
                data-piece={cell.piece ?? ""}
                data-side={cell.side}
                title={target ? "Legal destination" : label}
                onClick={() => play(cell.square)}
                disabled={
                  paused || waiting || !!view.result || view.turn !== viewerId
                }
                onKeyDown={(event) => {
                  const directions: Record<string, number> = {
                    ArrowUp: -8,
                    ArrowDown: 8,
                    ArrowLeft: -1,
                    ArrowRight: 1,
                  };
                  const d = directions[event.key];
                  if (d) {
                    event.preventDefault();
                    const cells =
                      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                        "button",
                      );
                    cells?.[Math.max(0, Math.min(63, r * 8 + c + d))]?.focus();
                  }
                }}
                style={{
                  aspectRatio: "1",
                  minWidth: 0,
                  minHeight: 34,
                  padding: 0,
                  border: 0,
                  borderRadius: 0,
                  background:
                    selected === cell.square
                      ? "#79a9ce"
                      : target
                        ? "#b8da83"
                        : (r + c) % 2
                          ? "#61776a"
                          : "#e9e1cb",
                  color: cell.side === 1 ? "#fff" : "#111",
                  fontSize: "clamp(23px,5vw,47px)",
                  lineHeight: 1,
                  position: "relative",
                  opacity: 1,
                  outline:
                    own && view.legalMoves.some((m) => m.from === cell.square)
                      ? "1px solid #fff8"
                      : undefined,
                }}
              >
                {cell.piece ? (
                  variant === "chess" ? (
                    <span
                      style={{
                        textShadow:
                          cell.side === 1
                            ? "0 1px #111, 1px 0 #111, -1px 0 #111"
                            : "0 1px #fff",
                      }}
                    >
                      {chessGlyphs[cell.piece]?.[cell.side === 1 ? 0 : 1]}
                    </span>
                  ) : (
                    <span
                      style={{
                        display: "inline-flex",
                        justifyContent: "center",
                        alignItems: "center",
                        width: "75%",
                        height: "75%",
                        borderRadius: "50%",
                        background: cell.side === 1 ? "#e57168" : "#ebcb65",
                        color: "#201d1a",
                        border: "3px solid #2225",
                        boxShadow: "0 2px 4px #0005",
                      }}
                    >
                      {cell.king ? "♛" : ""}
                    </span>
                  )
                ) : target ? (
                  "·"
                ) : (
                  ""
                )}
                {(r === 7 || c === 0) && (
                  <small
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      bottom: 2,
                      left: 3,
                      fontSize: 9,
                      color: (r + c) % 2 ? "#eef4eb" : "#31433a",
                    }}
                  >
                    {cell.square}
                  </small>
                )}
              </button>
            );
          }),
        )}
      </div>
      {error && (
        <p role="alert" className="game-error">
          {error}
        </p>
      )}
      {remote && !view.result && (
        <div className="game-row">
          <button onClick={() => send({ type: "board:resign" })}>
            Resign game
          </button>
          <button
            disabled={view.drawOffer === userId}
            onClick={() => send({ type: "board:draw" })}
          >
            {view.drawOffer && view.drawOffer !== userId
              ? "Accept draw"
              : "Offer draw"}
          </button>
          {view.drawOffer && view.drawOffer !== userId && (
            <button onClick={() => send({ type: "board:decline" })}>
              Decline draw
            </button>
          )}
        </div>
      )}
      {view.moveHistory.length > 0 && (
        <details>
          <summary>Move history ({view.ply} plies)</summary>
          <p>{view.moveHistory.join(" · ")}</p>
        </details>
      )}
      <LobbyControls {...network} gameId={variant} userId={userId} />
    </section>
  );
}
