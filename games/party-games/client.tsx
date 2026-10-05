"use client";
import { useEffect, useRef, useState } from "react";
import {
  useLobby,
  LobbyControls,
  type LobbyView,
} from "@tell-aviv/game-runtime";
import type { GameSDK } from "@tell-aviv/game-sdk";
import { questions } from "./questions";
interface Stroke {
  points: { x: number; y: number }[];
  color: string;
}
export default function PartyGames({
  sdk,
  paused,
}: {
  sdk: GameSDK;
  paused: boolean;
}) {
  const network = useLobby();
  const [userId, setUserId] = useState(""),
    [mode, setMode] = useState("reaction");
  useEffect(() => {
    void sdk.user().then((user) => setUserId(user.id));
  }, [sdk]);
  useEffect(() => {
    if (
      network.lobby &&
      ["reaction", "trivia", "drawing"].includes(network.lobby.gameId)
    )
      setMode(network.lobby.gameId);
  }, [network.lobby?.gameId]);
  const change = (next: string) => {
    if (network.lobby) network.send("game:lobby:leave");
    setMode(next);
  };
  const remote = network.lobby?.gameId === mode ? network.lobby : null;
  return (
    <div>
      <div className="game-tabs">
        {["reaction", "trivia", "drawing"].map((game) => (
          <button
            className={mode === game ? "selected" : ""}
            key={game}
            onClick={() => change(game)}
          >
            {game[0].toUpperCase() + game.slice(1)}
          </button>
        ))}
      </div>
      {mode === "reaction" && (
        <Reaction
          paused={paused}
          userId={userId}
          lobby={remote}
          send={network.send}
        />
      )}{" "}
      {mode === "trivia" && (
        <Trivia
          paused={paused}
          userId={userId}
          lobby={remote}
          send={network.send}
        />
      )}{" "}
      {mode === "drawing" && (
        <Drawing
          paused={paused}
          userId={userId}
          lobby={remote}
          send={network.send}
        />
      )}
      <Scores lobby={remote} />
      <LobbyControls {...network} gameId={mode} userId={userId} />
    </div>
  );
}
type Props = {
  paused: boolean;
  userId: string;
  lobby: LobbyView | null;
  send: (event: string, payload?: Record<string, unknown>) => void;
};
function Reaction({ paused, userId, lobby, send }: Props) {
  const [phase, setPhase] = useState<"idle" | "wait" | "go" | "result">("idle"),
    [message, setMessage] = useState("");
  const started = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (paused && timer.current) {
      clearTimeout(timer.current);
      setPhase("idle");
    }
  }, [paused]);
  const begin = () => {
    if (paused) return;
    setPhase("wait");
    setMessage("Wait for green…");
    timer.current = setTimeout(
      () => {
        started.current = performance.now();
        setPhase("go");
        setMessage("GO!");
      },
      1200 + Math.random() * 2600,
    );
  };
  const remote = lobby?.status === "playing" ? lobby.state : null;
  const reacted =
    Array.isArray(remote?.reacted) &&
    (remote?.reacted as string[]).includes(userId);
  const signal = remote ? !!remote.signal : phase === "go";
  const react = () => {
    if (paused) return;
    if (remote) {
      send("game:action", { type: "react" });
      return;
    }
    if (phase === "wait") {
      if (timer.current) clearTimeout(timer.current);
      setPhase("result");
      setMessage("Too early. Try again!");
    } else if (phase === "go") {
      setMessage(
        `${Math.round(performance.now() - started.current)} ms · nice reflexes`,
      );
      setPhase("result");
    } else begin();
  };
  return (
    <>
      <h2>First to the signal</h2>
      <p className="game-hint">
        Click only after the panel turns green. Early clicks lose points. Solo
        reaction times are practice; multiplayer scores use server timestamps.
      </p>
      {remote && (
        <p>
          Round {Number(remote.round) + 1} / {String(remote.rounds)}
        </p>
      )}
      <button
        onClick={react}
        disabled={paused || reacted}
        style={{
          width: "100%",
          height: 250,
          fontSize: 32,
          background: signal ? "#49732b" : "#253246",
          color: signal ? "#ecffdc" : "#d7e1f2",
        }}
      >
        {remote
          ? reacted
            ? "Response recorded"
            : signal
              ? "GO!"
              : "Wait for green…"
          : message || "Click to begin"}
      </button>
      {!remote && phase === "result" && (
        <button onClick={begin} style={{ marginTop: 10 }}>
          Again
        </button>
      )}
    </>
  );
}
function Trivia({ paused, userId, lobby, send }: Props) {
  const [question, setQuestion] = useState(0),
    [score, setScore] = useState(0),
    [answered, setAnswered] = useState(false),
    [message, setMessage] = useState("");
  const q = questions[question % questions.length],
    remote = lobby?.status === "playing" ? lobby.state : null;
  const hasAnswered = remote
    ? Array.isArray(remote.answered) &&
      (remote.answered as string[]).includes(userId)
    : answered;
  const options =
    remote && Array.isArray(remote.options)
      ? (remote.options as string[])
      : q.answers;
  return (
    <section className="game-card">
      <p>
        {remote
          ? `Round ${Number(remote.round) + 1} / ${String(remote.rounds)}`
          : `Solo warmup · ${score} correct · question ${question + 1}`}
      </p>
      <h2>{remote ? String(remote.question) : q.question}</h2>
      <div className="game-grid">
        {options.map((answer, index) => (
          <button
            key={answer}
            disabled={paused || hasAnswered}
            onClick={() => {
              if (remote)
                send("game:action", { type: "answer", answer: index });
              else {
                setAnswered(true);
                if (index === q.answer) setScore(score + 1);
                setMessage(
                  index === q.answer
                    ? "Correct!"
                    : `Answer: ${q.answers[q.answer]}`,
                );
              }
            }}
          >
            {answer}
          </button>
        ))}
      </div>
      <p className="positive">
        {remote
          ? hasAnswered
            ? "Answer recorded. Waiting for the next question."
            : ""
          : message}
      </p>
      {!remote && answered && (
        <button
          onClick={() => {
            setQuestion(question + 1);
            setAnswered(false);
            setMessage("");
          }}
        >
          Next question
        </button>
      )}
    </section>
  );
}
function Drawing({ paused, userId, lobby, send }: Props) {
  const [guess, setGuess] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    drawing = useRef(false),
    points = useRef<{ x: number; y: number }[]>([]),
    lastSent = useRef(0);
  const remote = lobby?.status === "playing" ? lobby.state : null;
  const drawer = remote ? remote.drawerId === userId : true;
  const strokes = remote?.strokes;
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !Array.isArray(strokes)) return;
    ctx.clearRect(0, 0, 600, 400);
    for (const stroke of strokes as Stroke[]) paint(ctx, stroke);
  }, [strokes]);
  const flush = () => {
    if (points.current.length && remote) {
      send("game:action", {
        type: "stroke",
        points: points.current,
        color: "#bfff72",
      });
      const last = points.current.at(-1)!;
      points.current = [last];
      lastSent.current = performance.now();
    }
  };
  const stroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || paused || !drawer) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: Math.min(
        600,
        Math.max(0, ((event.clientX - rect.left) / rect.width) * 600),
      ),
      y: Math.min(
        400,
        Math.max(0, ((event.clientY - rect.top) / rect.height) * 400),
      ),
    };
    const previous = points.current.at(-1) ?? point;
    points.current.push(point);
    const ctx = event.currentTarget.getContext("2d");
    if (ctx) paint(ctx, { color: "#bfff72", points: [previous, point] });
    if (
      performance.now() - lastSent.current > 120 ||
      points.current.length >= 100
    )
      flush();
  };
  return (
    <>
      <h2>Draw & guess</h2>
      <p className="game-hint">
        Sketch a clue. In multiplayer, only the drawer sees the secret word and
        guesses are checked by the server.
      </p>
      <p className="positive">
        {remote
          ? drawer
            ? `Your secret word: ${String(remote.word)}`
            : `Guess the ${String(remote.wordLength)} letter word. Drawer: ${lobby?.players.find((p) => p.id === remote.drawerId)?.username ?? "player"}`
          : "Solo canvas · make a masterpiece"}
      </p>
      <canvas
        ref={canvas}
        width={600}
        height={400}
        style={{
          width: "100%",
          background: "#152032",
          border: "1px solid #35445c",
          borderRadius: 12,
          touchAction: "none",
          cursor: drawer ? "crosshair" : "default",
        }}
        onPointerDown={(event) => {
          if (!drawer) return;
          drawing.current = true;
          points.current = [];
          event.currentTarget.setPointerCapture(event.pointerId);
          stroke(event);
        }}
        onPointerMove={stroke}
        onPointerUp={() => {
          drawing.current = false;
          flush();
          points.current = [];
        }}
      />
      <div className="game-row">
        {!remote && (
          <button
            onClick={() =>
              canvas.current?.getContext("2d")?.clearRect(0, 0, 600, 400)
            }
          >
            Clear canvas
          </button>
        )}
        {remote && !drawer && (
          <form
            className="game-row"
            onSubmit={(event) => {
              event.preventDefault();
              send("game:action", { type: "guess", text: guess });
              setGuess("");
            }}
          >
            <input
              value={guess}
              onChange={(event) => setGuess(event.target.value)}
              aria-label="Drawing guess"
              placeholder="Your guess"
              maxLength={80}
            />
            <button disabled={paused}>Guess</button>
          </form>
        )}
      </div>
      {remote?.previousWord && (
        <p className="game-hint">
          Previous word: {String(remote.previousWord)}
        </p>
      )}
    </>
  );
}
function paint(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (stroke.points.length === 1) {
    ctx.arc(stroke.points[0].x, stroke.points[0].y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    stroke.points.forEach((point, index) =>
      index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y),
    );
    ctx.stroke();
  }
}
function Scores({ lobby }: { lobby: LobbyView | null }) {
  const scores = lobby?.state?.scores as Record<string, number> | undefined;
  const result = lobby?.state?.result as
    { reason: string; winners: string[] } | undefined;
  if (!scores && !result) return null;
  return (
    <section className="game-card" style={{ margin: "12px 0" }}>
      {result && <h3>{result.reason}</h3>}
      <div className="game-row">
        {lobby?.players.map((player) => (
          <span key={player.id}>
            {player.username}: <strong>{scores?.[player.id] ?? 0}</strong>
            {result?.winners.includes(player.id) ? " 🏆" : ""}
          </span>
        ))}
      </div>
    </section>
  );
}
