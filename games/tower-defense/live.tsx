"use client";
import { useEffect, useState } from "react";
import { LobbyControls, useLobby } from "@tell-aviv/game-runtime";
import type { GameSDK } from "@tell-aviv/game-sdk";
import {
  TOWER_DEFS,
  TOWER_MAPS,
  ENEMY_DEFS,
  towerMap,
  pathTile,
  waveKinds,
  type TowerKind,
  type TowerMapId,
  type TowerMode,
} from "../config/tower";
import type { DefenseView } from "./authority";

export function LiveDefense({
  sdk,
  paused,
  onLobbyChange,
}: {
  sdk: GameSDK;
  paused: boolean;
  onLobbyChange: (joined: boolean) => void;
}) {
  const network = useLobby();
  const [userId, setUserId] = useState("");
  const [kind, setKind] = useState<TowerKind>("rapid");
  const [selected, setSelected] = useState("");
  const [map, setMap] = useState<TowerMapId>("boulevard");
  const [mode, setMode] = useState<TowerMode>("campaign");
  const state =
    network.lobby?.gameId === "tower-defense"
      ? (network.lobby.state as unknown as DefenseView | null)
      : null;
  useEffect(() => {
    onLobbyChange(Boolean(network.lobby));
  }, [network.lobby, onLobbyChange]);
  useEffect(() => {
    let active = true;
    void sdk
      .user()
      .then((user) => {
        if (active) setUserId(user.id);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [sdk]);
  useEffect(() => {
    if (network.connected) network.send("game:lobby:recover");
  }, [network.connected, network.send]);
  const command = (type: string, payload: Record<string, unknown> = {}) => {
    if (!state || paused || !network.connected) return;
    network.send("game:action", {
      type,
      ...payload,
      revision: state.commandRevision,
      requestId: crypto.randomUUID(),
    });
  };
  const tower = state?.towers.find((t) => t.id === selected);
  const buildable = Boolean(
    state &&
    !state.result &&
    (state.phase === "build" || state.phase === "wave"),
  );
  const disabled = paused || !network.connected || !buildable;
  const currentMap = towerMap(state?.map);
  return (
    <div>
      <p className="game-hint">
        Two to four friends share one defense. Build, upgrade, sell and change
        targets during live waves. The host sends waves; combat continues while
        a player is away and pauses when everyone disconnects.
      </p>
      <LobbyControls gameId="tower-defense" userId={userId} {...network} />
      {network.lobby && network.lobby.gameId !== "tower-defense" && (
        <p role="alert">
          Leave your other game room before creating a defense.
        </p>
      )}
      {state && (
        <>
          <h3>
            {TOWER_MAPS[state.map].name} · Live{" "}
            {state.mode === "campaign" ? "campaign" : "endless defense"}
          </h3>
          <div className="game-stats" aria-live="polite">
            <span>
              Shared cash:{" "}
              <strong data-testid="live-defense-cash">{state.cash}</strong>
            </span>
            <span>
              Lives: <strong>{state.lives}</strong>
            </span>
            <span>
              Wave:{" "}
              <strong data-testid="live-defense-wave">{state.wave}</strong>
            </span>
            <span>
              Kills:{" "}
              <strong data-testid="live-defense-kills">{state.kills}</strong>
            </span>
          </div>
          <p data-testid="live-defense-phase">
            {state.phase === "wave"
              ? `Wave in progress · ${state.remaining} enemies remaining`
              : state.phase === "upgrade"
                ? "Choose the shared wave reward"
                : state.phase === "build"
                  ? "Build defenses or send the next wave"
                  : state.result?.reason}
          </p>
          {state.wave === 0 &&
            !state.towers.length &&
            network.lobby?.hostId === userId && (
              <fieldset disabled={paused || !network.connected}>
                <legend>Choose this defense</legend>
                <label>
                  Live defense map{" "}
                  <select
                    aria-label="Live defense map"
                    value={map}
                    onChange={(e) => setMap(e.target.value as TowerMapId)}
                  >
                    {Object.entries(TOWER_MAPS).map(([id, map]) => (
                      <option value={id} key={id}>
                        {map.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Live defense mode{" "}
                  <select
                    aria-label="Live defense mode"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as TowerMode)}
                  >
                    <option value="campaign">20-wave campaign</option>
                    <option value="endless">Endless</option>
                  </select>
                </label>
                <button onClick={() => command("configure", { map, mode })}>
                  Set defense map
                </button>
              </fieldset>
            )}
          <div className="game-row" aria-label="Live tower choices">
            {Object.entries(TOWER_DEFS).map(([id, def]) => (
              <button
                key={id}
                aria-pressed={kind === id}
                disabled={disabled}
                onClick={() => setKind(id as TowerKind)}
              >
                {def.name} · {def.cost}
              </button>
            ))}
          </div>
          <div
            aria-label="Live defense arena"
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "8 / 5",
              maxWidth: 800,
              background: "#142034",
            }}
          >
            {Array.from({ length: 40 }, (_, i) => {
              const x = i % 8,
                y = Math.floor(i / 8),
                occupied = state.towers.find((t) => t.x === x && t.y === y),
                onPath = pathTile(currentMap, x, y);
              return (
                <button
                  key={i}
                  aria-label={
                    occupied
                      ? `${TOWER_DEFS[occupied.kind].name} tower at ${x}, ${y}`
                      : `Build ${TOWER_DEFS[kind].name} at ${x}, ${y}`
                  }
                  aria-pressed={occupied ? occupied.id === selected : false}
                  disabled={onPath || (!occupied && disabled)}
                  onClick={() =>
                    occupied
                      ? setSelected(occupied.id)
                      : command("place", { kind, x, y })
                  }
                  style={{
                    position: "absolute",
                    left: `${x * 12.5}%`,
                    top: `${y * 20}%`,
                    width: "12.5%",
                    height: "20%",
                    borderRadius: 3,
                    padding: 2,
                    border:
                      occupied?.id === selected
                        ? "2px solid #fff"
                        : "1px solid #465468",
                    background: onPath
                      ? "#40505b"
                      : occupied
                        ? "#325845"
                        : "#20314a",
                    color: "#fff",
                    fontSize: 12,
                  }}
                >
                  {occupied && (
                    <>
                      {TOWER_DEFS[occupied.kind].name}
                      <br />
                      Lv {occupied.level}
                    </>
                  )}
                </button>
              );
            })}
            <svg
              viewBox="0 0 800 500"
              aria-label="Server enemy positions"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            >
              {currentMap.routes.map((route, i) => (
                <polyline
                  key={i}
                  points={route
                    .map((p) => `${p.x * 100 + 50},${p.y * 100 + 50}`)
                    .join(" ")}
                  fill="none"
                  stroke="#91b3ad"
                  strokeWidth={3}
                  opacity={0.6}
                />
              ))}
              {currentMap.bonusTiles.map((t) => (
                <rect
                  key={`${t.x}:${t.y}`}
                  x={t.x * 100 + 8}
                  y={t.y * 100 + 8}
                  width={84}
                  height={84}
                  fill="none"
                  stroke={t.kind === "high-ground" ? "#76caff" : "#ffe379"}
                  strokeWidth={3}
                />
              ))}
              {state.events
                .filter((e) => e.type === "shot")
                .map((e, i) => {
                  const t = state.towers.find((t) => t.id === e.towerId);
                  return (
                    t && (
                      <line
                        key={i}
                        x1={t.x * 100 + 50}
                        y1={t.y * 100 + 50}
                        x2={e.x * 100 + 50}
                        y2={(e.y ?? 2) * 100 + 50}
                        stroke="#cfff86"
                        strokeWidth={2}
                        opacity={0.6}
                      />
                    )
                  );
                })}
              {state.enemies.map((e) => (
                <g
                  key={e.id}
                  data-live-enemy-id={e.id}
                  transform={`translate(${e.x * 100 + 50}, ${e.y * 100 + 50})`}
                >
                  <title>
                    {e.bossName ?? ENEMY_DEFS[e.kind].name}: {Math.ceil(e.hp)}{" "}
                    health
                  </title>
                  <circle
                    r={e.kind === "boss" ? 22 : 13}
                    fill={
                      e.burning ? "#ff894d" : e.slowed ? "#84dbff" : "#ff829e"
                    }
                    stroke={
                      e.shield ? "#8fd4ff" : e.marked ? "#cfff86" : "#361e38"
                    }
                    strokeWidth={3}
                  />
                  <rect x={-17} y={-29} width={34} height={5} fill="#21304a" />
                  <rect
                    x={-17}
                    y={-29}
                    width={(34 * e.hp) / e.maxHp}
                    height={5}
                    fill="#abff83"
                  />
                </g>
              ))}
            </svg>
          </div>
          {tower && (
            <fieldset disabled={disabled}>
              <legend>
                {TOWER_DEFS[tower.kind].name} at {tower.x}, {tower.y} · Level{" "}
                {tower.level}
              </legend>
              <button
                disabled={disabled || tower.level >= 5}
                onClick={() => command("upgrade", { towerId: tower.id })}
              >
                Upgrade selected tower ·{" "}
                {Math.ceil(TOWER_DEFS[tower.kind].cost * tower.level * 0.8)}
              </button>
              <button onClick={() => command("sell", { towerId: tower.id })}>
                Sell selected tower
              </button>
              <label>
                Live targeting priority{" "}
                <select
                  aria-label="Live targeting priority"
                  value={tower.target ?? "first"}
                  onChange={(e) =>
                    command("target", {
                      towerId: tower.id,
                      target: e.target.value,
                    })
                  }
                >
                  <option value="first">First</option>
                  <option value="strongest">Strongest</option>
                  <option value="support">Support enemies</option>
                </select>
              </label>
            </fieldset>
          )}
          {state.phase === "build" && network.lobby?.hostId === userId && (
            <button
              disabled={disabled || !state.towers.length}
              onClick={() => command("wave")}
            >
              Send live wave {state.wave + 1}
            </button>
          )}
          {state.phase === "upgrade" && (
            <div className="game-row">
              {state.offeredUpgrades.map((upgrade) => (
                <button
                  key={upgrade}
                  disabled={paused || !network.connected}
                  onClick={() => command("choose", { upgrade })}
                >
                  Choose shared {upgrade}
                </button>
              ))}
            </div>
          )}
          {state.phase === "build" && (
            <p className="game-hint">
              Incoming:{" "}
              {[...new Set(waveKinds(state.wave + 1))]
                .map((kind) => ENEMY_DEFS[kind].name)
                .join(" · ")}
            </p>
          )}
          {state.lastWave && (
            <p>
              Last wave: {state.lastWave.kills} defeated ·{" "}
              {state.lastWave.leaks} leaked · {state.lastWave.reward} shared
              cash earned.
            </p>
          )}
          {state.result && (
            <h3>
              {state.result.winners.length
                ? "The city holds!"
                : "Defense ended"}
            </h3>
          )}
        </>
      )}
    </div>
  );
}
