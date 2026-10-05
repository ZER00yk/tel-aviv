"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { GameSDK } from "@tell-aviv/game-sdk";
import { gameById } from "../../../games/catalog";
import { useGameAudio, type RuntimeAudio } from "./audio";
import { readController } from "./input";
import {
  defaultMovement,
  movementActions,
  movementCodes,
  movementKeysSchema,
  type MovementKeys,
} from "../../shared/src/movement";
export interface GamePreferences {
  volume?: number;
  music?: boolean;
  effects?: boolean;
  reducedMotion?: boolean;
  movementKeys?: MovementKeys;
}
export interface RuntimeSettings {
  paused: boolean;
  muted: boolean;
  reducedMotion: boolean;
  volume?: number;
  music?: boolean;
  effects?: boolean;
  audio?: RuntimeAudio;
  movementKeys?: MovementKeys;
}
export function GameShell({
  sdk,
  preferences: accountPreferences,
  children,
}: {
  sdk: GameSDK;
  preferences?: GamePreferences;
  children: (settings: RuntimeSettings) => ReactNode;
}) {
  const game = gameById(sdk.gameId)!;
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false),
    [muted, setMuted] = useState(true),
    [reducedMotion, setReducedMotion] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [identity, setIdentity] = useState(""),
    [notice, setNotice] = useState("");
  const [volume, setVolume] = useState(accountPreferences?.volume ?? 0.7),
    [music, setMusic] = useState(accountPreferences?.music !== false),
    [effects, setEffects] = useState(accountPreferences?.effects !== false);
  const [movementKeys, setMovementKeys] = useState<MovementKeys>(
    accountPreferences?.movementKeys ?? {},
  );
  const [movementDraft, setMovementDraft] = useState<MovementKeys>(
    accountPreferences?.movementKeys ?? {},
  );
  const audio = useGameAudio({ paused, muted, volume, music, effects });
  useEffect(() => {
    setMovementKeys(accountPreferences?.movementKeys ?? {});
    setMovementDraft(accountPreferences?.movementKeys ?? {});
    setVolume(accountPreferences?.volume ?? 0.7);
    setMusic(accountPreferences?.music !== false);
    setEffects(accountPreferences?.effects !== false);
    setReducedMotion(
      accountPreferences?.reducedMotion ??
        matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  }, [
    accountPreferences?.volume,
    accountPreferences?.music,
    accountPreferences?.effects,
    accountPreferences?.reducedMotion,
    accountPreferences?.movementKeys,
  ]);
  useEffect(() => {
    try {
      const prefs = JSON.parse(
        localStorage.getItem("ta-game-settings") || "{}",
      );
      setMuted(prefs.muted ?? true);
    } catch {}
    let alive = true;
    sdk
      .user()
      .then((user) => {
        if (alive) setIdentity(user.displayName || user.username);
      })
      .catch(() => {});
    sdk
      .start()
      .then(() => sdk.presence())
      .catch((e) => {
        if (alive) setNotice(e.message);
      });
    const timer = setInterval(() => {
      void sdk.presence().catch(() => {});
    }, 45000);
    const onVisibility = () => {
      if (document.hidden) setPaused(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.repeat) {
        setPaused((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKey);
      void sdk.end().catch(() => {});
    };
  }, [sdk]);
  useEffect(() => {
    let held = false;
    const timer = setInterval(() => {
      const pressed = readController().pause;
      if (pressed && !held && !document.hidden) setPaused((value) => !value);
      held = pressed;
    }, 100);
    return () => clearInterval(timer);
  }, []);
  const preferences = (next: { muted?: boolean; reducedMotion?: boolean }) => {
    const value = { muted, reducedMotion, ...next };
    setMuted(value.muted);
    setReducedMotion(value.reducedMotion);
    try {
      localStorage.setItem(
        "ta-game-settings",
        JSON.stringify({ muted: value.muted }),
      );
    } catch {}
  };
  async function saveMovement(next = movementDraft) {
    const parsed = movementKeysSchema.safeParse(next);
    if (!parsed.success) {
      setNotice(parsed.error.issues[0].message);
      return;
    }
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { games: { movementKeys: parsed.data } },
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw Error(body.error ?? "Could not save controls");
      setMovementKeys(parsed.data);
      setMovementDraft(parsed.data);
      setNotice("Movement controls saved to your account.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not save controls",
      );
    }
  }
  return (
    <div className="game-shell" ref={ref}>
      <div className="game-toolbar">
        <a href="/games" className="game-button">
          ← Games
        </a>
        <span className="game-title">
          {game.icon} {game.name}
        </span>
        <span className="game-user">{identity}</span>
        <button onClick={() => setPaused((v) => !v)}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button onClick={() => setSettingsOpen((v) => !v)}>Settings</button>
        <button
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else
              void ref.current
                ?.requestFullscreen()
                .catch(() =>
                  setNotice("Fullscreen is unavailable in this browser."),
                );
          }}
        >
          Fullscreen
        </button>
      </div>
      {settingsOpen && (
        <div className="game-settings">
          <label>
            <input
              type="checkbox"
              checked={muted}
              onChange={(e) => preferences({ muted: e.target.checked })}
            />{" "}
            Mute audio
          </label>
          <label>
            <input
              type="checkbox"
              checked={reducedMotion}
              onChange={(e) => preferences({ reducedMotion: e.target.checked })}
            />{" "}
            Reduce motion
          </label>
          <label>
            Game volume
            <input
              aria-label="Game volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={music}
              onChange={(e) => setMusic(e.target.checked)}
            />{" "}
            Music
          </label>
          <label>
            <input
              type="checkbox"
              checked={effects}
              onChange={(e) => setEffects(e.target.checked)}
            />{" "}
            Sound effects
          </label>
          {sdk.gameId === "ego-trip" && (
            <fieldset>
              <legend>Ego Trip movement controls</legend>
              {movementActions.map((action) => (
                <label key={action}>
                  Move {action}
                  <select
                    aria-label={`Move ${action} key`}
                    value={movementDraft[action] ?? defaultMovement[action]}
                    onChange={(event) =>
                      setMovementDraft((value) => ({
                        ...value,
                        [action]: event.target.value,
                      }))
                    }
                  >
                    {movementCodes.map((code) => (
                      <option key={code} value={code}>
                        {code.slice(3)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <button onClick={() => void saveMovement()}>
                Save movement controls
              </button>
              <button onClick={() => void saveMovement({})}>
                Reset movement controls
              </button>
              <p>
                These controls apply to solo, ranked and co-op play. Arrow keys
                remain available. Attack, dash and interaction keys use the
                controls shown by each mode.
              </p>
            </fieldset>
          )}
          <p>
            Escape pauses. Each game shows its own controls. Your play status
            clears when you leave. Account preferences set the defaults; changes
            here last for this game session.
          </p>
        </div>
      )}
      {notice && (
        <p className="game-error" role="status">
          {notice}
        </p>
      )}
      <div className="game-body" aria-label={game.name}>
        {children({
          paused,
          muted,
          reducedMotion,
          volume,
          music,
          effects,
          audio,
          movementKeys,
        })}
      </div>
      <div className="game-footer">
        {game.ranked
          ? "Economy and competitive outcomes validated by the server."
          : "Casual play · browser simulations are unranked."}{" "}
        · v{game.version}
      </div>
      <style>{`
.game-shell{background:#10151f;color:#edf2fa;border:1px solid #2c3547;border-radius:18px;overflow:hidden;min-height:580px;font-family:system-ui,sans-serif}.game-shell:fullscreen{overflow:auto}.game-toolbar{display:flex;align-items:center;gap:8px;padding:14px;background:#171e2a;flex-wrap:wrap}.game-title{font-weight:750;font-size:18px;flex:1}.game-user{color:#a8b5cd;font-size:13px}.game-shell button,.game-button{border:1px solid #354056;background:#232e40;color:#f1f5fb;padding:9px 13px;border-radius:9px;cursor:pointer;text-decoration:none;font:inherit;font-size:13px}.game-shell button:hover,.game-button:hover{background:#354560}.game-shell button:disabled{opacity:.4;cursor:not-allowed}.game-shell button.selected{border-color:#bcff6b;background:#304230;color:#dcffac}.game-body{padding:18px;position:relative}.game-footer{color:#8291aa;padding:12px 18px;border-top:1px solid #283247;font-size:12px}.game-settings{padding:16px;display:flex;gap:20px;flex-wrap:wrap;background:#222b3c}.game-settings p{width:100%;margin:0;color:#9eb0ca;font-size:13px}.game-error{background:#482a31;color:#ffb1b1;padding:12px;margin:10px;border-radius:8px}.game-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.game-card{padding:18px;border:1px solid #303d52;border-radius:12px;background:#182231}.game-card h3{margin:0 0 10px}.game-card p{color:#a4b4cc;font-size:13px;line-height:1.6}.game-stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}.game-stat{background:#202c3b;padding:12px 18px;border-radius:12px;min-width:100px}.game-stat small{display:block;color:#90a3bf;font-size:11px;text-transform:uppercase;letter-spacing:1px}.game-stat strong{font-size:23px}.game-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0}.game-shell input,.game-shell select{background:#101923;color:#f1f5fb;border:1px solid #45516b;padding:9px;border-radius:7px;font:inherit;max-width:100%}.game-shell input[type=checkbox]{accent-color:#b8ff63}.game-hint{color:#9cabbe;font-size:13px;line-height:1.6}.game-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}.game-canvas{width:100%;max-width:960px;border:1px solid #38465c;border-radius:12px;overflow:hidden;position:relative;touch-action:none}.game-canvas canvas{display:block;width:100%;height:auto}.game-overlay{position:absolute;inset:0;display:grid;place-items:center;background:#101923a8;z-index:2;font-size:28px;font-weight:700}.game-shell progress{accent-color:#bfff71;width:100%}.game-shell .positive{color:#baff75}.game-shell .danger{color:#ff8585}.game-shell .game-log{padding:12px;background:#111923;border-radius:8px;color:#abbbd1;font-size:13px;max-height:140px;overflow:auto} @media(max-width:600px){.game-body{padding:10px}.game-toolbar{padding:10px}.game-user{display:none}.game-stat{min-width:80px;padding:9px}.game-title{width:100%;flex-basis:100%}}
`}</style>
    </div>
  );
}
