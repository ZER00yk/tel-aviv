"use client";
import { useCallback, useEffect, useState } from "react";
import { getGameSocket } from "./socket";
import type { QueueStatus } from "../../../apps/realtime/src/queue";
interface QueueProps {
  gameId: string;
  userId: string;
  connected: boolean;
  lobbyCode?: string;
  coopMode?: "gauntlet" | "campaign";
}
const activeStates = new Set(["waiting", "matching", "matched"]);
export function MatchmakingControls({
  gameId,
  userId,
  connected,
  lobbyCode,
  coopMode = "gauntlet",
}: QueueProps) {
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [region, setRegion] = useState("global");
  const [party, setParty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useCallback(
    (event: string, payload: Record<string, unknown> = {}) => {
      setError("");
      setBusy(true);
      getGameSocket()
        .timeout(7000)
        .emit(
          event,
          payload,
          (
            timeout: Error | null,
            result?: { data?: QueueStatus | null; error?: string },
          ) => {
            setBusy(false);
            if (timeout)
              setError(
                "Matchmaking did not respond. Reconnect or refresh your queue status.",
              );
            else if (result?.error) setError(result.error);
            else setQueue(result?.data ?? null);
          },
        );
    },
    [],
  );
  useEffect(() => {
    const socket = getGameSocket();
    const update = (status: QueueStatus | null) => setQueue(status);
    const recover = () =>
      socket
        .timeout(7000)
        .emit(
          "game:queue:status",
          {},
          (
            timeout: Error | null,
            result?: { data?: QueueStatus | null; error?: string },
          ) => {
            if (!timeout && !result?.error) setQueue(result?.data ?? null);
          },
        );
    socket.on("game:queue:state", update);
    socket.on("connect", recover);
    if (socket.connected) recover();
    const timer = window.setInterval(() => {
      if (socket.connected) recover();
    }, 5000);
    return () => {
      socket.off("game:queue:state", update);
      socket.off("connect", recover);
      window.clearInterval(timer);
    };
  }, [userId]);
  const active = !!queue && activeStates.has(queue.status);
  if (gameId === "poker" || gameId === "tower-defense") return null;
  if (
    lobbyCode &&
    (!queue ||
      queue.lobbyCode !== lobbyCode ||
      queue.status === "playing" ||
      queue.status === "completed")
  )
    return null;
  return (
    <section className="matchmaking-controls" aria-label="Public matchmaking">
      <h4>Find players</h4>
      <p className="game-hint">
        Join a compatible casual match. Everyone confirms Ready before the host
        starts. Pool selection groups players with the same preference.
      </p>
      {active ? (
        <div role="status">
          <p>
            <strong>
              {queue.status === "matched"
                ? "Match found · ready check"
                : queue.status === "matching"
                  ? "Creating your match…"
                  : "Waiting for compatible players"}
            </strong>{" "}
            · {queue.gameId} · {queue.region}
            {queue.party ? ` · party of ${queue.memberCount}` : ""}
          </p>
          {queue.status === "waiting" && (
            <p>
              {queue.waitedSeconds}s queued · {queue.poolPlayers} players in
              this pool · needs {queue.minPlayers}–{queue.maxPlayers} players
            </p>
          )}
          {queue.readyDeadline && queue.status === "matched" && (
            <p>
              Confirm Ready before{" "}
              {new Date(queue.readyDeadline).toLocaleTimeString()}.
            </p>
          )}
          <button
            disabled={busy || !connected}
            onClick={() => request("game:queue:leave")}
          >
            {queue.status === "matched"
              ? "Decline matched room"
              : "Leave matchmaking"}
          </button>
        </div>
      ) : (
        <>
          {queue?.reason && <p role="status">{queue.reason}</p>}
          <div className="game-row">
            <label>
              Player pool{" "}
              <select
                aria-label="Matchmaking player pool"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              >
                <option value="global">Global</option>
                <option value="americas">Americas</option>
                <option value="europe">Europe</option>
                <option value="asia-pacific">Asia Pacific</option>
              </select>
            </label>
            <label>
              Mode{" "}
              <select
                aria-label="Matchmaking mode"
                value="casual"
                onChange={() => undefined}
              >
                <option value="casual">Casual</option>
                <option value="ranked" disabled>
                  Ranked multiplayer unavailable
                </option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={party}
                onChange={(e) => setParty(e.target.checked)}
              />{" "}
              Queue my ready party
            </label>
            <button
              disabled={busy || !connected || !userId || !!lobbyCode}
              onClick={() =>
                request("game:queue:join", {
                  gameId,
                  region,
                  mode: "casual",
                  coopMode,
                  party,
                })
              }
            >
              Join public matchmaking
            </button>
            <button
              disabled={busy || !connected}
              onClick={() => request("game:queue:status")}
            >
              Refresh queue status
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="game-error">
          {error}
        </p>
      )}
    </section>
  );
}
