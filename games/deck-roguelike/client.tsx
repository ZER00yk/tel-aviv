"use client";
import { useState } from "react";
import { useGameState } from "@tell-aviv/game-runtime";
import type { GameSDK } from "@tell-aviv/game-sdk";
import {
  CHARACTER_DEFS,
  RELIC_DEFS,
  getCardDefinition,
  upgradeCardId,
  type EventChoice,
} from "../config/deck";
interface State {
  phase: "map" | "combat" | "reward" | "event" | "rest" | "lost" | "won";
  floor: number;
  hp: number;
  maxHp: number;
  energy: number;
  gold: number;
  block: number;
  character: string;
  mode: string;
  contentVersion?: number;
  hand: string[];
  deck: string[];
  drawCount: number;
  discardCount: number;
  enemy?: {
    name: string;
    hp: number;
    maxHp: number;
    intent: number;
    intentLabel?: string;
    poison: number;
    block?: number;
    weak?: number;
    vulnerable?: number;
    strength?: number;
  };
  rewardCards: string[];
  relics: string[];
  log: string[];
  score: number;
  availableNodes: string[];
  shopCards: string[];
  node: string;
  nextBoss: string;
  removeCost: number;
  strength: number;
  dexterity: number;
  weak: number;
  vulnerable: number;
  exhausted: string[];
  retainBlock: boolean;
  exhaustDraw: number;
  exhaustBlock: number;
  skillPoison: number;
  attackBlock: number;
  nextEnergy: number;
  event?: {
    name: string;
    description: string;
    choices: (EventChoice & { unavailable?: boolean })[];
  };
}
export default function Deck({
  sdk,
  paused,
}: {
  sdk: GameSDK;
  paused: boolean;
}) {
  const { state, error, busy, action } = useGameState<State>(sdk);
  const [character, setCharacter] = useState("striker"),
    [showDeck, setShowDeck] = useState(false);
  if (!state) return <p>{error || "Opening the archive…"}</p>;
  const disabled = busy || paused;
  const currentCharacter =
    CHARACTER_DEFS[state.character as keyof typeof CHARACTER_DEFS];
  return (
    <div>
      <div className="game-stats">
        {[
          ["Health", `${state.hp}/${state.maxHp}`],
          ["Energy", state.energy],
          ["Block", state.block],
          ["Gold", state.gold],
          ["Floor", `${state.floor}/12`],
        ].map(([label, value]) => (
          <div className="game-stat" key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="game-row">
        <select
          aria-label="Starting character"
          value={character}
          onChange={(e) => setCharacter(e.target.value)}
        >
          <option value="striker">Striker · heavy hits</option>
          <option value="warden">Warden · sturdy defense</option>
          <option value="spark">Spark · ink damage</option>
        </select>
        <button
          disabled={disabled}
          onClick={() => void action("start", { character, mode: "campaign" })}
        >
          New expedition
        </button>
        <button
          disabled={disabled}
          onClick={() => void action("start", { character, mode: "daily" })}
        >
          Daily seeded run
        </button>
        <button onClick={() => setShowDeck((v) => !v)}>
          Deck ({state.deck.length})
        </button>
      </div>
      <p className="game-hint">
        {state.mode === "daily" ? "Daily expedition" : "Campaign expedition"} ·{" "}
        {currentCharacter?.name ?? state.character}
        {state.contentVersion === 2 && `: ${currentCharacter?.description}`}
      </p>
      {state.relics.length > 0 && (
        <details className="game-card" style={{ marginBottom: 12 }}>
          <summary>Relics ({state.relics.length})</summary>
          <ul>
            {state.relics.map((id) => (
              <li key={id}>
                <strong>{RELIC_DEFS[id]?.name ?? id}</strong> ·{" "}
                {RELIC_DEFS[id]?.description}
              </li>
            ))}
          </ul>
        </details>
      )}
      {state.phase === "map" && (
        <section className="game-card">
          <h2>Choose your path</h2>
          <p className="game-hint">
            {state.contentVersion === 2
              ? `Guardians await on floors 4, 8, and 12. Next: ${state.nextBoss}. Elites award relics; reading rooms offer healing or upgrades.`
              : "The archive has twelve floors. Elites award relics; quiet rooms restore health."}
          </p>
          {state.shopCards.length > 0 || state.node === "shop" ? (
            <>
              <h3>Bookstall · 45 gold each</h3>
              <div className="game-grid">
                {state.shopCards.map((card) => (
                  <Card
                    key={card}
                    cardId={card}
                    disabled={disabled || state.gold < 45}
                    label="Buy · 45 gold"
                    onClick={() => void action("shop", { card })}
                  />
                ))}
              </div>
              {state.node === "shop" && (
                <DeckPicker
                  deck={state.deck}
                  mode="remove"
                  disabled={
                    disabled ||
                    state.gold < state.removeCost ||
                    state.deck.length <= 5
                  }
                  label={`Remove · ${state.removeCost} gold`}
                  onClick={(deckIndex) => void action("remove", { deckIndex })}
                />
              )}
              <p className="game-hint">
                Leave the bookstall by choosing your next route.
              </p>
            </>
          ) : null}
          <div className="game-row">
            {state.availableNodes.map((node) => (
              <button
                key={node}
                disabled={disabled}
                onClick={() => void action("choose", { node })}
              >
                {(
                  {
                    combat: "⚔ Battle",
                    elite: "◆ Elite",
                    rest: "☾ Reading room",
                    shop: "▧ Bookstall",
                    event: "? Event",
                    boss: `♛ ${state.nextBoss ?? "Guardian"}`,
                  } as Record<string, string>
                )[node] ?? node}
              </button>
            ))}
          </div>
        </section>
      )}
      {state.phase === "rest" && (
        <section className="game-card">
          <h2>A quiet reading room</h2>
          <p>
            Recover {Math.ceil(state.maxHp * 0.3)} health, or upgrade one card.
            Upgrades last for this expedition.
          </p>
          <button
            disabled={disabled}
            onClick={() => void action("rest", { choice: "heal" })}
          >
            Rest · recover health
          </button>
          <DeckPicker
            deck={state.deck}
            mode="upgrade"
            disabled={disabled}
            label="Upgrade this card"
            onClick={(deckIndex) =>
              void action("rest", { choice: "upgrade", deckIndex })
            }
          />
        </section>
      )}
      {state.phase === "event" && state.event && (
        <section className="game-card">
          <h2>{state.event.name}</h2>
          <p>{state.event.description}</p>
          <div className="game-grid">
            {state.event.choices.map((choice) => (
              <section className="game-card" key={choice.id}>
                <h3>{choice.label}</h3>
                <p>{choice.description}</p>
                {choice.remove || choice.upgrade ? (
                  <DeckPicker
                    deck={state.deck}
                    mode={choice.upgrade ? "upgrade" : "remove"}
                    disabled={disabled || !!choice.unavailable}
                    label={choice.label}
                    onClick={(deckIndex) =>
                      void action("event", { choice: choice.id, deckIndex })
                    }
                  />
                ) : (
                  <button
                    disabled={disabled || !!choice.unavailable}
                    onClick={() => void action("event", { choice: choice.id })}
                  >
                    {choice.label}
                  </button>
                )}
                {choice.unavailable && <small>Requirements are not met.</small>}
              </section>
            ))}
          </div>
        </section>
      )}
      {state.phase === "combat" && state.enemy && (
        <>
          <section
            className="game-card"
            style={{
              textAlign: "center",
              background: "linear-gradient(120deg,#2d263c,#182637)",
            }}
          >
            <div style={{ fontSize: 68 }}>◈</div>
            <h2>{state.enemy.name}</h2>
            <progress
              aria-label="Enemy health"
              value={Math.max(0, state.enemy.hp)}
              max={state.enemy.maxHp}
            />
            <p>
              {state.enemy.hp} HP · intent:{" "}
              <strong className="danger">
                {state.enemy.intentLabel ?? `Attack ${state.enemy.intent}`}
              </strong>
            </p>
            <p>
              {[
                state.enemy.poison ? `${state.enemy.poison} ink` : "",
                state.enemy.block ? `${state.enemy.block} block` : "",
                state.enemy.weak ? `${state.enemy.weak} weak` : "",
                state.enemy.vulnerable
                  ? `${state.enemy.vulnerable} vulnerable`
                  : "",
                state.enemy.strength ? `${state.enemy.strength} strength` : "",
              ]
                .filter(Boolean)
                .join(" · ") || "No enemy statuses"}
            </p>
          </section>
          <p className="game-hint">
            Draw pile {state.drawCount} · discard {state.discardCount} ·
            exhausted {state.exhausted?.length ?? 0}. Ink ticks before enemy
            actions.{" "}
            {state.retainBlock
              ? "Leftover block carries into your next turn."
              : "Block expires between turns unless a relic retains it."}
          </p>
          <p className="game-hint">
            {[
              `${state.strength} strength`,
              `${state.dexterity ?? 0} dexterity`,
              state.weak ? `${state.weak} weak` : "",
              state.vulnerable ? `${state.vulnerable} vulnerable` : "",
              state.exhaustDraw ? `Exhaust → draw ${state.exhaustDraw}` : "",
              state.exhaustBlock ? `Exhaust → ${state.exhaustBlock} block` : "",
              state.skillPoison ? `Non-attack → ${state.skillPoison} ink` : "",
              state.attackBlock ? `Attack → ${state.attackBlock} block` : "",
              state.nextEnergy ? `Next turn +${state.nextEnergy} energy` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="game-grid">
            {state.hand.map((card, index) => (
              <Card
                key={`${card}-${index}`}
                cardId={card}
                disabled={
                  disabled ||
                  (getCardDefinition(card)?.cost ?? 100) > state.energy ||
                  state.hp <= (getCardDefinition(card)?.lifeCost ?? 0)
                }
                onClick={() => void action("play", { handIndex: index })}
              />
            ))}
          </div>
          <div className="game-row">
            <button disabled={disabled} onClick={() => void action("endTurn")}>
              End turn →
            </button>
          </div>
        </>
      )}
      {state.phase === "reward" && (
        <section className="game-card">
          <h2>A new page in your story</h2>
          <div className="game-grid">
            {state.rewardCards.map((card) => (
              <Card
                key={card}
                cardId={card}
                disabled={disabled}
                label="Add to deck"
                onClick={() => void action("reward", { card })}
              />
            ))}
          </div>
          <button
            style={{ marginTop: 12 }}
            disabled={disabled}
            onClick={() => void action("reward", { card: "skip" })}
          >
            Skip reward
          </button>
        </section>
      )}
      {(state.phase === "won" || state.phase === "lost") && (
        <section className="game-card">
          <h2>
            {state.phase === "won"
              ? "The archive is yours."
              : "Every story has another beginning."}
          </h2>
          <p>
            Run score: {state.score}. Your outcome was resolved by the server.
          </p>
        </section>
      )}
      {showDeck && (
        <div className="game-card" style={{ marginTop: 14 }}>
          <h3>Your expedition deck</h3>
          {Object.entries(
            state.deck.reduce<Record<string, number>>(
              (all, id) => ({ ...all, [id]: (all[id] ?? 0) + 1 }),
              {},
            ),
          ).map(([id, count]) => (
            <p key={id}>
              <strong>
                {getCardDefinition(id)?.name ?? id} ×{count}
              </strong>{" "}
              · {getCardDefinition(id)?.description}
            </p>
          ))}
        </div>
      )}
      <div className="game-log" aria-live="polite" style={{ marginTop: 14 }}>
        {state.log.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
      {error && (
        <p className="game-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function DeckPicker({
  deck,
  mode,
  disabled,
  label,
  onClick,
}: {
  deck: string[];
  mode: "upgrade" | "remove";
  disabled: boolean;
  label: string;
  onClick: (index: number) => void;
}) {
  const [selected, setSelected] = useState("0");
  const options = deck
    .map((id, index) => ({ id, index }))
    .filter(({ id }) => mode !== "upgrade" || !!upgradeCardId(id));
  const index = options.some((entry) => entry.index === Number(selected))
    ? Number(selected)
    : options[0]?.index;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="game-row">
        <select
          aria-label={mode === "upgrade" ? "Card to upgrade" : "Card to remove"}
          disabled={disabled || !options.length}
          value={index ?? ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          {options.length ? (
            options.map(({ id, index }) => (
              <option key={index} value={index}>
                {index + 1}. {getCardDefinition(id)?.name ?? id}
              </option>
            ))
          ) : (
            <option value="">No eligible cards</option>
          )}
        </select>
        <button
          disabled={disabled || index === undefined}
          onClick={() => index !== undefined && onClick(index)}
        >
          {label}
        </button>
      </div>
      {mode === "upgrade" && index !== undefined && (
        <p className="game-hint">
          {getCardDefinition(upgradeCardId(deck[index])!)?.description}
        </p>
      )}
    </div>
  );
}
function Card({
  cardId,
  disabled,
  label = "Play card",
  onClick,
}: {
  cardId: string;
  disabled: boolean;
  label?: string;
  onClick: () => void;
}) {
  const card = getCardDefinition(cardId);
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        textAlign: "left",
        minHeight: 150,
        background: "#eee8d7",
        color: "#312b48",
        padding: 18,
        border: "2px solid #cfc1a4",
      }}
    >
      <span
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 700,
          color: "#685488",
        }}
      >
        ⚡ {card?.cost ?? "?"} ENERGY · {card?.archetype ?? "utility"}
      </span>
      <h3>{card?.name ?? cardId}</h3>
      <p style={{ lineHeight: 1.5, minHeight: 40 }}>{card?.description}</p>
      <small>{label} →</small>
    </button>
  );
}
