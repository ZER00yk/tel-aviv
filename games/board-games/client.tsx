"use client";
import { useEffect, useState } from "react";
import { useLobby, LobbyControls, useCloudSave } from "@tell-aviv/game-runtime";
import type { GameSDK } from "@tell-aviv/game-sdk";
import { BoardVariantClient } from "./variant-client";
import { emptyBoard, drop, winner, botColumn, type Board } from "./rules";
export default function BoardGames({
  sdk,
  paused,
}: {
  sdk: GameSDK;
  paused: boolean;
}) {
  const network = useLobby();
  const [userId, setUserId] = useState(""),
    [board, setBoard] = useState<Board>(emptyBoard),
    [turn, setTurn] = useState<1 | 2>(1),
    [mode, setMode] = useState("bot");
  const [variant, setVariant] = useState<"connect-four" | "checkers" | "chess">(
    "connect-four",
  );
  const activeVariant =
    network.lobby?.gameId === "checkers" || network.lobby?.gameId === "chess"
      ? network.lobby.gameId
      : variant;
  const cloud = useCloudSave(sdk, { wins: 0, games: 0 });
  useEffect(() => {
    void sdk
      .user()
      .then((user) => setUserId(user.id))
      .catch(() => {});
    network.send("game:lobby:recover");
  }, [sdk, network.send]);
  const state = network.lobby?.state;
  const remoteBoard =
    network.lobby?.gameId === "connect-four" && Array.isArray(state?.board)
      ? ((state.board as (string | null)[][]).map((row) =>
          row.map((cell) =>
            cell === null ? 0 : cell === network.lobby?.players[0]?.id ? 1 : 2,
          ),
        ) as Board)
      : null;
  const display = remoteBoard ?? board;
  const won = winner(display);
  const drawn = display[0].every(Boolean) && !won;
  const play = (column: number) => {
    if (paused || won || drawn) return;
    if (remoteBoard) {
      network.send("game:action", { type: "drop", column });
      return;
    }
    const next = drop(board, column, turn);
    if (!next) return;
    setBoard(next);
    const victory = winner(next);
    if (victory) {
      const stats = {
        wins: cloud.data.wins + (victory === 1 ? 1 : 0),
        games: cloud.data.games + 1,
      };
      cloud.setData(stats);
      void cloud.save(stats);
      return;
    }
    if (mode === "bot") {
      const reply = drop(next, botColumn(next), 2);
      if (reply) {
        setTimeout(() => setBoard(reply), 200);
        if (winner(reply)) {
          const stats = { ...cloud.data, games: cloud.data.games + 1 };
          cloud.setData(stats);
          void cloud.save(stats);
        }
      }
    } else setTurn(turn === 1 ? 2 : 1);
  };
  const selector = (
    <label>
      Board game{" "}
      <select
        aria-label="Board game"
        value={activeVariant}
        disabled={!!network.lobby}
        onChange={(event) =>
          setVariant(
            event.target.value as "connect-four" | "checkers" | "chess",
          )
        }
      >
        <option value="connect-four">Four in a Row</option>
        <option value="checkers">American checkers</option>
        <option value="chess">Chess</option>
      </select>
    </label>
  );
  if (activeVariant !== "connect-four")
    return (
      <div>
        {selector}
        <BoardVariantClient
          variant={activeVariant}
          network={network}
          userId={userId}
          paused={paused}
        />
      </div>
    );
  return (
    <div>
      {selector}
      <h2>Four in a Row</h2>
      <p className="game-hint">
        Drop a disc into a column. Connect four horizontally, vertically, or
        diagonally. Local play is unranked; network turns are validated by the
        server.
      </p>
      <div className="game-row">
        <select
          aria-label="Local opponent"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            setBoard(emptyBoard());
            setTurn(1);
          }}
        >
          <option value="bot">Local tactician</option>
          <option value="friend">Pass and play</option>
        </select>
        <button
          onClick={() => {
            setBoard(emptyBoard());
            setTurn(1);
          }}
        >
          New local game
        </button>
        <span>
          {won
            ? `Player ${won} wins!`
            : drawn
              ? "Draw"
              : remoteBoard
                ? String(
                    state?.turn === userId
                      ? "Your turn"
                      : "Waiting for opponent",
                  )
                : `${turn === 1 ? "Coral" : "Gold"} to move`}
        </span>
      </div>
      <div
        style={{
          maxWidth: 560,
          background: "#233762",
          padding: 12,
          borderRadius: 16,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7,1fr)",
            gap: 8,
          }}
        >
          {Array.from({ length: 7 }, (_, c) => (
            <button
              key={c}
              aria-label={`Drop in column ${c + 1}`}
              disabled={paused || !!won || drawn}
              onClick={() => play(c)}
            >
              ↓
            </button>
          ))}
          {display.flatMap((row, r) =>
            row.map((cell, c) => (
              <div
                key={`${r}-${c}`}
                aria-label={cell ? `Player ${cell}` : "Empty"}
                style={{
                  aspectRatio: "1",
                  borderRadius: "50%",
                  background:
                    cell === 1 ? "#ff7e78" : cell === 2 ? "#f9d76a" : "#111c34",
                  boxShadow: "inset 0 3px 8px #0005",
                }}
              />
            )),
          )}
        </div>
      </div>
      <p className="game-hint">
        Saved local victories: {cloud.data.wins} · {cloud.message}
      </p>
      <LobbyControls {...network} gameId="connect-four" userId={userId} />
    </div>
  );
}
