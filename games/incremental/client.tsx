"use client";
import { useEffect } from "react";
import { useGameState } from "@tell-aviv/game-runtime";
import type { GameSDK } from "@tell-aviv/game-sdk";
interface State {
  spark: number;
  alloy: number;
  insight: number;
  machines: { extractor: number; smelter: number; lab: number };
  upgrades: { efficiency: number; automation: number };
  prestige: number;
  ascensions: number;
  totalProduced: number;
  offlineSeconds: number;
}
const fmt = (n: number) =>
  Intl.NumberFormat("en", {
    notation: n >= 100000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(n);
const machines = [
  {
    id: "extractor",
    name: "Spark extractor",
    icon: "⚡",
    description:
      "Pulls raw Spark out of the static. The foundation of every production chain.",
  },
  {
    id: "smelter",
    name: "Alloy smelter",
    icon: "▰",
    description:
      "Consumes Spark to produce Alloy. Materials unlock stronger automation.",
  },
  {
    id: "lab",
    name: "Research lab",
    icon: "✧",
    description:
      "Consumes Alloy to produce Insight. Unlocks the next layer of industry.",
  },
] as const;
export default function Incremental({
  sdk,
  paused,
}: {
  sdk: GameSDK;
  paused: boolean;
}) {
  const { state, error, busy, action } = useGameState<State>(sdk);
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      void action("state");
    }, 8000);
    return () => clearInterval(timer);
  }, [action, paused]);
  if (!state) return <p>{error || "Connecting to your foundry…"}</p>;
  return (
    <div>
      <div className="game-stats">
        {[
          ["Spark", state.spark],
          ["Alloy", state.alloy],
          ["Insight", state.insight],
          ["Prestige", state.prestige],
          ["Ascensions", state.ascensions],
        ].map(([name, value]) => (
          <div className="game-stat" key={name}>
            <small>{name}</small>
            <strong>{fmt(Number(value))}</strong>
          </div>
        ))}
      </div>
      {state.offlineSeconds > 30 && (
        <p className="positive">
          Your factory worked for {Math.floor(state.offlineSeconds / 60)}{" "}
          minutes while you were away. Production is calculated using the server
          clock.
        </p>
      )}
      <div className="game-row">
        <button
          className="selected"
          style={{ padding: "22px 38px", fontSize: 20 }}
          disabled={busy || paused}
          onClick={() => void action("tap")}
        >
          ⚡ Capture a spark
        </button>
        <span className="game-hint">Build → refine → research → reinvent.</span>
      </div>
      <div className="game-grid">
        {machines.map((machine) => (
          <section key={machine.id} className="game-card">
            <h3>
              {machine.icon} {machine.name}
            </h3>
            <strong>{state.machines[machine.id]} installed</strong>
            <p>{machine.description}</p>
            <button
              disabled={busy || paused}
              onClick={() => void action("buy", { machine: machine.id })}
            >
              Build one
            </button>
            <button
              style={{ marginLeft: 8 }}
              disabled={busy || paused}
              onClick={() =>
                void action("buy", { machine: machine.id, quantity: 5 })
              }
            >
              Build 5
            </button>
          </section>
        ))}
      </div>
      <div className="game-grid" style={{ marginTop: 14 }}>
        <section className="game-card">
          <h3>Research & automation</h3>
          <p>
            Improve the entire chain with Insight. Automation makes manual
            production stronger.
          </p>
          <div className="game-row">
            <button
              disabled={busy || paused}
              onClick={() => void action("upgrade", { upgrade: "efficiency" })}
            >
              Efficiency · Lv {state.upgrades.efficiency}
            </button>
            <button
              disabled={busy || paused}
              onClick={() => void action("upgrade", { upgrade: "automation" })}
            >
              Automation · Lv {state.upgrades.automation}
            </button>
          </div>
        </section>
        <section className="game-card">
          <h3>The next horizon</h3>
          <p>
            Prestige resets machines and resources for permanent production
            power. Ascension unlocks a deeper reset layer. Requirements are
            enforced by the server.
          </p>
          <div className="game-row">
            <button
              disabled={busy || paused}
              onClick={() => void action("prestige")}
            >
              Prestige
            </button>
            <button
              disabled={busy || paused}
              onClick={() => void action("ascend")}
            >
              Ascend
            </button>
          </div>
          <small>Lifetime output: {fmt(state.totalProduced)} Spark</small>
        </section>
      </div>
      {error && (
        <p role="alert" className="game-error">
          {error}
        </p>
      )}
      {paused && (
        <p className="game-hint">
          Paused · your automated factory continues on the server.
        </p>
      )}
    </div>
  );
}
