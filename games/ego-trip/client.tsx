"use client";
import { translateMovementCode } from "../../packages/shared/src/movement";
import { useEffect, useRef, useState } from "react";
import { readController, type RuntimeSettings } from "@tell-aviv/game-runtime";
import type { GameSDK } from "@tell-aviv/game-sdk";
import {
  newWorld,
  newCampaignWorld,
  stepWorld,
  chooseMod,
  shop,
  shopCost,
  nextEncounter,
  chooseRoute,
  eventChoice,
  WIDTH,
  HEIGHT,
  type World,
  type Input,
} from "./engine";
import { bosses, weapons, mods, type WeaponId } from "./content";
import {
  dailySeed,
  campaignLength,
  encounterName,
  isPatrol,
  sector,
  seedFromText,
  type CampaignMode,
  type Difficulty,
  type EventChoice,
} from "./campaign";
import {
  completeRun,
  initialSave,
  insightForRun,
  normalizeSave,
} from "./checkpoint";
import { EgoCoopClient } from "./coop";
import { EgoRankedClient } from "./ranked";
import { arenaFor } from "./arena";
import { journeyView } from "./journey-view";
export default function EgoTrip(props: { sdk: GameSDK } & RuntimeSettings) {
  const [mode, setMode] = useState<"solo" | "coop" | "ranked">("solo");
  return (
    <div>
      <div className="game-tabs" aria-label="Ego Trip play mode">
        <button
          className={mode === "solo" ? "selected" : ""}
          onClick={() => setMode("solo")}
        >
          Solo campaign
        </button>
        <button
          className={mode === "coop" ? "selected" : ""}
          onClick={() => setMode("coop")}
        >
          Private co-op
        </button>
        <button
          className={mode === "ranked" ? "selected" : ""}
          onClick={() => setMode("ranked")}
        >
          Ranked solo
        </button>
      </div>
      {mode === "solo" ? (
        <SoloGame {...props} />
      ) : mode === "ranked" ? (
        <EgoRankedClient sdk={props.sdk} settings={props} />
      ) : (
        <EgoCoopClient sdk={props.sdk} settings={props} />
      )}
    </div>
  );
}
function SoloGame({
  sdk,
  paused,
  reducedMotion,
  audio,
  movementKeys,
}: { sdk: GameSDK } & RuntimeSettings) {
  const host = useRef<HTMLDivElement>(null),
    game = useRef<import("phaser").Game | null>(null),
    world = useRef<World>(newCampaignWorld()),
    prefs = useRef({ paused, reducedMotion, audio, movementKeys }),
    input = useRef<Input>({
      x: 0,
      y: 0,
      aimX: 450,
      aimY: 170,
      attack: false,
      alternate: false,
      dash: false,
    }),
    keys = useRef(new Set<string>()),
    touch = useRef({
      x: 0,
      y: 0,
      attack: false,
      dash: false,
      alternate: false,
    });
  const [view, setView] = useState(world.current),
    [weapon, setWeapon] = useState<WeaponId>("pulse"),
    [loaded, setLoaded] = useState(false),
    [message, setMessage] = useState(""),
    [metadata, setMetadata] = useState(initialSave),
    [runMode, setRunMode] = useState<CampaignMode | "rush">("normal"),
    [difficulty, setDifficulty] = useState<Difficulty>("standard"),
    [seedText, setSeedText] = useState("your-signal"),
    [startingHelper, setStartingHelper] = useState<"gunner" | "medic" | "none">(
      "none",
    ),
    [saveBlocked, setSaveBlocked] = useState(false);
  const canSave = useRef(false);
  const meta = useRef(metadata),
    recorded = useRef(false);
  meta.current = metadata;
  prefs.current = { paused, reducedMotion, audio, movementKeys };
  useEffect(() => {
    // A held physical key may map to a different direction after saving controls.
    keys.current.clear();
  }, [movementKeys]);
  useEffect(() => {
    audio?.setTheme(true);
    return () => audio?.setTheme(false);
  }, [audio]);
  const save = async (checkpoint: World | null = world.current) => {
    if (!canSave.current) return;
    const data = { ...meta.current, checkpoint };
    try {
      await sdk.save(data);
      setMessage("Run saved to cloud.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save run.");
    }
  };
  useEffect(() => {
    let alive = true;
    sdk
      .load<unknown>()
      .then((result) => {
        if (!alive) return;
        const data =
          result.schemaVersion === 1 ? normalizeSave(result.data) : null;
        if (data) {
          canSave.current = true;
          setMetadata(data);
          meta.current = data;
          if (data.checkpoint) {
            world.current = data.checkpoint;
            setView({ ...world.current });
            setWeapon(world.current.weapon);
            setRunMode(world.current.campaign?.mode ?? "rush");
            setDifficulty(world.current.campaign?.difficulty ?? "standard");
          }
        } else if (result.data != null || result.schemaVersion !== 1) {
          canSave.current = false;
          setSaveBlocked(true);
          setMessage(
            "This cloud save uses an unsupported or damaged format. It is preserved; this session can play without saving.",
          );
        } else canSave.current = true;
        setLoaded(true);
      })
      .catch((e) => {
        if (alive) {
          setSaveBlocked(true);
          setMessage(
            `Cloud loading failed: ${e instanceof Error ? e.message : "service unavailable"}. Your saved progress is preserved; this session can play without saving.`,
          );
          setLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [sdk]);
  useEffect(() => {
    if (!loaded) return;
    let disposed = false;
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches("input,select,textarea,button"))
        return;
      const code = translateMovementCode(e.code, prefs.current.movementKeys);
      if (code) keys.current.add(code);
      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          e.code,
        )
      )
        e.preventDefault();
    };
    const up = (e: KeyboardEvent) =>
      keys.current.delete(
        translateMovementCode(e.code, prefs.current.movementKeys),
      );
    const blur = () => {
      keys.current.clear();
      touch.current = {
        x: 0,
        y: 0,
        attack: false,
        dash: false,
        alternate: false,
      };
      input.current.attack = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    import("phaser").then(({ default: Phaser }) => {
      if (disposed || !host.current) return;
      class Arena extends Phaser.Scene {
        graphics!: import("phaser").GameObjects.Graphics;
        labels: import("phaser").GameObjects.Text[] = [];
        lastUi = 0;
        create() {
          this.graphics = this.add.graphics();
          this.input.on(
            "pointermove",
            (pointer: import("phaser").Input.Pointer) => {
              input.current.aimX = pointer.x;
              input.current.aimY = pointer.y;
            },
          );
          this.input.on(
            "pointerdown",
            (pointer: import("phaser").Input.Pointer) => {
              input.current.aimX = pointer.x;
              input.current.aimY = pointer.y;
              input.current.attack = true;
            },
          );
          this.input.on("pointerup", () => {
            input.current.attack = false;
          });
        }
        update(time: number, delta: number) {
          const w = world.current,
            p = w.player,
            b = w.boss,
            pad = readController(),
            k = keys.current;
          const dx =
              (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) -
              (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0),
            dy =
              (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) -
              (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0);
          const control = {
            ...input.current,
            x: dx || pad.x || touch.current.x,
            y: dy || pad.y || touch.current.y,
            attack:
              input.current.attack ||
              k.has("Space") ||
              pad.attack ||
              touch.current.attack,
            alternate:
              k.has("KeyQ") || pad.alternate || touch.current.alternate,
            dash:
              k.has("ShiftLeft") ||
              k.has("ShiftRight") ||
              pad.dash ||
              touch.current.dash,
          };
          if (pad.attack || touch.current.attack) {
            const target = w.enemies.some((enemy) => enemy.hp > 0)
              ? w.enemies
                  .filter((enemy) => enemy.hp > 0)
                  .sort(
                    (a, b) =>
                      Math.hypot(a.x - p.x, a.y - p.y) -
                      Math.hypot(b.x - p.x, b.y - p.y),
                  )[0]
              : b;
            control.aimX = target?.x ?? p.x;
            control.aimY = target?.y ?? p.y;
          }
          if (!prefs.current.paused) {
            const shots = w.shots,
              hp = p.hp,
              dash = p.dashCooldown,
              stage = w.stage;
            stepWorld(w, control, delta / 1000);
            if (w.shots > shots) prefs.current.audio?.effect("shot");
            if (p.hp < hp) prefs.current.audio?.effect("hit");
            if (p.dashCooldown > dash) prefs.current.audio?.effect("dash");
            if (stage === "fight" && w.stage === "won")
              prefs.current.audio?.effect("victory");
            else if (stage === "fight" && w.stage === "choice")
              prefs.current.audio?.effect("pickup");
          }
          const g = this.graphics;
          g.clear();
          g.fillStyle(0x111a2b);
          g.fillRoundedRect(0, 0, WIDTH, HEIGHT, 14);
          g.lineStyle(1, 0x2c3952);
          for (let x = 40; x < WIDTH; x += 50)
            g.lineBetween(x, 20, x, HEIGHT - 20);
          for (let y = 30; y < HEIGHT; y += 50)
            g.lineBetween(20, y, WIDTH - 20, y);
          const arena = arenaFor(w.bossIndex);
          if (arena.conveyor) {
            g.lineStyle(2, 0xffb57f, 0.3);
            for (let x = 80; x < WIDTH; x += 95) {
              g.lineBetween(x, 480, x + 30, 480);
              g.lineBetween(x + 30, 480, x + 20, 470);
              g.lineBetween(x + 30, 480, x + 20, 490);
              g.lineBetween(x, 80, x - 30, 80);
            }
          }
          for (const t of arena.terrain) {
            const color =
              t.kind === "heat"
                ? 0xffa34f
                : t.kind === "slow"
                  ? 0x89bfa2
                  : bosses[w.bossIndex].color;
            g.fillStyle(color, t.kind === "cover" ? 0.35 : 0.1);
            g.fillCircle(t.x, t.y, t.radius);
            g.lineStyle(t.kind === "cover" ? 4 : 2, color, 0.65);
            g.strokeCircle(t.x, t.y, t.radius);
            if (t.kind === "cover") {
              g.lineStyle(1, 0xdcecff, 0.45);
              g.lineBetween(t.x - 12, t.y, t.x + 12, t.y);
              g.lineBetween(t.x, t.y - 12, t.x, t.y + 12);
            }
          }
          g.lineStyle(3, bosses[w.bossIndex].color, 0.4);
          g.strokeRoundedRect(12, 12, WIDTH - 24, HEIGHT - 24, 16);
          if (w.campaign?.objective && w.stage === "fight") {
            const objective = w.campaign.objective;
            g.lineStyle(4, 0x9df3c4, 0.95);
            g.strokeCircle(objective.x, objective.y, 30);
            g.fillStyle(0x9df3c4, 0.4);
            g.fillCircle(objective.x, objective.y, 18);
            if (objective.kind === "relay") {
              g.lineStyle(1, 0x9df3c4, 0.2);
              g.strokeCircle(objective.x, objective.y, 165);
            }
          }
          for (const h of w.hazards) {
            const active = h.timer <= 0;
            g.lineStyle(active ? 5 : 2, h.color, active ? 0.8 : 0.35);
            g.fillStyle(h.color, active ? 0.2 : 0.08);
            if (h.kind === "line") {
              g.lineStyle(h.radius * 2, h.color, active ? 0.3 : 0.12);
              g.lineBetween(h.x, h.y, h.x2, h.y2);
              g.lineStyle(2, h.color, 0.7);
              g.lineBetween(h.x, h.y, h.x2, h.y2);
            } else {
              g.fillCircle(h.x, h.y, h.radius);
              g.strokeCircle(h.x, h.y, h.radius);
              if (h.kind === "ring") {
                g.fillStyle(0x192332, 0.8);
                g.fillCircle(h.x, h.y, h.safeRadius);
                g.lineStyle(2, 0x9acc92, 0.6);
                g.strokeCircle(h.x, h.y, h.safeRadius);
              }
            }
          }
          for (const bullet of w.bullets) {
            g.fillStyle(bullet.enemy ? 0xff829c : 0xbaff78);
            g.fillCircle(bullet.x, bullet.y, bullet.radius);
            if (!prefs.current.reducedMotion) {
              g.lineStyle(2, bullet.enemy ? 0xff829c : 0xbaff78, 0.3);
              g.lineBetween(
                bullet.x,
                bullet.y,
                bullet.x - bullet.vx * 0.03,
                bullet.y - bullet.vy * 0.03,
              );
            }
          }
          if (w.stage === "fight" && !isPatrol(w)) {
            const color = bosses[w.bossIndex].color;
            g.fillStyle(color);
            if (w.campaign?.room.kind === "miniboss") {
              g.fillTriangle(b.x - 28, b.y, b.x, b.y - 36, b.x + 28, b.y);
              g.fillTriangle(b.x - 28, b.y, b.x, b.y + 36, b.x + 28, b.y);
            } else if (w.bossIndex === 0) g.fillCircle(b.x, b.y, 29);
            else if (w.bossIndex === 1) g.fillRect(b.x - 28, b.y - 28, 56, 56);
            else if (w.bossIndex === 2)
              g.fillTriangle(
                b.x,
                b.y - 35,
                b.x - 30,
                b.y + 25,
                b.x + 30,
                b.y + 25,
              );
            else if (w.bossIndex === 4) {
              g.fillTriangle(b.x, b.y - 34, b.x - 30, b.y, b.x + 30, b.y);
              g.fillTriangle(b.x, b.y + 34, b.x - 30, b.y, b.x + 30, b.y);
            } else if (w.bossIndex === 5) {
              g.fillCircle(b.x, b.y, 23);
              for (let i = 0; i < 8; i++) {
                const a = (i * Math.PI) / 4;
                g.lineStyle(5, color);
                g.lineBetween(
                  b.x + Math.cos(a) * 27,
                  b.y + Math.sin(a) * 27,
                  b.x + Math.cos(a) * 39,
                  b.y + Math.sin(a) * 39,
                );
              }
            } else if (w.bossIndex === 6) {
              g.fillRect(b.x - 27, b.y - 28, 54, 56);
              g.lineStyle(3, 0x142327);
              g.lineBetween(b.x, b.y - 25, b.x, b.y + 25);
            } else {
              g.fillCircle(b.x, b.y, 24);
              g.lineStyle(4, color);
              g.strokeCircle(b.x, b.y, 34);
            }
            g.fillStyle(0x151c2e);
            g.fillCircle(b.x - 9, b.y - 5, 5);
            g.fillCircle(b.x + 9, b.y - 5, 5);
            g.fillRect(b.x - 35, b.y - 48, 70, 6);
            g.fillStyle(color);
            g.fillRect(b.x - 35, b.y - 48, 70 * Math.max(0, b.hp / b.maxHp), 6);
            if ((b.opening ?? 0) > 0) {
              g.lineStyle(4, 0xc6ff8a);
              g.strokeCircle(b.x, b.y, 48);
            }
            if (journeyView(w)?.shielded) {
              g.lineStyle(5, 0xffd67f, 0.85);
              g.strokeCircle(b.x, b.y, 51);
            }
            if (b.phase >= 2) {
              g.lineStyle(2, color, 0.7);
              g.strokeCircle(b.x, b.y, 43);
            }
          }
          for (const enemy of w.enemies) {
            g.fillStyle(
              enemy.kind === "runner"
                ? 0xff997f
                : enemy.kind === "sentry"
                  ? 0xbe94ff
                  : enemy.kind === "weaver"
                    ? 0x79d9ef
                    : enemy.kind === "splitter"
                      ? 0xf4abdb
                      : enemy.kind === "bulwark"
                        ? 0x89bfa2
                        : 0xffd06f,
            );
            if (enemy.kind === "runner")
              g.fillTriangle(
                enemy.x,
                enemy.y - 19,
                enemy.x - 15,
                enemy.y + 12,
                enemy.x + 15,
                enemy.y + 12,
              );
            else if (
              enemy.kind === "sentry" ||
              enemy.kind === "weaver" ||
              enemy.kind === "splitter"
            )
              g.fillCircle(enemy.x, enemy.y, 16);
            else g.fillRect(enemy.x - 16, enemy.y - 16, 32, 32);
            g.fillStyle(0x111a2b);
            g.fillRect(enemy.x - 18, enemy.y - 28, 36, 4);
            g.fillStyle(0xffc9aa);
            g.fillRect(
              enemy.x - 18,
              enemy.y - 28,
              36 * Math.max(0, enemy.hp / enemy.maxHp),
              4,
            );
          }
          g.fillStyle(
            p.invulnerable > 0 ? 0xe5ffba : 0xbaff75,
            p.invulnerable > 0 && Math.floor(time / 60) % 2 ? 0.4 : 1,
          );
          g.fillCircle(p.x, p.y, 13);
          g.lineStyle(3, 0xd6ffac);
          g.lineBetween(
            p.x,
            p.y,
            p.x +
              Math.cos(Math.atan2(control.aimY - p.y, control.aimX - p.x)) * 22,
            p.y +
              Math.sin(Math.atan2(control.aimY - p.y, control.aimX - p.x)) * 22,
          );
          if (w.helper) {
            g.fillStyle(w.helper.kind === "medic" ? 0x7ee8db : 0xffcf88);
            g.fillCircle(p.x - 28, p.y - 28, 9);
            g.fillStyle(0xc7efff);
            g.fillRect(p.x - 38, p.y - 44, (20 * w.helper.hp) / 50, 3);
          }
          if (
            w.weapon === "blade" &&
            w.cooldown > weapons.blade.interval - 0.12
          ) {
            g.lineStyle(5, 0xc6ff8a, 0.5);
            g.strokeCircle(p.x, p.y, 75);
          }
          if (time - this.lastUi > 90) {
            this.lastUi = time;
            setView({ ...w, player: { ...p }, boss: { ...b } });
          }
        }
      }
      game.current = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        width: WIDTH,
        height: HEIGHT,
        scene: Arena,
        backgroundColor: "#111a2b",
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        audio: { noAudio: true },
      });
    });
    return () => {
      disposed = true;
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      game.current?.destroy(true);
      game.current = null;
      if (canSave.current)
        void sdk
          .save({ ...meta.current, checkpoint: world.current })
          .catch(() => {});
    };
  }, [loaded, sdk]);
  useEffect(() => {
    if ((view.stage === "won" || view.stage === "lost") && !recorded.current) {
      recorded.current = true;
      const data = completeRun(meta.current, world.current);
      if (data === meta.current) return;
      setMetadata(data);
      meta.current = data;
      if (canSave.current)
        void sdk.save(data).catch((e) => setMessage(e.message));
    }
  }, [view.stage, view.kills, sdk]);
  const restart = () => {
    if (!loaded) return;
    recorded.current = false;
    // A replay of the same daily/seeded route is a new local run. The completion
    // marker only deduplicates restoring its finished checkpoint.
    const nextMetadata = { ...meta.current, lastRunId: "" };
    meta.current = nextMetadata;
    setMetadata(nextMetadata);
    const seed =
      runMode === "daily"
        ? dailySeed()
        : runMode === "seeded"
          ? seedFromText(seedText)
          : Date.now();
    const helper =
      startingHelper !== "none" &&
      meta.current.unlocks.includes(`starting-${startingHelper}`)
        ? startingHelper
        : null;
    world.current =
      runMode === "rush"
        ? newWorld(weapon, seed)
        : newCampaignWorld(weapon, seed, {
            mode: runMode,
            difficulty,
            secretUnlocked: meta.current.unlocks.includes("secret-paths"),
            helper,
          });
    setView({ ...world.current });
  };
  const unlock = (
    id: "starting-gunner" | "starting-medic" | "secret-paths",
    cost: number,
  ) => {
    if (
      meta.current.insight < cost ||
      meta.current.unlocks.includes(id) ||
      !canSave.current
    )
      return;
    const data = {
      ...meta.current,
      insight: meta.current.insight - cost,
      unlocks: [...meta.current.unlocks, id],
    };
    meta.current = data;
    setMetadata(data);
    void save();
  };
  const resolve = (choice: EventChoice) => {
    if (!eventChoice(world.current, choice))
      setMessage("That trade needs more health, Ego, or a sellable mod.");
    else setMessage("");
    setView({ ...world.current });
  };
  const journey = journeyView(view);
  return (
    <div>
      <div className="game-stats">
        <div className="game-stat">
          <small>Health</small>
          <strong>
            {Math.ceil(view.player.hp)} / {view.player.maxHp}
          </strong>
        </div>
        <div className="game-stat">
          <small>Ego · run currency</small>
          <strong>{view.ego}</strong>
        </div>
        <div className="game-stat">
          <small>Encounter</small>
          <strong>
            {view.campaign
              ? `${view.campaign.roomIndex + 1}${view.campaign.mode === "endless" ? " · endless" : ` / ${campaignLength(view)}`}`
              : `${view.bossIndex + 1} / ${view.bossCount ?? 4}`}
          </strong>
        </div>
        <div className="game-stat">
          <small>Dash</small>
          <strong>
            {view.player.dashCooldown <= 0
              ? "Ready"
              : `${view.player.dashCooldown.toFixed(1)}s`}
          </strong>
        </div>
      </div>
      <div className="game-row">
        <select
          aria-label="Starting weapon"
          value={weapon}
          onChange={(e) => setWeapon(e.target.value as WeaponId)}
        >
          {Object.entries(weapons).map(([id, w]) => (
            <option
              disabled={!metadata.unlocked.includes(id)}
              value={id}
              key={id}
            >
              {w.name}
              {!metadata.unlocked.includes(id) ? " · locked" : ""}
            </option>
          ))}
        </select>
        <select
          aria-label="Run mode"
          value={runMode}
          onChange={(event) =>
            setRunMode(event.target.value as CampaignMode | "rush")
          }
        >
          <option value="normal">Campaign · eight districts</option>
          <option value="daily">Daily challenge · same UTC seed</option>
          <option value="seeded">Seeded campaign</option>
          <option value="endless">Endless districts</option>
          <option value="rush">Classic four-boss rush</option>
        </select>
        <select
          aria-label="Campaign difficulty"
          value={difficulty}
          onChange={(event) => setDifficulty(event.target.value as Difficulty)}
          disabled={runMode === "rush"}
        >
          <option value="standard">Standard</option>
          <option value="volatile">Volatile · tougher patrols</option>
        </select>
        {runMode === "seeded" && (
          <input
            aria-label="Campaign seed"
            value={seedText}
            maxLength={80}
            onChange={(event) => setSeedText(event.target.value)}
          />
        )}
        <select
          aria-label="Starting companion"
          value={startingHelper}
          onChange={(event) =>
            setStartingHelper(event.target.value as "none" | "gunner" | "medic")
          }
          disabled={runMode === "rush"}
        >
          <option value="none">Start alone</option>
          <option
            value="gunner"
            disabled={!metadata.unlocks.includes("starting-gunner")}
          >
            Start with gunner{" "}
            {!metadata.unlocks.includes("starting-gunner") && "· locked"}
          </option>
          <option
            value="medic"
            disabled={!metadata.unlocks.includes("starting-medic")}
          >
            Start with medic{" "}
            {!metadata.unlocks.includes("starting-medic") && "· locked"}
          </option>
        </select>
        <button disabled={!loaded} onClick={restart}>
          Begin new run
        </button>
        <button disabled={!loaded || saveBlocked} onClick={() => void save()}>
          Save checkpoint
        </button>
        <span className="game-hint">
          Best bosses: {metadata.bestClears} · best rooms: {metadata.bestRooms}
        </span>
      </div>
      <p className="game-hint">
        Plan 45–60 minutes for a new forty-room journey. Save a checkpoint to
        continue later. The classic rush is a shorter mode.
      </p>
      {view.campaign && (
        <p className="game-hint">
          District {sector(view) + 1} · {view.campaign.room.name} · seed{" "}
          {view.campaign.initialSeed} · {view.campaign.difficulty}. Daily and
          seeded runs are casual and unranked.
        </p>
      )}
      <p className="game-hint">
        WASD / arrows move · hold click or Space fires · aim with pointer ·
        Shift dash · Q alternate. Controller: left stick, A attack, B dash, X
        alternate. Touch uses auto aim.
      </p>
      <div className="game-canvas" ref={host}>
        {paused && <div className="game-overlay">Paused</div>}
      </div>
      <div className="game-row">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,45px)",
            gap: 4,
          }}
        >
          {[
            [0, -1, "↑"],
            [-1, 0, "←"],
            [0, 1, "↓"],
            [1, 0, "→"],
          ].map(([x, y, label]) => (
            <button
              key={label}
              aria-label={`Move ${label}`}
              onPointerDown={() => {
                touch.current.x = Number(x);
                touch.current.y = Number(y);
              }}
              onPointerUp={() => {
                touch.current.x = 0;
                touch.current.y = 0;
              }}
              onPointerLeave={() => {
                touch.current.x = 0;
                touch.current.y = 0;
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onPointerDown={() => {
            touch.current.attack = true;
          }}
          onPointerUp={() => {
            touch.current.attack = false;
          }}
          onPointerLeave={() => {
            touch.current.attack = false;
          }}
        >
          Hold fire
        </button>
        <button
          onPointerDown={() => {
            touch.current.dash = true;
          }}
          onPointerUp={() => {
            touch.current.dash = false;
          }}
          onPointerLeave={() => {
            touch.current.dash = false;
          }}
        >
          Dash
        </button>
        <button
          onPointerDown={() => {
            touch.current.alternate = true;
          }}
          onPointerUp={() => {
            touch.current.alternate = false;
          }}
          onPointerLeave={() => {
            touch.current.alternate = false;
          }}
        >
          Alternate
        </button>
        <span className="game-hint">{weapons[view.weapon].description}</span>
      </div>
      <div className="game-log" aria-live="polite">
        {view.message}
      </div>
      {view.stage === "fight" && (
        <p className="game-hint">
          {encounterName(view)} ·{" "}
          {journey ? (
            <span>
              {journey.label}: {journey.task}{" "}
            </span>
          ) : (
            view.campaign?.objective && (
              <span>
                Objective: {Math.floor(view.campaign.objective.progress)} /{" "}
                {view.campaign.objective.target}
                {view.campaign.objective.kind === "relay"
                  ? ` signal · relay ${Math.ceil(view.campaign.objective.hp)} HP`
                  : " beacons"}
                .{" "}
              </span>
            )
          )}
          {isPatrol(view)
            ? `${view.enemies.length} enemies · wave ${view.campaign?.wave ?? 1}/${view.campaign?.totalWaves ?? 1}. Runners chase, weavers strafe, splitters divide, bulwarks pulse.`
            : `phase ${view.boss.phase}.`}{" "}
          Outlined areas are attack warnings. Rings have a safe center; beams
          require directional dodges. Green boss rings mark recovery openings.{" "}
          {arenaFor(view.bossIndex).name}:{" "}
          {arenaFor(view.bossIndex).description}
        </p>
      )}
      {view.stage === "route" && view.campaign && (
        <section className="game-card">
          <h3>Choose your route</h3>
          <div className="game-grid">
            {view.campaign.routes.map((route) => (
              <button
                key={route.id}
                onClick={() => {
                  chooseRoute(world.current, route.id);
                  setView({ ...world.current });
                }}
              >
                <strong>{route.name}</strong>
                <p>{route.description}</p>
                <small>{route.kind}</small>
              </button>
            ))}
          </div>
        </section>
      )}
      {view.stage === "event" && view.campaign && (
        <section className="game-card">
          <h3>{view.campaign.room.name}</h3>
          <p>{view.campaign.room.description}</p>
          <div className="game-row">
            {["npc", "curse", "rare"].includes(view.campaign.room.kind) && (
              <>
                <button onClick={() => resolve("safe")}>
                  {view.campaign.room.kind === "rare"
                    ? "Take signal key + 30 Ego"
                    : "Refuse bargain · recover 15 HP · mark pilgrim trail"}
                </button>
                <button onClick={() => resolve("risk")}>
                  {view.campaign.room.kind === "npc"
                    ? "Carry the signal key to a relay"
                    : view.campaign.room.kind === "rare"
                      ? "Restore companion + bond · 25 Ego · carry key"
                      : "Accept Glass confidence · +25% damage, +20% taken, +35 Ego"}
                </button>
              </>
            )}
            {view.campaign.room.kind === "secret" &&
              view.campaign.contentVersion === 2 && (
                <button onClick={() => resolve("safe")}>
                  {view.campaign.signalKey
                    ? "Use carried key · restore Prism argument + Prismatic memory"
                    : "Claim Held breath + recover 35 HP"}
                </button>
              )}
            {view.campaign.room.kind === "helper" && (
              <>
                <button onClick={() => resolve("gunner")}>
                  Rescue gunner · 40 HP · ranged support
                </button>
                <button onClick={() => resolve("medic")}>
                  Rescue medic · 50 HP · healing support
                </button>
              </>
            )}
            {(view.campaign.room.kind === "shrine" ||
              (view.campaign.room.kind === "secret" &&
                view.campaign.contentVersion !== 2)) && (
              <>
                <button onClick={() => resolve("safe")}>
                  {view.campaign.room.kind === "secret"
                    ? "Safe cache · gain 25 Ego"
                    : "Rest · recover 18 HP"}
                </button>
                <button onClick={() => resolve("risk")}>
                  {view.campaign.room.kind === "secret"
                    ? "Trade 30 HP for Echoing ink"
                    : "Trade 20 HP for Perfect emphasis"}
                </button>
              </>
            )}
            {view.campaign.room.kind === "treasure" && (
              <>
                <button onClick={() => resolve("safe")}>
                  Small cache · gain 25 Ego
                </button>
                <button onClick={() => resolve("risk")}>
                  Trapped cache · lose 18 HP, gain 55 Ego + split mod
                </button>
              </>
            )}
            {view.campaign.room.kind === "trade" && (
              <>
                <button onClick={() => resolve("sell")}>
                  Sell first eligible mod · gain 35 Ego
                </button>
                <button onClick={() => resolve("buy")}>
                  Buy a tempo or venom mod · 25 Ego
                </button>
                <button onClick={() => resolve("safe")}>Keep your build</button>
              </>
            )}
            {view.campaign.room.kind === "weapon" && (
              <>
                {Object.entries(weapons).map(([id, item]) => (
                  <button key={id} onClick={() => resolve(id as WeaponId)}>
                    Equip {item.name} · gain 15 Ego
                  </button>
                ))}
                <button onClick={() => resolve("safe")}>
                  Keep current weapon · gain 20 Ego
                </button>
              </>
            )}
          </div>
        </section>
      )}
      {view.stage === "choice" && (
        <section className="game-card">
          <h3>Choose one build mod</h3>
          <div className="game-grid">
            {view.offered.map((id) => {
              const mod = mods.find((m) => m.id === id)!;
              return (
                <button
                  key={id}
                  onClick={() => {
                    chooseMod(world.current, id);
                    setView({ ...world.current });
                  }}
                >
                  <strong>{mod.name}</strong>
                  <p>{mod.description}</p>
                  <small>{mod.rarity}</small>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {view.stage === "shop" && (
        <section className="game-card">
          <h3>A quiet corner</h3>
          <div className="game-row">
            {[
              ["heal", `Recover 35 HP · ${shopCost(view, "heal")} Ego`],
              ["helper", `Hire medic · ${shopCost(view, "helper")} Ego`],
              ["mod", `Mystery mod · ${shopCost(view, "mod")} Ego`],
              ["risk", "Cursed shrine · trade 20 HP for critical mod"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  if (
                    !shop(
                      world.current,
                      id as "heal" | "helper" | "mod" | "risk",
                    )
                  )
                    setMessage("You need more Ego or health.");
                  setView({ ...world.current });
                }}
              >
                {label}
              </button>
            ))}
            <button
              className="selected"
              onClick={() => {
                nextEncounter(world.current);
                setView({ ...world.current });
              }}
            >
              Next encounter →
            </button>
          </div>
        </section>
      )}
      {(view.stage === "won" || view.stage === "lost") && (
        <section className="game-card">
          <h2>
            {view.stage === "won"
              ? "You outgrew every Ego."
              : "Take a breath. Try a different build."}
          </h2>
          <p>
            {view.kills} bosses cleared · {view.campaign?.cleared ?? view.kills}{" "}
            rooms cleared · {metadata.runs} lifetime runs. This run earned{" "}
            {insightForRun(view)} Insight for permanent starting options. Solo
            outcomes remain unranked.
          </p>
          <button onClick={restart}>Begin again</button>
        </section>
      )}
      <details className="game-card" style={{ marginTop: 14 }}>
        <summary>Permanent options · {metadata.insight} Insight</summary>
        <p>
          Earn Insight from completed rooms and bosses when a run ends. Unlock
          companions or secret routes; permanent options add build choices.
        </p>
        <div className="game-row">
          {(
            [
              ["starting-gunner", 12, "Starting gunner"],
              ["starting-medic", 12, "Starting medic"],
              ["secret-paths", 16, "Secret routes"],
            ] as const
          ).map(([id, cost, label]) => (
            <button
              key={id}
              disabled={
                saveBlocked ||
                metadata.unlocks.includes(id) ||
                metadata.insight < cost
              }
              onClick={() => unlock(id, cost)}
            >
              {label} ·{" "}
              {metadata.unlocks.includes(id) ? "unlocked" : `${cost} Insight`}
            </button>
          ))}
        </div>
      </details>
      {view.campaign?.signalKey && (
        <p className="positive">
          Carried object: signal key · an abandoned relay will answer at an
          event junction.
        </p>
      )}
      {(view.campaign?.refusals ?? 0) > 0 && (
        <p className="game-hint">
          Pilgrim trail: {view.campaign?.refusals}/3 refused bargains.
        </p>
      )}
      {metadata.journal.length > 0 && (
        <details className="game-card">
          <summary>
            Casual discovery journal · {metadata.journal.length} discoveries
          </summary>
          <p>
            Saved run discoveries: {metadata.journal.join(" · ")}. Verified
            platform achievements and progression come from Ranked solo.
          </p>
        </details>
      )}
      {view.mods.length > 0 && (
        <p className="positive">
          Build:{" "}
          {view.mods
            .map((id) => mods.find((m) => m.id === id)?.name)
            .join(" · ")}
          {view.helper &&
            ` · ${view.helper.kind} (${Math.ceil(view.helper.hp)} HP)`}
        </p>
      )}
      {message && (
        <p className="game-hint" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
