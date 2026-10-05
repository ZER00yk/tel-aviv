"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { getGameSocket } from "./socket";
import { MatchmakingControls } from "./queue";
export interface LobbyPlayer {
  id: string;
  username: string;
  ready: boolean;
  connected: boolean;
}
export interface LobbyView {
  code: string;
  gameId: string;
  hostId: string;
  status: string;
  players: LobbyPlayer[];
  state: Record<string, unknown> | null;
}
export function useLobby() {
  const mountGeneration = useRef(0);
  const [lobby, setLobby] = useState<LobbyView | null>(null),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false);
  useEffect(() => {
    const generation = ++mountGeneration.current;
    const socket = getGameSocket();
    const update = (view: LobbyView | null) => setLobby(view);
    const connect = () => setConnected(true);
    const disconnect = () => setConnected(false);
    const error = (e: Error) => setError(e.message);
    socket.on("game:lobby:state", update);
    socket.on("connect", connect);
    socket.on("disconnect", disconnect);
    socket.on("connect_error", error);
    setConnected(socket.connected);
    return () => {
      socket.off("game:lobby:state", update);
      socket.off("connect", connect);
      socket.off("disconnect", disconnect);
      socket.off("connect_error", error);
      // React StrictMode and Fast Refresh re-run effects without leaving the
      // game. A real unmount still leaves, after a synchronous remount can cancel.
      setTimeout(() => {
        if (mountGeneration.current === generation)
          socket.emit("game:lobby:leave", {});
      }, 0);
    };
  }, []);
  const send = useCallback(
    (event: string, payload: Record<string, unknown> = {}) => {
      setError("");
      getGameSocket()
        .timeout(7000)
        .emit(
          event,
          payload,
          (
            timeout: Error | null,
            response: { data?: LobbyView; error?: string } | undefined,
          ) => {
            if (timeout) setError("The realtime service did not respond.");
            else if (response?.error) setError(response.error);
            else if (response?.data?.code) setLobby(response.data);
            else if (event === "game:lobby:recover" && response?.data === null)
              setLobby(null);
            if (event === "game:lobby:leave") setLobby(null);
          },
        );
    },
    [],
  );
  return { lobby, error, connected, send };
}
export function LobbyControls({
  gameId,
  userId,
  lobby,
  error,
  connected,
  send,
  coopMode = "gauntlet",
}: {
  gameId: string;
  userId: string;
  lobby: LobbyView | null;
  error: string;
  connected: boolean;
  send: (event: string, payload?: Record<string, unknown>) => void;
  coopMode?: "gauntlet" | "campaign";
}) {
  const [code, setCode] = useState("");
  const self = lobby?.players.find((p) => p.id === userId);
  return (
    <section className="game-card">
      <h3>{lobby ? `Room ${lobby.code}` : "Play with friends"}</h3>
      <p className="game-hint">
        {connected ? "Realtime connected" : "Connecting to realtime…"}
      </p>
      {!lobby ? (
        <div className="game-row">
          <button
            onClick={() =>
              send("game:lobby:create", { gameId, visibility: "private" })
            }
          >
            Create private room
          </button>
          <input
            aria-label="Room code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Room code"
            maxLength={8}
          />
          <button onClick={() => send("game:lobby:join", { code })}>
            Join
          </button>
        </div>
      ) : (
        <>
          <div className="game-row">
            {lobby.players.map((player) => (
              <span key={player.id}>
                {player.username} {player.ready ? "✓" : "…"}{" "}
                {player.connected ? "" : "(away)"}
              </span>
            ))}
          </div>
          <div className="game-row">
            <button
              onClick={() => send("game:lobby:ready", { ready: !self?.ready })}
            >
              {self?.ready ? "Unready" : "Ready"}
            </button>
            {lobby.hostId === userId && (
              <button onClick={() => send("game:lobby:start", {})}>
                Start match
              </button>
            )}
            <button onClick={() => send("game:lobby:leave", {})}>
              Leave room
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="game-error" role="alert">
          {error}
        </p>
      )}
      <MatchmakingControls
        gameId={gameId}
        userId={userId}
        connected={connected}
        lobbyCode={lobby?.code}
        coopMode={coopMode}
      />
    </section>
  );
}
