"use client";
import { useEffect, useRef, useState } from "react";
import { useGameState } from "@tell-aviv/game-runtime";
import type { GameSDK } from "@tell-aviv/game-sdk";
import {
  TOWER_DEFS,
  TOWER_MAPS,
  TOWER_SYNERGIES,
  ENEMY_DEFS,
  towerMap,
  pathTile,
  waveKinds,
  type TowerMapId,
  type TowerMode,
  type EnemyKind,
} from "../config/tower";
import type {
  Tower,
  TowerState as State,
  WaveEvent as Event,
  WaveEnemy,
} from "../server/tower";
import { replayEnemy } from "./replay";
import { LiveDefense } from "./live";
const colors: Record<string, number> = {
  rapid: 0xb8ff6b,
  heavy: 0xffb46c,
  splash: 0xef83ff,
  slow: 0x7bcfff,
  support: 0xd3c5ff,
  economy: 0xffdf67,
  sniper: 0xff7d9b,
  burn: 0xff7a54,
};
export default function TowerDefense({
  sdk,
  paused,
}: {
  sdk: GameSDK;
  paused: boolean;
}) {
  const [playMode, setPlayMode] = useState<"solo" | "live">("solo");
  const [liveJoined, setLiveJoined] = useState(false);
  return (
    <div>
      <div className="game-tabs" aria-label="Neon Defense play mode">
        <button
          aria-pressed={playMode === "solo"}
          disabled={liveJoined}
          onClick={() => setPlayMode("solo")}
        >
          Solo defense
        </button>
        <button
          aria-pressed={playMode === "live"}
          onClick={() => setPlayMode("live")}
        >
          Live co-op defense
        </button>
      </div>
      {liveJoined && (
        <p className="game-hint">
          Leave your live room before switching to solo defense.
        </p>
      )}
      {playMode === "solo" ? (
        <SoloDefense sdk={sdk} paused={paused} />
      ) : (
        <LiveDefense sdk={sdk} paused={paused} onLobbyChange={setLiveJoined} />
      )}
    </div>
  );
}
function SoloDefense({ sdk, paused }: { sdk: GameSDK; paused: boolean }) {
  const { state, error, busy, action } = useGameState<State>(sdk);
  const [selected, setSelected] = useState("rapid"),
    [tower, setTower] = useState<Tower | null>(null),
    [animating, setAnimating] = useState(false),
    [mapChoice, setMapChoice] = useState<TowerMapId>("boulevard"),
    [modeChoice, setModeChoice] = useState<TowerMode>("campaign");
  const skip = useRef(false);
  useEffect(() => {
    if (state?.map) setMapChoice(state.map);
    if (state?.mode) setModeChoice(state.mode);
  }, [state?.map, state?.mode]);
  const host = useRef<HTMLDivElement>(null),
    live = useRef({ state, selected, paused, busy, animating }),
    game = useRef<import("phaser").Game | null>(null),
    fire = useRef<(x: number, y: number) => void>(() => {});
  live.current = { state, selected, paused, busy, animating };
  fire.current = (x, y) => {
    const snapshot = live.current;
    const existing = snapshot.state?.towers.find((t) => t.x === x && t.y === y);
    if (existing) setTower(existing);
    else if (!snapshot.busy && !snapshot.paused && !snapshot.animating)
      void action("place", { kind: snapshot.selected, x, y });
  };
  useEffect(() => {
    let disposed = false;
    import("phaser").then(({ default: Phaser }) => {
      if (disposed || !host.current) return;
      class Scene extends Phaser.Scene {
        graphic!: import("phaser").GameObjects.Graphics;
        seenWave = 0;
        waveStart = 0;
        waveEvents: Event[] = [];
        enemies: WaveEnemy[] = [];
        seenRun: string | undefined;
        create() {
          this.graphic = this.add.graphics();
          this.input.on(
            "pointerdown",
            (pointer: import("phaser").Input.Pointer) =>
              fire.current(
                Math.floor(pointer.x / 100),
                Math.floor(pointer.y / 100),
              ),
          );
        }
        update() {
          const snapshot = live.current,
            s = snapshot.state;
          if (!s) return;
          if (s.runId !== this.seenRun) {
            this.seenRun = s.runId;
            this.seenWave = 0;
            this.waveEvents = [];
            this.enemies = [];
            setAnimating(false);
          }
          if (skip.current) {
            skip.current = false;
            this.waveEvents = [];
            this.enemies = [];
            setAnimating(false);
          }
          const map = towerMap(s.map);
          const g = this.graphic;
          g.clear();
          g.fillStyle(0x141e30);
          g.fillRect(0, 0, 800, 500);
          for (let y = 0; y < 5; y++)
            for (let x = 0; x < 8; x++) {
              g.fillStyle(
                pathTile(map, x, y)
                  ? 0x374b58
                  : (x + y) % 2
                    ? 0x1d2b41
                    : 0x203047,
              );
              g.fillRoundedRect(x * 100 + 4, y * 100 + 4, 92, 92, 8);
            }
          for (const route of map.routes) {
            g.lineStyle(3, 0x829a8f, 0.7);
            for (let index = 1; index < route.length; index++)
              g.lineBetween(
                route[index - 1].x * 100 + 50,
                route[index - 1].y * 100 + 50,
                route[index].x * 100 + 50,
                route[index].y * 100 + 50,
              );
          }
          for (const tile of map.bonusTiles) {
            g.lineStyle(
              3,
              tile.kind === "high-ground" ? 0x79c9ff : 0xffdf67,
              0.8,
            );
            g.strokeRoundedRect(tile.x * 100 + 9, tile.y * 100 + 9, 82, 82, 8);
          }
          for (const t of s.towers) {
            const def = TOWER_DEFS[t.kind as keyof typeof TOWER_DEFS];
            g.fillStyle(colors[t.kind] ?? 0xb8ff6b);
            g.fillCircle(t.x * 100 + 50, t.y * 100 + 50, 18 + t.level * 2);
            g.fillStyle(0x192332);
            g.fillCircle(t.x * 100 + 50, t.y * 100 + 50, 7);
            if (t.kind === snapshot.selected) {
              g.lineStyle(1, colors[t.kind] ?? 0xb8ff6b, 0.2);
              g.strokeCircle(
                t.x * 100 + 50,
                t.y * 100 + 50,
                (def?.range ?? 1) * 100,
              );
            }
          }
          if (s.wave > this.seenWave) {
            this.seenWave = s.wave;
            this.waveStart = this.time.now;
            this.waveEvents = s.lastWave?.events ?? [];
            this.enemies = s.lastWave?.enemies ?? [];
            setAnimating(this.waveEvents.length > 0 || this.enemies.length > 0);
          }
          if (this.waveEvents.length || this.enemies.length) {
            const elapsed = ((this.time.now - this.waveStart) / 1000) * 5;
            const last = Math.max(
              0,
              ...this.waveEvents.map((e) => e.time),
              ...this.enemies.map((enemy) => enemy.endTime ?? 0),
            );
            for (const enemy of this.enemies) {
              const position = replayEnemy(enemy, elapsed);
              if (!position) continue;
              const ex = position.x * 100 + 50,
                ey = position.y * 100 + 50;
              g.fillStyle(
                enemy.kind === "boss"
                  ? 0xb97cff
                  : enemy.kind === "healer"
                    ? 0x8af0bd
                    : enemy.kind === "stealth"
                      ? 0xafb5d7
                      : enemy.kind === "runner"
                        ? 0xffe284
                        : 0xff839e,
                enemy.kind === "stealth" ? 0.55 : 1,
              );
              g.fillCircle(ex, ey, enemy.kind === "boss" ? 21 : 12);
              if (position.shield > 0) {
                g.lineStyle(3, 0x7cd1ff);
                g.strokeCircle(ex, ey, enemy.kind === "boss" ? 25 : 16);
              }
              g.fillStyle(0x21304a);
              g.fillRect(ex - 15, ey - 22, 30, 4);
              g.fillStyle(0x98f38b);
              g.fillRect(
                ex - 15,
                ey - 22,
                30 * Math.max(0, position.hp / enemy.maxHp),
                4,
              );
            }
            for (const e of this.waveEvents) {
              if (e.time < elapsed - 1.2 || e.time > elapsed) continue;
              const alpha = 1 - (elapsed - e.time) / 1.2;
              const ex = e.x * 100 + 50;
              const ey = (e.y ?? 2) * 100 + 50;
              if (e.type === "shot") {
                const t = s.towers.find((t) => t.id === e.towerId);
                if (t) {
                  g.lineStyle(2, colors[t.kind] ?? 0xb8ff6b, alpha);
                  g.lineBetween(t.x * 100 + 50, t.y * 100 + 50, ex, ey);
                }
                g.fillStyle(0xff839e, alpha);
                g.fillCircle(ex, ey, 4);
              } else {
                g.lineStyle(
                  3,
                  e.type === "kill"
                    ? 0xbfff78
                    : e.type === "shield-break"
                      ? 0x7cd1ff
                      : 0xff525f,
                  alpha,
                );
                g.strokeCircle(ex, ey, 10 + (1 - alpha) * 20);
              }
            }
            if (elapsed > last + 1.2) {
              this.waveEvents = [];
              this.enemies = [];
              setAnimating(false);
            }
          }
        }
      }
      const instance = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        width: 800,
        height: 500,
        backgroundColor: "#141e30",
        scene: Scene,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        audio: { noAudio: true },
      });
      game.current = instance;
    });
    return () => {
      disposed = true;
      game.current?.destroy(true);
      game.current = null;
    };
  }, []);
  useEffect(() => {
    if (paused) game.current?.scene.pause("default");
    else game.current?.scene.resume("default");
  }, [paused]);
  const disabled = busy || paused || animating;
  const incoming = waveKinds((state?.wave ?? 0) + 1).reduce<
    Record<string, number>
  >((counts, kind) => {
    counts[kind] = (counts[kind] ?? 0) + 1;
    return counts;
  }, {});
  return (
    <div>
      {state && (
        <>
          <h3>
            {towerMap(state.map).name} ·{" "}
            {state.mode === "endless" ? "Endless defense" : "20-wave campaign"}
          </h3>
          <div className="game-stats">
            {[
              ["Cash", state.cash],
              ["Lives", state.lives],
              [
                "Wave",
                state.mode === "endless"
                  ? `${state.wave} · endless`
                  : `${state.wave}/20`,
              ],
              ["Kills", state.kills],
            ].map(([label, value]) => (
              <div className="game-stat" key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="game-tabs">
            {Object.entries(TOWER_DEFS).map(([kind, def]) => (
              <button
                key={kind}
                className={selected === kind ? "selected" : ""}
                onClick={() => setSelected(kind)}
              >
                {kind} · ${def.cost}
              </button>
            ))}
          </div>
          <p className="game-hint">
            Select a tower, then click a tile away from the marked paths. Blue
            tiles add 0.6 range; gold tiles boost damage by 15%. Upgrade,
            prioritize targets or sell by clicking a placed tower. Wave combat
            is simulated by the server; this board replays the verified attacks.
          </p>
        </>
      )}
      <div className="game-canvas" ref={host} />
      {state && (
        <>
          <div className="game-row">
            <label>
              Defense map{" "}
              <select
                aria-label="Defense map"
                value={mapChoice}
                disabled={busy || paused}
                onChange={(event) =>
                  setMapChoice(event.target.value as TowerMapId)
                }
              >
                {Object.entries(TOWER_MAPS).map(([id, map]) => (
                  <option key={id} value={id}>
                    {map.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Defense mode{" "}
              <select
                aria-label="Defense mode"
                value={modeChoice}
                disabled={busy || paused}
                onChange={(event) =>
                  setModeChoice(event.target.value as TowerMode)
                }
              >
                <option value="campaign">20-wave campaign</option>
                <option value="endless">Endless</option>
              </select>
            </label>
            {animating && (
              <button
                disabled={busy || paused}
                onClick={() => {
                  skip.current = true;
                }}
              >
                Skip replay
              </button>
            )}
          </div>
          <p className="game-hint">{TOWER_MAPS[mapChoice].description}</p>
          <div className="game-row">
            <button
              disabled={disabled || state.phase !== "build"}
              onClick={() => void action("wave")}
            >
              {animating ? "Replaying wave…" : `Send wave ${state.wave + 1}`}
            </button>
            <button
              disabled={disabled}
              onClick={() => {
                setTower(null);
                void action("start", { map: mapChoice, mode: modeChoice });
              }}
            >
              New defense
            </button>
            {tower && (
              <>
                <span>
                  {tower.kind} · level{" "}
                  {state.towers.find((t) => t.id === tower.id)?.level ??
                    tower.level}
                </span>
                {TOWER_DEFS[tower.kind].damage > 0 && (
                  <label>
                    Target priority{" "}
                    <select
                      aria-label="Target priority"
                      value={
                        state.towers.find((item) => item.id === tower.id)
                          ?.target ?? "first"
                      }
                      disabled={disabled}
                      onChange={(event) =>
                        void action("target", {
                          towerId: tower.id,
                          target: event.target.value,
                        })
                      }
                    >
                      <option value="first">Nearest to exit</option>
                      <option value="strongest">Strongest</option>
                      <option value="support">Medics and jammers first</option>
                    </select>
                  </label>
                )}
                <button
                  disabled={disabled}
                  onClick={() => void action("upgrade", { towerId: tower.id })}
                >
                  Upgrade
                </button>
                <button
                  disabled={disabled}
                  onClick={() => {
                    void action("sell", { towerId: tower.id });
                    setTower(null);
                  }}
                >
                  Sell
                </button>
              </>
            )}
          </div>
          {state.phase === "upgrade" && (
            <section className="game-card">
              <h3>Choose a run upgrade</h3>
              <div className="game-row">
                {state.offeredUpgrades.map((upgrade) => (
                  <button
                    key={upgrade}
                    disabled={disabled}
                    onClick={() => void action("choose", { upgrade })}
                  >
                    {upgrade}
                  </button>
                ))}
              </div>
            </section>
          )}
          {state.lastWave && (
            <p className="game-hint">
              Last wave: {state.lastWave.kills} defeated ·{" "}
              {state.lastWave.leaks} leaked · ${state.lastWave.reward} earned
              {Boolean(state.lastWave.synergyHits) &&
                ` · ${state.lastWave.synergyHits} combination hits`}
            </p>
          )}
          {(state.phase === "won" || state.phase === "lost") && (
            <h2>
              {state.phase === "won"
                ? "The city holds. All 20 waves defeated!"
                : "Defense breached. Try another build."}
            </h2>
          )}
          {state.upgrades.length > 0 && (
            <p className="positive">
              Run upgrades: {state.upgrades.join(" · ")}
            </p>
          )}
          {state.phase !== "won" && state.phase !== "lost" && (
            <section className="game-card">
              <h3>Incoming wave {state.wave + 1}</h3>
              <div className="game-row">
                {Object.entries(incoming).map(([kind, count]) => (
                  <span
                    key={kind}
                    className="pill"
                    title={ENEMY_DEFS[kind as EnemyKind].description}
                  >
                    {ENEMY_DEFS[kind as EnemyKind].name} × {count}
                  </span>
                ))}
              </div>
              {Object.keys(incoming)
                .filter((kind) => kind !== "grunt")
                .map((kind) => (
                  <p className="game-hint" key={kind}>
                    <strong>{ENEMY_DEFS[kind as EnemyKind].name}:</strong>{" "}
                    {ENEMY_DEFS[kind as EnemyKind].description}
                  </p>
                ))}
            </section>
          )}
          <details className="game-card">
            <summary>Build combinations</summary>
            {TOWER_SYNERGIES.map((synergy) => (
              <p className="game-hint" key={synergy.name}>
                <strong>{synergy.name}:</strong> {synergy.description}
              </p>
            ))}
          </details>
          {Boolean(state.clearedMaps?.length) && (
            <p className="positive">
              Campaign maps cleared:{" "}
              {state.clearedMaps?.map((id) => TOWER_MAPS[id].name).join(" · ")}
            </p>
          )}
        </>
      )}
      {error && (
        <p className="game-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
