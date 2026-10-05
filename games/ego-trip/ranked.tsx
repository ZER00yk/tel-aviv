"use client";
import { translateMovementKey } from "../../packages/shared/src/movement";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameSDK } from "@tell-aviv/game-sdk";
import { readController, type RuntimeSettings } from "@tell-aviv/game-runtime";
import { bosses, mods, weapons } from "./content";
import type { Input, World } from "./engine";
import { arenaFor } from "./arena";
import { journeyView } from "./journey-view";
import type { EgoRankedView } from "../../packages/platform/src/egoRanked";
import type { RankedModifier } from "../server/ego-ranked";

const neutral = (): Input => ({
  x: 0,
  y: 0,
  aimX: 450,
  aimY: 170,
  attack: false,
  alternate: false,
  dash: false,
});
async function rankedRequest<T>(operation = "", payload?: unknown): Promise<T> {
  const response = await fetch(
    `/api/games/ego-trip/ranked${operation ? `/${operation}` : ""}`,
    {
      method: payload === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers:
        payload === undefined ? {} : { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    },
  );
  const body = (await response.json()) as { data?: T; error?: string };
  if (!response.ok || body.error)
    throw new Error(body.error ?? "Ranked service unavailable");
  return body.data as T;
}
function paint(
  canvas: HTMLCanvasElement,
  world: World,
  reducedMotion: boolean,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, 900, 560);
  ctx.fillStyle = "#10151e";
  ctx.fillRect(0, 0, 900, 560);
  ctx.strokeStyle = "#2b3448";
  ctx.lineWidth = 1;
  for (let x = 0; x < 900; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 560);
    ctx.stroke();
  }
  for (let y = 0; y < 560; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(900, y);
    ctx.stroke();
  }
  const circle = (
    x: number,
    y: number,
    radius: number,
    color: string,
    filled = true,
  ) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle = color;
    if (filled) ctx.fill();
    else ctx.stroke();
  };
  for (const terrain of arenaFor(world.bossIndex).terrain) {
    circle(
      terrain.x,
      terrain.y,
      terrain.radius,
      terrain.kind === "cover"
        ? "#40506b"
        : terrain.kind === "heat"
          ? "#975530"
          : "#66757e",
    );
  }
  for (const enemy of world.enemies) {
    circle(
      enemy.x,
      enemy.y,
      18,
      enemy.kind === "bulwark" ? "#e9bd6f" : "#cc94b7",
    );
    ctx.fillStyle = "#ffffff";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(`${enemy.kind} ${Math.ceil(enemy.hp)}`, enemy.x, enemy.y - 24);
  }
  if (world.campaign?.objective) {
    const objective = world.campaign.objective;
    circle(objective.x, objective.y, 30, "#9df3c4", false);
    ctx.fillStyle = "#9df3c4";
    ctx.font = "16px system-ui";
    ctx.fillText(
      `${Math.floor(objective.progress)}/${objective.target}`,
      objective.x,
      objective.y - 40,
    );
  }
  for (const h of world.hazards) {
    ctx.lineWidth = h.timer > 0 ? 3 : Math.max(3, h.radius * 2);
    const color =
      h.damage === 0 ? "#9eeac4" : h.timer > 0 ? "#ffc97e" : "#ff7f7f";
    ctx.globalAlpha = h.timer > 0 ? 0.65 : 0.85;
    if (h.kind === "line") {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      ctx.lineTo(h.x2, h.y2);
      ctx.stroke();
    } else {
      ctx.lineWidth =
        h.kind === "ring" ? Math.max(3, h.radius - h.safeRadius) : 3;
      circle(
        h.x,
        h.y,
        h.kind === "ring" ? (h.radius + h.safeRadius) / 2 : h.radius,
        color,
        h.timer <= 0 && h.kind === "circle",
      );
    }
    ctx.globalAlpha = 1;
  }
  for (const b of world.bullets)
    circle(b.x, b.y, b.radius, b.enemy ? "#ffad9e" : "#b7ffd1");
  const boss = bosses[Math.min(world.bossIndex, bosses.length - 1)];
  const color = `#${boss.color.toString(16).padStart(6, "0")}`;
  if (world.boss.hp > 0 && world.stage === "fight") {
    circle(world.boss.x, world.boss.y, 28, color);
    if (journeyView(world)?.shielded) {
      ctx.lineWidth = 4;
      circle(world.boss.x, world.boss.y, 43, "#ffd67f", false);
    }
    circle(
      world.boss.x,
      world.boss.y,
      reducedMotion ? 36 : 36 + Math.sin(world.time * 3) * 3,
      color,
      false,
    );
    ctx.fillStyle = "#f5f0ff";
    ctx.font = "bold 18px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(boss.name, world.boss.x, world.boss.y - 45);
  }
  if (world.helper)
    circle(
      world.player.x - 28,
      world.player.y - 28,
      10,
      world.helper.kind === "medic" ? "#8be9a7" : "#ffe4a3",
    );
  circle(
    world.player.x,
    world.player.y,
    13,
    world.player.invulnerable > 0 ? "#ffffff" : "#8de5d2",
  );
  ctx.lineWidth = 2;
  circle(world.player.x, world.player.y, 20, "#8de5d2", false);
}

export function EgoRankedClient({
  sdk: _sdk,
  settings,
}: {
  sdk: GameSDK;
  settings: RuntimeSettings;
}) {
  const [view, setView] = useState<EgoRankedView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"boss-gauntlet" | "campaign">(
    "boss-gauntlet",
  );
  const [weapon, setWeapon] = useState("pulse");
  const [difficulty, setDifficulty] = useState<"standard" | "volatile">(
    "standard",
  );
  const [modifiers, setModifiers] = useState<RankedModifier[]>([]);
  const [helper, setHelper] = useState("none");
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<Input>(neutral());
  const keys = useRef(new Set<string>());
  const latest = useRef(view);
  latest.current = view;
  const locked = useRef(false);
  const interactionPending = useRef(false);
  const prefs = useRef(settings);
  prefs.current = settings;
  useEffect(() => {
    keys.current.clear();
    input.current.x = 0;
    input.current.y = 0;
  }, [settings.movementKeys]);
  const mounted = useRef(true);
  const heard = useRef({ id: "", shots: 0, hp: 100, kills: 0, status: "" });
  useEffect(() => {
    settings.audio?.setTheme(true);
    return () => settings.audio?.setTheme(false);
  }, [settings.audio]);
  const reload = useCallback(async () => {
    const loaded = await rankedRequest<EgoRankedView>();
    if (mounted.current) {
      latest.current = loaded;
      setView(loaded);
    }
    return loaded;
  }, []);
  useEffect(() => {
    mounted.current = true;
    void reload().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not load ranked runs"),
    );
    return () => {
      mounted.current = false;
      input.current = neutral();
    };
  }, [reload]);
  const intent = useCallback(
    async (
      command: string,
      payload: Record<string, unknown> = {},
      silent = false,
    ) => {
      if (locked.current && !silent) {
        interactionPending.current = true;
        setBusy(true);
        const deadline = Date.now() + 5000;
        while (locked.current && mounted.current && Date.now() < deadline)
          await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
        interactionPending.current = false;
        if (!mounted.current) return;
        if (locked.current) {
          setError("The current ranked command is still pending; try again.");
          setBusy(false);
          return;
        }
      }
      const run = latest.current?.run;
      if (!run || run.status !== "active" || locked.current) {
        if (!silent) setBusy(false);
        return;
      }
      locked.current = true;
      if (!silent) setBusy(true);
      try {
        const updated = await rankedRequest<EgoRankedView>("intent", {
          runId: run.id,
          expectedRevision: run.revision,
          command,
          payload,
        });
        if (mounted.current) {
          latest.current = updated;
          setView(updated);
          setError("");
        }
      } catch (e) {
        if (mounted.current) {
          const message =
            e instanceof Error ? e.message : "Ranked command failed";
          if (!message.includes("too quickly")) setError(message);
          if (message.includes("conflict") || message.includes("ended"))
            await reload().catch(() => undefined);
        }
      } finally {
        locked.current = false;
        if (mounted.current && !silent) setBusy(false);
      }
    },
    [reload],
  );
  useEffect(() => {
    const timer = window.setInterval(() => {
      const run = latest.current?.run;
      if (
        !run ||
        run.status !== "active" ||
        run.world.stage !== "fight" ||
        prefs.current.paused ||
        interactionPending.current
      )
        return;
      const gamepad = readController();
      input.current.x =
        (keys.current.has("d") || keys.current.has("arrowright") ? 1 : 0) -
          (keys.current.has("a") || keys.current.has("arrowleft") ? 1 : 0) ||
        gamepad.x;
      input.current.y =
        (keys.current.has("s") || keys.current.has("arrowdown") ? 1 : 0) -
          (keys.current.has("w") || keys.current.has("arrowup") ? 1 : 0) ||
        gamepad.y;
      if (gamepad.attack) {
        const target =
          run.world.enemies.find((enemy) => enemy.hp > 0) ?? run.world.boss;
        input.current.aimX = target.x;
        input.current.aimY = target.y;
      }
      void intent(
        "input",
        {
          ...input.current,
          attack:
            input.current.attack || keys.current.has("j") || gamepad.attack,
          alternate: keys.current.has("k") || gamepad.alternate,
          dash: keys.current.has(" ") || keys.current.has("l") || gamepad.dash,
        },
        true,
      );
    }, 125);
    return () => window.clearInterval(timer);
  }, [intent]);
  useEffect(() => {
    if (canvas.current && view?.run)
      paint(canvas.current, view.run.world, !!settings.reducedMotion);
    if (view?.run) {
      const { run } = view;
      if (heard.current.id === run.id) {
        if (run.world.shots > heard.current.shots)
          settings.audio?.effect("shot");
        if (run.world.player.hp < heard.current.hp)
          settings.audio?.effect("hit");
        if (run.world.kills > heard.current.kills)
          settings.audio?.effect(
            run.status === "completed" ? "victory" : "pickup",
          );
      }
      heard.current = {
        id: run.id,
        shots: run.world.shots,
        hp: run.world.player.hp,
        kills: run.world.kills,
        status: run.status,
      };
    }
  }, [view, settings.reducedMotion, settings.audio]);
  const start = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      const started = await rankedRequest<EgoRankedView>("start", {
        mode,
        weapon,
        difficulty,
        modifiers,
        helper: helper === "none" ? null : helper,
      });
      setView(started);
      setError("");
      input.current = neutral();
      window.setTimeout(() => canvas.current?.focus(), 0);
      settings.audio?.effect("click");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start ranked run");
      await reload().catch(() => undefined);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const run = view?.run;
  const active = run?.status === "active";
  const world = run?.world;
  const journey = world ? journeyView(world) : null;
  return (
    <section
      className="game-card ego-ranked"
      aria-label="Server-verified Ego Trip"
    >
      <style>{`.ego-ranked canvas{width:100%;height:auto;display:block;border:1px solid #55617a;border-radius:12px;touch-action:none}.ego-ranked canvas:focus-visible{outline:3px solid #b6f5d2;outline-offset:4px}.ego-ranked .ranked-controls{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.ego-ranked label{display:grid;gap:6px}.ego-ranked .ranked-summary{display:flex;gap:22px;flex-wrap:wrap;margin:16px 0}.ego-ranked .ranked-touch{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.ego-ranked button{min-height:42px}.ego-ranked .ranked-history{max-height:240px;overflow:auto}`}</style>
      <h2>Ranked solo</h2>
      <p>
        Combat, unlocks and completion are simulated and saved by the server.
        Choose the eight-boss gauntlet or the full forty-room journey. Plan
        45–60 minutes for the journey, including route and build choices. Both
        are separate from your casual campaign checkpoint. The ranking clock
        continues during pauses and reconnects.
      </p>
      {error && <p role="alert">{error}</p>}
      {!view && <p role="status">Loading ranked progress…</p>}
      {view && !active && (
        <div className="ranked-controls">
          <label>
            Ranked mode
            <select
              value={mode}
              onChange={(e) =>
                setMode(e.target.value as "boss-gauntlet" | "campaign")
              }
            >
              <option value="boss-gauntlet">Eight-boss gauntlet</option>
              <option value="campaign">Full journey · forty rooms</option>
            </select>
          </label>
          <label>
            Ranked weapon
            <select value={weapon} onChange={(e) => setWeapon(e.target.value)}>
              {view.progress.unlockedWeapons.map((id) => (
                <option key={id} value={id}>
                  {weapons[id as keyof typeof weapons]?.name ?? id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ranked difficulty
            <select
              value={difficulty}
              onChange={(e) =>
                setDifficulty(e.target.value as "standard" | "volatile")
              }
            >
              <option value="standard">Standard</option>
              <option
                value="volatile"
                disabled={!view.progress.challenges.includes("volatile")}
              >
                Volatile · unlock by defeating Austin
              </option>
            </select>
          </label>
          <label>
            Starting helper
            <select value={helper} onChange={(e) => setHelper(e.target.value)}>
              <option value="none">None</option>
              {view.progress.unlockedHelpers.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          {(["fragile", "no-helper"] as const).map((modifier) => (
            <label key={modifier}>
              <span>
                <input
                  type="checkbox"
                  checked={modifiers.includes(modifier)}
                  disabled={!view.progress.challenges.includes(modifier)}
                  onChange={(e) =>
                    setModifiers((old) =>
                      e.target.checked
                        ? [...old, modifier]
                        : old.filter((item) => item !== modifier),
                    )
                  }
                />{" "}
                {modifier}
              </span>
            </label>
          ))}
          <button disabled={busy} onClick={() => void start()}>
            Start ranked run
          </button>
        </div>
      )}
      {run && world && (
        <>
          <div className="ranked-summary" aria-live="polite">
            <span>
              Run: <strong>{run.status}</strong>
            </span>
            <span>
              Health:{" "}
              <strong>
                {Math.ceil(world.player.hp)} / {Math.ceil(world.player.maxHp)}
              </strong>
            </span>
            <span>
              Bosses defeated: <strong>{world.kills}</strong>
              {world.campaign && (
                <>
                  {" "}
                  · room <strong>
                    {world.campaign.roomIndex + 1} / 40
                  </strong> · {world.campaign.room.name}
                </>
              )}
            </span>
            <span>
              {bosses[Math.min(world.bossIndex, bosses.length - 1)]?.name}:{" "}
              <strong>{Math.max(0, Math.ceil(world.boss.hp))} HP</strong>
            </span>
            <span>
              Revision: <strong>{run.revision}</strong>
            </span>
          </div>
          {journey && (
            <p role="status">
              <strong>{journey.label}</strong>: {journey.task}
              {journey.shielded && " The gold ring marks the boss shield."}
            </p>
          )}
          <p>{world.message}</p>
          <canvas
            ref={canvas}
            width={900}
            height={560}
            tabIndex={0}
            aria-label="Ranked combat arena. Move with WASD or arrows, aim with pointer, J fires at aim, K alternate, Space dashes."
            onKeyDown={(e) => {
              const key = translateMovementKey(
                e.code,
                e.key,
                prefs.current.movementKeys,
              );
              if (
                [
                  "w",
                  "a",
                  "s",
                  "d",
                  "arrowup",
                  "arrowdown",
                  "arrowleft",
                  "arrowright",
                  "j",
                  "k",
                  "l",
                  " ",
                ].includes(key)
              ) {
                e.preventDefault();
                keys.current.add(key);
              }
            }}
            onKeyUp={(e) =>
              keys.current.delete(
                translateMovementKey(e.code, e.key, prefs.current.movementKeys),
              )
            }
            onBlur={() => {
              keys.current.clear();
              input.current = neutral();
            }}
            onPointerMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              input.current.aimX = Math.max(
                0,
                Math.min(900, ((e.clientX - box.left) * 900) / box.width),
              );
              input.current.aimY = Math.max(
                0,
                Math.min(560, ((e.clientY - box.top) * 560) / box.height),
              );
            }}
            onPointerDown={(e) => {
              e.currentTarget.focus();
              input.current.attack = true;
              const box = e.currentTarget.getBoundingClientRect();
              input.current.aimX = Math.max(
                0,
                Math.min(900, ((e.clientX - box.left) * 900) / box.width),
              );
              input.current.aimY = Math.max(
                0,
                Math.min(560, ((e.clientY - box.top) * 560) / box.height),
              );
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerUp={() => {
              input.current.attack = false;
            }}
            onPointerCancel={() => {
              input.current.attack = false;
            }}
          />
          {active && world.stage === "fight" && (
            <div className="ranked-touch" aria-label="Ranked touch controls">
              {[
                ["↑", "w"],
                ["←", "a"],
                ["↓", "s"],
                ["→", "d"],
                ["Fire", "j"],
                ["Alternate", "k"],
                ["Dash", " "],
              ].map(([label, key]) => (
                <button
                  key={key}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    keys.current.add(key);
                  }}
                  onPointerUp={() => keys.current.delete(key)}
                  onPointerCancel={() => keys.current.delete(key)}
                  aria-label={`Ranked ${label}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {active && world.stage === "choice" && (
            <div>
              <h3>Choose a server-offered mod</h3>
              {world.offered.map((id) => (
                <button
                  key={id}
                  disabled={busy}
                  onClick={() => void intent("mod", { id })}
                >
                  {mods.find((m) => m.id === id)?.name ?? id}
                </button>
              ))}
            </div>
          )}
          {active && world.stage === "route" && world.campaign && (
            <div>
              <h3>Choose your campaign route</h3>
              {world.campaign.routes.map((route) => (
                <button
                  key={route.id}
                  disabled={busy}
                  onClick={() => void intent("route", { id: route.id })}
                >
                  {route.name} · {route.kind}
                </button>
              ))}
            </div>
          )}
          {active && world.stage === "event" && world.campaign && (
            <div>
              <h3>{world.campaign.room.name}</h3>
              <p>{world.campaign.room.description}</p>
              {(world.campaign.room.kind === "weapon"
                ? ["safe", ...Object.keys(weapons)]
                : world.campaign.room.kind === "helper"
                  ? ["safe", "gunner", "medic"]
                  : world.campaign.room.kind === "trade"
                    ? ["safe", "sell", "buy"]
                    : world.campaign.room.kind === "secret"
                      ? ["safe"]
                      : ["safe", "risk"]
              ).map((choice) => (
                <button
                  key={choice}
                  disabled={
                    busy ||
                    (run.modifiers.includes("no-helper") &&
                      ["gunner", "medic"].includes(choice))
                  }
                  onClick={() => void intent("event", { choice })}
                >
                  {Object.hasOwn(weapons, choice)
                    ? weapons[choice as keyof typeof weapons].name
                    : choice}
                </button>
              ))}
            </div>
          )}
          {active && world.stage === "shop" && (
            <div>
              <h3>Quiet corner · {world.ego} Ego</h3>
              {(["heal", "helper", "mod", "risk"] as const).map((choice) => (
                <button
                  disabled={
                    busy ||
                    (choice === "helper" && run.modifiers.includes("no-helper"))
                  }
                  key={choice}
                  onClick={() => void intent("shop", { choice })}
                >
                  {choice}
                </button>
              ))}
              <button disabled={busy} onClick={() => void intent("continue")}>
                Continue ranked run
              </button>
            </div>
          )}
          <p className="muted">
            Seed {run.seed} · {run.validationStatus} · {run.gameVersion} ·{" "}
            {Math.round(run.simulatedMs / 1000)} seconds simulated
            {run.completionMs !== null
              ? ` · Completion ${(run.completionMs / 1000).toFixed(1)}s`
              : ""}
          </p>
          {active && (
            <button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Abandon this ranked run? Your casual checkpoint and earned unlocks are preserved.",
                  )
                )
                  void intent("abandon");
              }}
            >
              Abandon ranked run
            </button>
          )}
        </>
      )}
      {view && (
        <>
          <h3>Permanent verified progress</h3>
          <p>
            {view.progress.completions} ranked clears ·{" "}
            {view.progress.coopCompletions} co-op clears ·{" "}
            {view.progress.insight} insight · {view.progress.bosses.length} boss
            rewards · {view.progress.unlockedWeapons.length} weapons unlocked
          </p>
          <p>
            Defeating bosses unlocks weapons, helpers and challenges. Completing
            a verified run earns a profile badge.
          </p>
          {view.progress.discoveries.length > 0 && (
            <p>
              Verified co-op discoveries: {view.progress.discoveries.join(", ")}
            </p>
          )}
          <details>
            <summary>Recent ranked run records ({view.history.length})</summary>
            <ol className="ranked-history">
              {view.history.map((entry) => (
                <li key={entry.id}>
                  {entry.status} · {entry.mode} · {entry.difficulty} ·{" "}
                  {entry.finalBossReached ?? "First encounter"} ·{" "}
                  {entry.validationStatus} ·{" "}
                  {new Date(entry.startedAt).toLocaleString()}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </section>
  );
}
