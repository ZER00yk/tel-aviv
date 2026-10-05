"use client";
import { useEffect, useRef, useState } from "react";
import type { LevelData } from "../../../../packages/platform/src/classes/models";
import { useGameAudio } from "../../../../packages/game-runtime/src/audio";
import { api } from "../classes/api";
import {
  doorIsOpen,
  initialPlayer,
  objectColors,
  stepPlayer,
  objectIsActive,
  runtimeObject,
  runtimeObjects,
  FIXED_STEP,
  INPUT_KEYS,
  type PlayerState,
  type InputFrame,
} from "./physics";
import styles from "../classes/Workspace.module.css";
import ObjectShape from "./ObjectShape";
type Attempt = {
  attemptId: string;
  seed: number;
  nextSequence: number;
  state: PlayerState;
  status: string;
  completionRecorded: boolean;
  level?: LevelData;
};
export default function Playtest({
  level,
  creationId,
  onVerifiedComplete,
}: {
  level: LevelData;
  creationId?: string;
  onVerifiedComplete?: () => void | Promise<void>;
}) {
  const [player, setPlayer] = useState(() => initialPlayer(level));
  const [renderLevel, setRenderLevel] = useState(level);
  const [epoch, setEpoch] = useState(0);
  const [verification, setVerification] = useState(
    creationId ? "Starting verified play…" : "Local playtest",
  );
  const [problem, setProblem] = useState("");
  const [muted, setMuted] = useState(true);
  const audio = useGameAudio({ muted, effects: true, music: false });
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const levelRef = useRef(level);
  levelRef.current = level;
  const verifiedCompleteCallback = useRef(onVerifiedComplete);
  verifiedCompleteCallback.current = onVerifiedComplete;
  const notifiedAttempt = useRef<string | null>(null);
  const localLevel = creationId ? undefined : level;
  const startedAttempt = useRef<{
    creationId: string;
    epoch: number;
    promise: Promise<Attempt>;
  } | null>(null);
  const state = useRef(player);
  const keys = useRef(new Set<string>());
  // A short interaction can begin and end between animation frames. Preserve
  // its edge until one fixed simulation tick records it for server replay.
  const interactionQueued = useRef(false);
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let canceled = false,
      frame = 0,
      ready = !creationId,
      blocked = false,
      syncing = false;
    let previous = performance.now(),
      accumulator = 0,
      lastFlush = 0;
    // Published attempts retain the server snapshot until an explicit restart.
    let simulationLevel = localLevel ?? levelRef.current;
    let attempt: Attempt | undefined;
    const pending: InputFrame[] = [];
    const pendingTicks = () =>
      pending.reduce((sum, input) => sum + input.ticks, 0);
    function notifyCompletion(result: Attempt) {
      if (
        result.status !== "completed" ||
        notifiedAttempt.current === result.attemptId
      )
        return;
      notifiedAttempt.current = result.attemptId;
      void Promise.resolve()
        .then(() => verifiedCompleteCallback.current?.())
        .catch(() => {
          // A parent statistics refresh cannot invalidate a verified result.
        });
    }
    state.current = initialPlayer(simulationLevel);
    setRenderLevel(simulationLevel);
    setPlayer(state.current);
    keys.current.clear();
    interactionQueued.current = false;
    setProblem("");
    setVerification(creationId ? "Starting verified play…" : "Local playtest");
    area.current?.focus();
    async function flush() {
      if (
        !creationId ||
        !attempt ||
        syncing ||
        blocked ||
        !pending.length ||
        canceled
      )
        return;
      syncing = true;
      const batch: InputFrame[] = [];
      let ticks = 0;
      while (
        pending.length &&
        batch.length < 60 &&
        ticks + pending[0].ticks <= 180
      ) {
        const input = pending.shift()!;
        batch.push(input);
        ticks += input.ticks;
      }
      try {
        const result = await api<Attempt>(
          `creations/${creationId}/attempts/${attempt.attemptId}/input`,
          "POST",
          { expectedSequence: attempt.nextSequence, frames: batch },
        );
        if (canceled) return;
        attempt = result;
        if (result.status !== "playing") {
          state.current = result.state;
          setPlayer(result.state);
          ready = false;
          pending.length = 0;
          setVerification(
            result.status === "completed"
              ? "Completion verified by server"
              : `Verified attempt ${result.status}`,
          );
          notifyCompletion(result);
        } else setVerification("Verified play · inputs synchronized");
      } catch (error) {
        if (canceled) return;
        blocked = true;
        setProblem(
          error instanceof Error
            ? error.message
            : "Could not synchronize this play attempt",
        );
        setVerification("Verification paused · restart to try again");
      } finally {
        syncing = false;
      }
      if (
        !canceled &&
        pending.length &&
        (state.current.won || state.current.failed)
      )
        void flush();
    }
    if (creationId) {
      // React may replay this effect before its request resolves. Both effects
      // must await one logical start, because another start expires the first.
      if (
        !startedAttempt.current ||
        startedAttempt.current.creationId !== creationId ||
        startedAttempt.current.epoch !== epoch
      )
        startedAttempt.current = {
          creationId,
          epoch,
          promise: api<Attempt>(`creations/${creationId}/attempts`, "POST", {}),
        };
      void startedAttempt.current.promise
        .then((result) => {
          if (canceled) return;
          attempt = result;
          if (!result.level)
            throw new Error(
              "The server did not return this attempt's level. Restart to recover.",
            );
          simulationLevel = result.level;
          setRenderLevel(result.level);
          state.current = result.state;
          setPlayer(result.state);
          ready = result.status === "playing";
          previous = performance.now();
          setVerification(
            result.status === "completed"
              ? "Completion verified by server"
              : "Verified play · recording inputs",
          );
          notifyCompletion(result);
        })
        .catch((error) => {
          if (canceled) return;
          blocked = true;
          setProblem(
            error instanceof Error
              ? error.message
              : "Could not start verified play",
          );
          setVerification("Verified play could not start");
        });
    } else startedAttempt.current = null;
    function tick(time: number) {
      const elapsed = Math.max(0, Math.min((time - previous) / 1000, 0.1));
      previous = time;
      if (
        ready &&
        !blocked &&
        !state.current.won &&
        !state.current.failed &&
        (!creationId || pendingTicks() < 180)
      ) {
        accumulator += elapsed;
        let advanced = 0;
        while (
          accumulator >= FIXED_STEP &&
          advanced < 6 &&
          (!creationId || pendingTicks() < 180)
        ) {
          const tickKeys = new Set(keys.current);
          if (interactionQueued.current) tickKeys.add("e");
          interactionQueued.current = false;
          const input = [...tickKeys]
            .filter((key) => (INPUT_KEYS as readonly string[]).includes(key))
            .sort();
          state.current = stepPlayer(
            simulationLevel,
            state.current,
            new Set(input),
            FIXED_STEP,
          );
          for (const sound of state.current.sounds)
            audioRef.current.effect(
              sound === "success"
                ? "pickup"
                : sound === "danger"
                  ? "hit"
                  : "click",
            );
          if (creationId) {
            const previousInput = pending.at(-1);
            if (
              previousInput &&
              previousInput.ticks < 60 &&
              previousInput.keys.join("|") === input.join("|")
            )
              previousInput.ticks++;
            else pending.push({ keys: input, ticks: 1 });
          }
          accumulator -= FIXED_STEP;
          advanced++;
          if (state.current.won || state.current.failed) break;
        }
        if (advanced) setPlayer(state.current);
      } else accumulator = 0;
      if (
        creationId &&
        pending.length &&
        (time - lastFlush > 800 ||
          pendingTicks() >= 120 ||
          state.current.won ||
          state.current.failed)
      ) {
        lastFlush = time;
        void flush();
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => {
      canceled = true;
      keys.current.clear();
      interactionQueued.current = false;
      cancelAnimationFrame(frame);
    };
  }, [localLevel, creationId, epoch]);
  return (
    <div className={styles.stack}>
      <p className={styles.muted}>
        Arrow keys / WASD to move · Space to jump. Touch controls below. Step on
        switches and pressure plates, collect keys, and jump onto enemies. E
        enters/exits a nearby rail cart or lights an explosive fuse.
      </p>
      <p aria-live="polite" className={styles.muted}>
        {verification}
      </p>
      {problem && <p role="alert">{problem}</p>}
      {player.logicWarning && <p role="alert">{player.logicWarning}</p>}
      {player.objective && (
        <p>
          <strong>Objective:</strong> {player.objective}
        </p>
      )}
      {player.text && <p aria-live="polite">{player.text}</p>}
      <div
        ref={area}
        tabIndex={0}
        aria-label="Level playtest"
        className={styles.canvas}
        onKeyDown={(event) => {
          if ((INPUT_KEYS as readonly string[]).includes(event.key)) {
            event.preventDefault();
            if (event.key === "e" && !event.repeat)
              interactionQueued.current = true;
            keys.current.add(event.key);
          }
        }}
        onKeyUp={(event) => keys.current.delete(event.key)}
        onBlur={() => {
          keys.current.clear();
          interactionQueued.current = false;
        }}
      >
        <svg
          viewBox={`0 0 ${renderLevel.width} ${renderLevel.height}`}
          role="img"
          aria-label="Playable level"
        >
          {runtimeObjects(renderLevel, player)
            .filter((object) => objectIsActive(object, player))
            .sort((a, b) => a.layer - b.layer)
            .map((object) => runtimeObject(object, player))
            .map((object) => {
              const opened =
                object.type === "door" &&
                doorIsOpen(renderLevel, object.id, player);
              const pressed =
                ["button", "switch", "pressure-plate"].includes(object.type) &&
                (player.pressedButtons.includes(object.id) ||
                  player.toggledButtons.includes(object.id));
              return (
                <g key={object.id}>
                  <ObjectShape
                    object={object}
                    dataObjectId={object.id}
                    fill={pressed ? "#fff5aa" : objectColors[object.type]}
                    opacity={
                      opened ? 0.18 : object.type === "trigger-zone" ? 0.2 : 1
                    }
                    stroke={
                      opened
                        ? objectColors.door
                        : object.type === "trigger-zone"
                          ? objectColors[object.type]
                          : "transparent"
                    }
                    strokeDasharray="5 3"
                  />
                  {object.type === "cart" && (
                    <text
                      x={object.x + object.width / 2}
                      y={object.y + 16}
                      textAnchor="middle"
                      fill="#161722"
                      fontSize="12"
                    >
                      {player.vehicleId === object.id ? "Driver" : "E"}
                    </text>
                  )}
                  {object.type === "explosive" && (
                    <text
                      data-testid="explosive-fuse"
                      x={object.x + object.width / 2}
                      y={object.y + 16}
                      textAnchor="middle"
                      fill="#161722"
                      fontSize="12"
                    >
                      {player.explosiveFuses?.[object.id] !== undefined
                        ? player.explosiveFuses[object.id].toFixed(1)
                        : "!"}
                    </text>
                  )}
                  {object.type === "enemy" && (
                    <text
                      x={object.x + object.width / 2}
                      y={object.y + 16}
                      textAnchor="middle"
                      fill="#161722"
                      fontSize="12"
                    >
                      {player.enemies[object.id] ?? object.health ?? 3}
                    </text>
                  )}
                </g>
              );
            })}
          {(player.explosions ?? []).map((blast, index) => (
            <circle
              key={index}
              cx={blast.x}
              cy={blast.y}
              r={blast.radius}
              fill="#ffac4b"
              opacity={Math.max(0, blast.remaining) * 0.6}
              stroke="#ffdc7a"
              strokeWidth={2}
              pointerEvents="none"
            />
          ))}
          <rect
            x={player.x}
            y={player.y}
            width="20"
            height="28"
            rx="5"
            fill="#fff5aa"
            data-testid="creator-player"
          />
        </svg>
      </div>
      <div className={styles.row}>
        {[
          ["←", "ArrowLeft"],
          ["Jump", " "],
          ["→", "ArrowRight"],
          ["Interact", "e"],
        ].map(([label, key]) => (
          <button
            key={key}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              if (key === "e") interactionQueued.current = true;
              keys.current.add(key);
            }}
            onPointerUp={() => keys.current.delete(key)}
            onPointerCancel={() => keys.current.delete(key)}
          >
            {label}
          </button>
        ))}
        <button onClick={() => setEpoch((value) => value + 1)}>Restart</button>
        <button
          aria-pressed={!muted}
          onClick={() => setMuted((value) => !value)}
        >
          {muted ? "Enable sound" : "Mute sound"}
        </button>
        <span>
          Health: {player.health} · Deaths: {player.deaths}
        </span>
        {player.vehicleId && (
          <span role="status">Driving cart · E to exit</span>
        )}
        {Object.entries(player.items)
          .filter(([, count]) => count > 0)
          .map(([item, count]) => (
            <span key={item}>
              {item}: {count}
            </span>
          ))}
        {player.won && (
          <strong className={styles.success}>Level complete!</strong>
        )}
        {player.failed && (
          <strong role="status">Level failed. Restart to try again.</strong>
        )}
      </div>
    </div>
  );
}
