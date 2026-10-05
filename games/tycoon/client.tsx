"use client";
import { useEffect, useState } from "react";
import { useGameState } from "@tell-aviv/game-runtime";
import type { GameSDK } from "@tell-aviv/game-sdk";
interface Business {
  id: string;
  kind: string;
  level: number;
  workers: number;
  price: number;
}
interface State {
  cash: number;
  businesses: Business[];
  research: number;
  reputation: number;
  totalEarned: number;
  offlineSeconds: number;
  market?: number;
}
const kinds = ["kiosk", "cafe", "factory", "studio"];
const cash = (value: number) =>
  value.toLocaleString("en", { maximumFractionDigits: 0 });
export default function Tycoon({
  sdk,
  paused,
}: {
  sdk: GameSDK;
  paused: boolean;
}) {
  const { state, error, busy, action } = useGameState<State>(sdk);
  const [prices, setPrices] = useState<Record<string, string>>({});
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => void action("state"), 10000);
    return () => clearInterval(timer);
  }, [action, paused]);
  if (!state) return <p>{error || "Opening your portfolio…"}</p>;
  return (
    <div>
      <div className="game-stats">
        {[
          ["Cash", cash(state.cash)],
          ["Reputation", state.reputation],
          ["Research", state.research],
          ["Lifetime revenue", cash(state.totalEarned)],
        ].map(([label, value]) => (
          <div className="game-stat" key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <h2>Build your corner of the city</h2>
      <p className="game-hint">
        Hire workers to automate revenue. Price too high and demand falls; price
        too low and margins vanish. The market runs while you are offline.
        Current demand: {Math.round((state.market ?? 1) * 100)}%.
      </p>
      <div className="game-row">
        {kinds.map((kind) => (
          <button
            key={kind}
            disabled={busy || paused}
            onClick={() => void action("open", { kind })}
          >
            Open {kind}
          </button>
        ))}
        <button
          disabled={busy || paused}
          onClick={() => void action("research")}
        >
          Research efficiency
        </button>
      </div>
      <div className="game-grid">
        {state.businesses.map((business) => (
          <section className="game-card" key={business.id}>
            <h3>{business.kind[0].toUpperCase() + business.kind.slice(1)}</h3>
            <p>
              Facility level {business.level} · {business.workers} workers ·
              price {business.price}
            </p>
            <div className="game-row">
              <button
                disabled={busy || paused}
                onClick={() =>
                  void action("operate", { businessId: business.id })
                }
              >
                Serve customers
              </button>
              <button
                disabled={busy || paused}
                onClick={() => void action("hire", { businessId: business.id })}
              >
                Hire worker
              </button>
              <button
                disabled={busy || paused}
                onClick={() =>
                  void action("upgrade", { businessId: business.id })
                }
              >
                Upgrade
              </button>
            </div>
            <label className="game-row">
              Set price{" "}
              <input
                aria-label={`Price for ${business.kind}`}
                type="number"
                min="1"
                max="1000"
                style={{ width: 90 }}
                value={prices[business.id] ?? business.price}
                onChange={(e) =>
                  setPrices({ ...prices, [business.id]: e.target.value })
                }
              />
              <button
                disabled={busy || paused}
                onClick={() =>
                  void action("price", {
                    businessId: business.id,
                    price: Number(prices[business.id] ?? business.price),
                  })
                }
              >
                Apply
              </button>
            </label>
          </section>
        ))}
      </div>
      {!state.businesses.length && (
        <p className="game-hint">
          Your first business starts with one active counter. Open a kiosk to
          get going.
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
