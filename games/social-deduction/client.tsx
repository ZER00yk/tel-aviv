"use client";
import { useEffect, useRef, useState } from "react";
import {
  useLobby,
  LobbyControls,
  getGameSocket,
} from "@tell-aviv/game-runtime";
import type { GameSDK } from "@tell-aviv/game-sdk";
interface State {
  phase: string;
  players: { id: string; alive: boolean; x: number; y: number }[];
  self: {
    role: string;
    alive: boolean;
    tasks: number[];
    completed: number[];
    cooldownUntil: number;
    meetings: number;
  };
  allies: string[];
  tasks: { x: number; y: number; label: string }[];
  bodies: { id: string; x: number; y: number }[];
  completedTasks: number;
  totalTasks: number;
  sabotageUntil: number | null;
  meetingUntil: number | null;
  voted: string[];
  yourVote?: string;
  result?: { reason: string; winners: string[] };
}
export default function Deduction({
  sdk,
  paused,
}: {
  sdk: GameSDK;
  paused: boolean;
}) {
  const network = useLobby();
  const [userId, setUserId] = useState(""),
    [chat, setChat] = useState(""),
    [messages, setMessages] = useState<{ username: string; text: string }[]>(
      [],
    ),
    [clock, setClock] = useState(Date.now());
  const keys = useRef(new Set<string>()),
    touch = useRef({ dx: 0, dy: 0 });
  const state = network.lobby?.state as State | undefined;
  const self = state?.players.find((player) => player.id === userId);
  const live = useRef({ paused, state });
  live.current = { paused, state };
  useEffect(() => {
    void sdk.user().then((user) => setUserId(user.id));
    const down = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches("input,textarea,select"))
        return;
      keys.current.add(event.code);
      if (event.code.startsWith("Arrow")) event.preventDefault();
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.code);
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    const timer = setInterval(() => {
      setClock(Date.now());
      if (
        live.current.paused ||
        live.current.state?.phase !== "running" ||
        !live.current.state.self.alive
      )
        return;
      const k = keys.current,
        dx =
          (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) -
            (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) || touch.current.dx,
        dy =
          (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) -
            (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) || touch.current.dy;
      if (dx || dy) network.send("game:action", { type: "move", dx, dy });
    }, 110);
    const receive = (message: { username: string; text: string }) =>
      setMessages((current) => [...current.slice(-49), message]);
    getGameSocket().on("game:lobby:chat", receive);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      getGameSocket().off("game:lobby:chat", receive);
    };
  }, [sdk, network.send]);
  const name = (id: string) =>
    network.lobby?.players.find((player) => player.id === id)?.username ??
    "Player";
  const near = (x: number, y: number) =>
    self ? Math.hypot(self.x - x, self.y - y) < 12 : false;
  return (
    <div>
      <h2>Night Shift</h2>
      <p className="game-hint">
        4–12 players. Crew restore three assigned instruments. Hidden hostiles
        can eliminate nearby crew and sabotage the beacon. Report bodies,
        discuss, and vote. Move with WASD / arrows or touch controls. Roles are
        private; the server validates every action.
      </p>
      <LobbyControls {...network} gameId="social-deduction" userId={userId} />
      {state?.self && (
        <>
          <div className="game-stats">
            <div className="game-stat">
              <small>Your private role</small>
              <strong
                className={
                  state.self.role === "hostile" ? "danger" : "positive"
                }
              >
                {state.self.role}
              </strong>
            </div>
            <div className="game-stat">
              <small>Expedition tasks</small>
              <strong>
                {state.completedTasks} / {state.totalTasks}
              </strong>
            </div>
            <div className="game-stat">
              <small>Status</small>
              <strong>{state.self.alive ? "Alive" : "Eliminated"}</strong>
            </div>
          </div>
          {state.result && (
            <section className="game-card">
              <h2>{state.result.reason}</h2>
              <p>
                {state.result.winners.includes(userId)
                  ? "Your team won!"
                  : "The other team won."}
              </p>
            </section>
          )}
          {state.sabotageUntil && (
            <p className="game-error">
              Beacon failing in{" "}
              {Math.max(0, Math.ceil((state.sabotageUntil - clock) / 1000))}s.
              Repair at the north console.
            </p>
          )}
          <div
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "1.65",
              background: "radial-gradient(ellipse at center,#28334b,#121b2b)",
              border: "1px solid #35465e",
              borderRadius: 16,
              overflow: "hidden",
            }}
            aria-label="Station map"
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%,-50%)",
                border: "2px dashed #8193b0",
                borderRadius: 14,
                padding: 15,
                color: "#b6c6dd",
                fontSize: 12,
              }}
            >
              Meeting console
            </div>
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "10%",
                transform: "translate(-50%,-50%)",
                color: state.sabotageUntil ? "#ff8096" : "#7edcc9",
              }}
            >
              ▣ Beacon
            </div>
            {state.tasks.map((task, index) => (
              <div
                key={index}
                style={{
                  position: "absolute",
                  left: `${task.x}%`,
                  top: `${task.y}%`,
                  transform: "translate(-50%,-50%)",
                  color: state.self.completed.includes(index)
                    ? "#7d8ca4"
                    : state.self.tasks.includes(index)
                      ? "#c9ff80"
                      : "#607087",
                  fontSize: 12,
                  textAlign: "center",
                }}
              >
                <span style={{ display: "block", fontSize: 25 }}>◇</span>
                {task.label}
              </div>
            ))}
            {state.bodies.map((body) => (
              <button
                key={body.id}
                disabled={!near(body.x, body.y) || !state.self.alive}
                onClick={() =>
                  network.send("game:action", {
                    type: "meeting",
                    bodyId: body.id,
                  })
                }
                style={{
                  position: "absolute",
                  left: `${body.x}%`,
                  top: `${body.y}%`,
                  transform: "translate(-50%,-50%)",
                  padding: 5,
                  background: "#833b54",
                }}
              >
                Report ◈
              </button>
            ))}
            {state.players
              .filter((player) => player.alive)
              .map((player, index) => (
                <div
                  key={player.id}
                  style={{
                    position: "absolute",
                    left: `${player.x}%`,
                    top: `${player.y}%`,
                    transform: "translate(-50%,-50%)",
                    textAlign: "center",
                    zIndex: 2,
                    pointerEvents: "none",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      width: 24,
                      height: 28,
                      margin: "auto",
                      borderRadius: "10px 10px 6px 6px",
                      background:
                        player.id === userId
                          ? "#d0ff94"
                          : `hsl(${index * 47},65%,70%)`,
                      border:
                        player.id === userId
                          ? "2px solid white"
                          : "2px solid #273b55",
                    }}
                  />
                  <small
                    style={{
                      background: "#111a2be0",
                      padding: "2px 5px",
                      borderRadius: 4,
                      color: state.allies.includes(player.id)
                        ? "#ff8796"
                        : "#dee7f6",
                    }}
                  >
                    {name(player.id)}
                    {player.id === userId ? " (you)" : ""}
                  </small>
                </div>
              ))}
          </div>
          {state.phase === "running" && state.self.alive && (
            <>
              <div className="game-row">
                {[
                  [-1, 0, "←"],
                  [0, -1, "↑"],
                  [0, 1, "↓"],
                  [1, 0, "→"],
                ].map(([dx, dy, label]) => (
                  <button
                    key={label}
                    onPointerDown={() => {
                      touch.current = { dx: Number(dx), dy: Number(dy) };
                    }}
                    onPointerUp={() => {
                      touch.current = { dx: 0, dy: 0 };
                    }}
                    onPointerLeave={() => {
                      touch.current = { dx: 0, dy: 0 };
                    }}
                  >
                    {label}
                  </button>
                ))}
                <button
                  disabled={!near(50, 50) || !!state.sabotageUntil || paused}
                  onClick={() =>
                    network.send("game:action", { type: "meeting" })
                  }
                >
                  Emergency meeting ({2 - state.self.meetings})
                </button>
                {state.sabotageUntil && (
                  <button
                    disabled={!near(50, 10) || paused}
                    onClick={() =>
                      network.send("game:action", { type: "repair" })
                    }
                  >
                    Repair beacon
                  </button>
                )}
              </div>
              {state.self.role === "crew" ? (
                <div className="game-row">
                  {state.self.tasks.map((taskId) => (
                    <button
                      key={taskId}
                      disabled={
                        paused ||
                        state.self.completed.includes(taskId) ||
                        !near(state.tasks[taskId].x, state.tasks[taskId].y)
                      }
                      onClick={() =>
                        network.send("game:action", { type: "task", taskId })
                      }
                    >
                      {state.self.completed.includes(taskId) ? "✓ " : ""}
                      {state.tasks[taskId].label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="game-row">
                  <button
                    disabled={paused}
                    onClick={() =>
                      network.send("game:action", { type: "sabotage" })
                    }
                  >
                    Sabotage beacon
                  </button>
                  {state.players
                    .filter(
                      (player) =>
                        player.alive &&
                        player.id !== userId &&
                        !state.allies.includes(player.id),
                    )
                    .map((player) => (
                      <button
                        key={player.id}
                        disabled={
                          paused ||
                          !near(player.x, player.y) ||
                          clock < state.self.cooldownUntil
                        }
                        onClick={() =>
                          network.send("game:action", {
                            type: "eliminate",
                            targetId: player.id,
                          })
                        }
                      >
                        Eliminate {name(player.id)}
                      </button>
                    ))}
                </div>
              )}
            </>
          )}
          {state.phase === "meeting" && (
            <section className="game-card">
              <h3>
                Discuss & vote ·{" "}
                {Math.max(
                  0,
                  Math.ceil(((state.meetingUntil ?? clock) - clock) / 1000),
                )}
                s
              </h3>
              <div className="game-row">
                {state.players
                  .filter((player) => player.alive)
                  .map((player) => (
                    <button
                      key={player.id}
                      disabled={paused || !state.self.alive || !!state.yourVote}
                      onClick={() =>
                        network.send("game:action", {
                          type: "vote",
                          targetId: player.id,
                        })
                      }
                    >
                      {name(player.id)}
                    </button>
                  ))}
                <button
                  disabled={paused || !state.self.alive || !!state.yourVote}
                  onClick={() =>
                    network.send("game:action", {
                      type: "vote",
                      targetId: "skip",
                    })
                  }
                >
                  Skip
                </button>
              </div>
              {state.yourVote && <p>Vote recorded. Waiting for everyone.</p>}
            </section>
          )}
          <section className="game-card" style={{ marginTop: 12 }}>
            <h3>
              {state.self.alive ? "Room discussion" : "Eliminated players chat"}
            </h3>
            <div className="game-log">
              {messages.map((message, index) => (
                <p key={index}>
                  <strong>{message.username}</strong>: {message.text}
                </p>
              ))}
            </div>
            <form
              className="game-row"
              onSubmit={(event) => {
                event.preventDefault();
                network.send("game:lobby:chat", { text: chat });
                setChat("");
              }}
            >
              <input
                aria-label="Lobby message"
                value={chat}
                maxLength={500}
                onChange={(e) => setChat(e.target.value)}
                placeholder="Talk to your room"
              />
              <button>Send</button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
