"use client";
import { translateMovementKey } from "../../packages/shared/src/movement";
import { useEffect, useRef, useState } from "react";
import {
  LobbyControls,
  useLobby,
  readController,
} from "@tell-aviv/game-runtime";
import type { RuntimeSettings } from "../../packages/game-runtime/src/shell";
import type { GameSDK } from "@tell-aviv/game-sdk";
import type { CoopView } from "./coop-engine";
import { weapons, type WeaponId } from "./content";

const colors = ["#bfff75", "#79d9ef", "#ffcb75", "#c27fff"];
export function EgoCoopClient({
  sdk,
  settings,
}: {
  sdk: GameSDK;
  settings: RuntimeSettings;
}) {
  const network = useLobby();
  const [userId, setUserId] = useState("");
  const [aimAssist, setAimAssist] = useState(true);
  const [firing, setFiring] = useState(false);
  const [mode, setMode] = useState<"gauntlet" | "campaign">("gauntlet");
  const [weapon, setWeapon] = useState<WeaponId>("pulse");
  const canvas = useRef<HTMLCanvasElement>(null);
  const keys = useRef(new Set<string>());
  const pointer = useRef({ x: 450, y: 160, fire: false, alternate: false });
  const sequence = useRef(0);
  const names = useRef(new Map<string, string>());
  const current = useRef({
    view: null as CoopView | null,
    settings,
    aimAssist,
    firing,
  });
  const state =
    network.lobby?.gameId === "ego-trip"
      ? (network.lobby.state as unknown as CoopView | null)
      : null;
  current.current = { view: state, settings, aimAssist, firing };
  useEffect(() => {
    keys.current.clear();
  }, [settings.movementKeys]);
  if (state)
    sequence.current = Math.max(sequence.current, state.yourSequence + 1);
  const self = state?.players.find((p) => p.id === userId);
  names.current = new Map(
    network.lobby?.players.map((p) => [p.id, p.username]) ?? [],
  );

  useEffect(() => {
    if (state && self && state.elapsed < 0.5 && self.weapon !== weapon)
      network.send("game:action", { type: "coop:weapon", weapon });
  }, [state, self, weapon, network.send]);
  useEffect(() => {
    settings.audio?.setTheme(true);
    return () => settings.audio?.setTheme(false);
  }, [settings.audio]);
  const audioPrevious = useRef({ hp: 100, damage: 0, dash: 0, won: false });
  useEffect(() => {
    if (!self) return;
    const previous = audioPrevious.current;
    if (self.hp < previous.hp) settings.audio?.effect("hit");
    if (self.damage > previous.damage) settings.audio?.effect("shot");
    if (self.dashCooldown > previous.dash) settings.audio?.effect("dash");
    if (state?.stage === "won" && !previous.won)
      settings.audio?.effect("victory");
    audioPrevious.current = {
      hp: self.hp,
      damage: self.damage,
      dash: self.dashCooldown,
      won: state?.stage === "won",
    };
  }, [self, state?.stage, settings.audio]);

  useEffect(() => {
    let active = true;
    void sdk
      .user()
      .then((user) => {
        if (active) setUserId(user.id);
      })
      .catch(() => {});
    network.send("game:lobby:recover");
    return () => {
      active = false;
    };
  }, [sdk, network.send]);
  useEffect(() => {
    if (network.lobby?.gameId !== "ego-trip" && network.lobby) return;
    const timer = setInterval(() => {
      const {
        view,
        settings: prefs,
        aimAssist: assist,
        firing: fire,
      } = current.current;
      if (!view || view.result || view.stage !== "fight" || !network.connected)
        return;
      const target = view.campaign?.enemies.length
        ? view.campaign.enemies[0]
        : view.campaign && view.campaign.room.kind !== "boss"
          ? null
          : view.boss;
      const controller = readController();
      const stopped = prefs.paused || document.hidden;
      const pressed = (name: string) => keys.current.has(name);
      network.send("game:action", {
        type: "coop:input",
        sequence: sequence.current++,
        dx: stopped
          ? 0
          : controller.x ||
            Number(pressed("d") || pressed("arrowright")) -
              Number(pressed("a") || pressed("arrowleft")),
        dy: stopped
          ? 0
          : controller.y ||
            Number(pressed("s") || pressed("arrowdown")) -
              Number(pressed("w") || pressed("arrowup")),
        aimX: assist && target ? target.x : pointer.current.x,
        aimY: assist && target ? target.y : pointer.current.y,
        fire:
          !stopped &&
          (fire || pointer.current.fire || controller.attack || pressed(" ")),
        alternate:
          !stopped &&
          (pointer.current.alternate || controller.alternate || pressed("q")),
        dash: !stopped && (controller.dash || pressed("shift")),
        revive: !stopped && pressed("e"),
      });
    }, 110);
    return () => clearInterval(timer);
  }, [network.send, network.connected, network.lobby?.gameId]);
  useEffect(() => {
    const editable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName));
    const keyDown = (e: KeyboardEvent) => {
      if (editable(e.target)) return;
      const key = translateMovementKey(
        e.code,
        e.key,
        current.current.settings.movementKeys,
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
          "shift",
          " ",
          "q",
          "e",
        ].includes(key)
      ) {
        e.preventDefault();
        keys.current.add(key);
      }
    };
    const keyUp = (e: KeyboardEvent) =>
      keys.current.delete(
        translateMovementKey(
          e.code,
          e.key,
          current.current.settings.movementKeys,
        ),
      );
    const reset = () => {
      keys.current.clear();
      pointer.current.fire = false;
      pointer.current.alternate = false;
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", reset);
    };
  }, []);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    let frame = 0;
    const positions = new Map<string, { x: number; y: number }>();
    const draw = () => {
      const view = current.current.view;
      const ctx = context;
      ctx.fillStyle = "#101623";
      ctx.fillRect(0, 0, 900, 560);
      ctx.strokeStyle = "#243049";
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
      if (view) {
        for (const t of view.arena?.terrain ?? []) {
          ctx.fillStyle =
            t.kind === "cover"
              ? "#3d4c69"
              : t.kind === "heat"
                ? "#ff796e40"
                : "#79d9ef30";
          ctx.beginPath();
          ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
          ctx.fill();
        }

        for (const h of view.hazards) {
          ctx.strokeStyle = h.delay > 0 ? "#ffcb7580" : "#ff796e";
          ctx.fillStyle = h.delay > 0 ? "#ffcb7518" : "#ff796e60";
          ctx.lineWidth = 2;
          if (h.kind === "line") {
            ctx.lineWidth = h.radius * 2;
            ctx.beginPath();
            ctx.moveTo(h.x, h.y);
            ctx.lineTo(h.x2, h.y2);
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
            if (h.kind === "ring")
              ctx.arc(h.x, h.y, h.innerRadius, 0, Math.PI * 2, true);
            ctx.fill();
            ctx.stroke();
          }
        }
        for (const shot of view.shots) {
          ctx.fillStyle = shot.enemy ? "#ff796e" : "#bfff75";
          ctx.beginPath();
          ctx.arc(shot.x, shot.y, shot.radius, 0, Math.PI * 2);
          ctx.fill();
        }
        for (const enemy of view.campaign?.enemies ?? []) {
          ctx.fillStyle =
            enemy.kind === "shooter"
              ? "#c27fff"
              : enemy.kind === "brute"
                ? "#ffcb75"
                : enemy.kind === "splitter"
                  ? "#79d9ef"
                  : "#ff796e";
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.font = "10px system-ui";
          ctx.textAlign = "center";
          ctx.fillText(
            `${Math.ceil(enemy.hp)}`,
            enemy.x,
            enemy.y - enemy.radius - 6,
          );
        }
        const objective = view.campaign?.objective;
        if (objective) {
          ctx.strokeStyle = objective.dropped ? "#ffcb75" : "#79d9ef";
          ctx.fillStyle = objective.dropped ? "#ffcb7530" : "#79d9ef30";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(objective.x, objective.y, 32, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#edf2fa";
          ctx.font = "bold 13px system-ui";
          ctx.textAlign = "center";
          ctx.fillText(
            objective.dropped
              ? "Recover dropped signal"
              : objective.kind === "ward"
                ? "Survey marker"
                : objective.carrying
                  ? "Delivery"
                  : "Pickup",
            objective.x,
            objective.y - 42,
          );
          if (objective.carrierId) {
            const carrier = view.players.find(
              (p) => p.id === objective.carrierId,
            );
            if (carrier) {
              ctx.fillStyle = "#79d9ef";
              ctx.fillRect(carrier.x - 6, carrier.y - 34, 12, 12);
            }
          }
        }
        if (
          view.stage === "fight" &&
          (!view.campaign || view.campaign.room.kind === "boss")
        ) {
          const b = view.boss;
          ctx.fillStyle = `#${b.color.toString(16).padStart(6, "0")}`;
          ctx.beginPath();
          ctx.arc(b.x, b.y, 30, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#fff9";
          ctx.lineWidth = 3;
          ctx.strokeRect(b.x - 20, b.y - 12, 15, 10);
          ctx.strokeRect(b.x + 5, b.y - 12, 15, 10);
          ctx.beginPath();
          ctx.moveTo(b.x - 9, b.y + 13);
          ctx.lineTo(b.x + 9, b.y + 13);
          ctx.stroke();
          ctx.font = "bold 16px system-ui";
          ctx.fillStyle = "#edf2fa";
          ctx.textAlign = "center";
          ctx.fillText(`${b.name} · phase ${b.phase}`, b.x, b.y - 44);
          const journey = view.campaign?.journey;
          if (journey && journey.stage <= journey.stages) {
            ctx.strokeStyle = "#79d9ef";
            ctx.beginPath();
            ctx.arc(b.x, b.y, 38, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        view.players.forEach((player, i) => {
          const old = positions.get(player.id) ?? player;
          const blend = current.current.settings.reducedMotion ? 1 : 0.24;
          const position = {
            x: old.x + (player.x - old.x) * blend,
            y: old.y + (player.y - old.y) * blend,
          };
          positions.set(player.id, position);
          ctx.fillStyle =
            player.status === "alive" ? colors[i % colors.length] : "#63708a";
          ctx.beginPath();
          ctx.arc(position.x, position.y, 13, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#edf2fa";
          ctx.lineWidth = 2;
          if (player.id === userId) {
            ctx.beginPath();
            ctx.arc(position.x, position.y, 18, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (player.helper) {
            ctx.fillStyle =
              player.helperKind === "medic" ? "#8be9a7" : "#ffe4a3";
            ctx.beginPath();
            ctx.arc(position.x + 24, position.y - 20, 9, 0, Math.PI * 2);
            ctx.fill();
          }
          if (player.status === "downed") {
            ctx.strokeStyle = "#79d9ef";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(
              position.x,
              position.y,
              21,
              -Math.PI / 2,
              -Math.PI / 2 + player.reviveProgress * Math.PI,
            );
            ctx.stroke();
          }
          if (player.helper && player.status === "alive") {
            ctx.fillStyle = colors[i % colors.length];
            ctx.fillRect(position.x + 20, position.y - 25, 10, 10);
          }
          ctx.fillStyle = "#edf2fa";
          ctx.textAlign = "center";
          ctx.font = "12px system-ui";
          const name = names.current.get(player.id) ?? `Player ${i + 1}`;
          ctx.fillText(
            `${name} · ${Math.round(player.hp)} HP${player.status !== "alive" ? ` · ${player.status}` : ""}`,
            position.x,
            position.y + 35,
          );
        });
      } else {
        ctx.fillStyle = "#9cabbe";
        ctx.textAlign = "center";
        ctx.font = "20px system-ui";
        ctx.fillText("Gather your team to restore the signal", 450, 280);
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [userId]);

  const touch = (key: string) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      keys.current.add(key);
    },
    onPointerUp: () => {
      keys.current.delete(key);
    },
    onPointerCancel: () => {
      keys.current.delete(key);
    },
  });
  const otherLobby = network.lobby && network.lobby.gameId !== "ego-trip";
  return (
    <section aria-label="Ego Trip co-op">
      <h2>Restore the signal together</h2>
      <p className="game-hint">
        Private 2–4 player gauntlet or synchronized campaign. Shared encounters,
        server-controlled combat, two revives per player. WASD or arrows move;
        Shift dashes; mouse or Space fires; Q uses your alternate; hold E within
        reach of a downed teammate for two seconds. A downed player has 30
        seconds to be rescued. Pausing stops your controls while the team
        continues.
      </p>
      <p className="game-hint">
        The normal campaign crosses eight districts with active recoveries,
        deliveries and surveys between mixed patrols. Teammates protect the
        signal carrier; each boss phase opens after two missions. The classic
        gauntlet remains a short expedition.
      </p>
      {otherLobby && (
        <p className="game-error">
          You are in another game&apos;s room. Leave that room before creating
          an Ego Trip co-op room.
        </p>
      )}
      {!network.lobby && (
        <label>
          Expedition mode{" "}
          <select
            aria-label="Co-op expedition mode"
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as "gauntlet" | "campaign")
            }
          >
            <option value="gauntlet">Classic four-boss gauntlet</option>
            <option value="campaign">
              Synchronized eight-district campaign
            </option>
          </select>
        </label>
      )}
      <LobbyControls
        {...network}
        send={(event, payload) =>
          network.send(
            event,
            event === "game:lobby:create"
              ? { ...payload, coopMode: mode }
              : payload,
          )
        }
        gameId="ego-trip"
        userId={userId}
        coopMode={mode}
      />
      {state?.campaign && (
        <div className="game-card" role="status">
          <h3>{state.campaign.room.name}</h3>
          <p>
            Shared room {state.campaign.room.index + 1} /{" "}
            {state.campaign.totalRooms} · checkpoint{" "}
            {state.campaign.checkpointRoom} · {state.campaign.enemies.length}{" "}
            enemies · your expedition shards {state.self.credits}
          </p>
          {state.campaign.signalKey && <p>Carried party object: signal key</p>}
          {state.campaign.journey && state.stage === "fight" && (
            <p data-testid="coop-journey-progress">
              {state.campaign.room.kind === "boss"
                ? `Boss phase ${state.campaign.journey.bossPhase} / 3 · `
                : ""}
              {state.campaign.journey.stage <= state.campaign.journey.stages
                ? `Mission ${state.campaign.journey.stage} / ${state.campaign.journey.stages}: ${state.campaign.enemies.length ? "clear the patrol, then reach the marked objective" : "follow the marked route"}`
                : "Missions complete — punish the exposed boss"}
            </p>
          )}
          {state.campaign.objective && (
            <p data-testid="coop-journey-objective">
              {state.campaign.objective.dropped
                ? "Recover the dropped signal"
                : state.campaign.objective.kind === "ward"
                  ? "Survey the marked crossing"
                  : state.campaign.objective.carrying
                    ? "Carry the signal to the delivery marker"
                    : "Recover the signal at the pickup marker"}
              {` · ${state.campaign.objective.progress} / ${state.campaign.objective.target} checkpoints`}
              {state.campaign.objective.carrierId
                ? ` · carrier: ${names.current.get(state.campaign.objective.carrierId) ?? "teammate"}`
                : ""}
            </p>
          )}
          {state.self.modifiers.length > 0 && (
            <p>Your expedition modifiers: {state.self.modifiers.join(", ")}</p>
          )}
          <p>
            Shards and upgrades belong to this expedition. They cannot be
            exchanged for platform currency.
          </p>
        </div>
      )}
      <div className="game-row">
        <label>
          Weapon{" "}
          <select
            aria-label="Co-op weapon"
            value={self?.weapon ?? weapon}
            onChange={(e) => {
              const next = e.target.value as WeaponId;
              setWeapon(next);
              if (state)
                network.send("game:action", {
                  type: "coop:weapon",
                  weapon: next,
                });
            }}
            disabled={!!state && state.stage === "fight" && state.elapsed >= 3}
          >
            {Object.entries(weapons).map(([id, definition]) => (
              <option value={id} key={id}>
                {definition.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={aimAssist}
            onChange={(e) => setAimAssist(e.target.checked)}
          />{" "}
          Aim assist at enemies
        </label>
        <button
          aria-pressed={firing}
          onClick={() => setFiring((value) => !value)}
          disabled={!state || state.stage !== "fight"}
        >
          {firing ? "Stop sustained fire" : "Start sustained fire"}
        </button>
      </div>
      {state?.arena && (
        <p className="game-hint">
          {state.arena.name}: {state.arena.description}
          {state.campaign?.room.kind === "boss" || !state.campaign
            ? ` ${state.boss.name}: ${state.boss.dialogue}`
            : ""}
          {state.boss.opening &&
          (state.campaign?.room.kind === "boss" || !state.campaign)
            ? " Boss recovery opening — strike now."
            : ""}
        </p>
      )}
      {state && (
        <div className="game-stats">
          <div className="game-stat">
            <small>Encounter</small>
            <strong>
              {state.campaign
                ? `${state.campaign.room.index + 1} / ${state.campaign.totalRooms}`
                : `${state.bossIndex + 1} / 4`}
            </strong>
          </div>
          <div className="game-stat">
            <small>
              {state.campaign && state.campaign.room.kind !== "boss"
                ? "Encounter enemies"
                : "Boss health"}
            </small>
            <strong data-testid="coop-boss-health">
              {state.campaign && state.campaign.room.kind !== "boss"
                ? `${state.campaign.enemies.length} remaining`
                : `${Math.max(0, Math.round(state.boss.hp))} / ${state.boss.maxHp}`}
            </strong>
          </div>
          <div className="game-stat">
            <small>Your health</small>
            <strong>{Math.round(self?.hp ?? 0)}</strong>
          </div>
          <div className="game-stat">
            <small>Team members</small>
            <strong>{state.players.length}</strong>
          </div>
        </div>
      )}
      <div className="game-canvas">
        <canvas
          ref={canvas}
          width={900}
          height={560}
          aria-label="Co-op combat arena"
          tabIndex={0}
          onContextMenu={(e) => e.preventDefault()}
          onPointerMove={(e) => {
            const bounds = e.currentTarget.getBoundingClientRect();
            pointer.current.x = Math.max(
              0,
              Math.min(900, ((e.clientX - bounds.left) / bounds.width) * 900),
            );
            pointer.current.y = Math.max(
              0,
              Math.min(560, ((e.clientY - bounds.top) / bounds.height) * 560),
            );
          }}
          onPointerDown={(e) => {
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            if (e.button === 2) pointer.current.alternate = true;
            else pointer.current.fire = true;
          }}
          onPointerUp={() => {
            pointer.current.fire = false;
            pointer.current.alternate = false;
          }}
          onPointerCancel={() => {
            pointer.current.fire = false;
            pointer.current.alternate = false;
          }}
        />
        {settings.paused && (
          <div className="game-overlay">Your controls are paused</div>
        )}
      </div>
      <div className="game-row" aria-label="Co-op touch controls">
        <button {...touch("a")} aria-label="Move left">
          ←
        </button>
        <button {...touch("w")} aria-label="Move up">
          ↑
        </button>
        <button {...touch("s")} aria-label="Move down">
          ↓
        </button>
        <button {...touch("d")} aria-label="Move right">
          →
        </button>
        <button {...touch("shift")}>Dash</button>
        <button {...touch("q")}>Alternate</button>
        <button {...touch("e")}>Hold to revive</button>
      </div>
      {state && (
        <ul aria-label="Co-op player positions">
          {state.players.map((player, i) => (
            <li key={player.id} data-player-id={player.id}>
              {network.lobby?.players.find((p) => p.id === player.id)?.username}{" "}
              · {player.status} · {Math.round(player.hp)} HP · position{" "}
              <span data-testid={`coop-player-position-${i}`}>
                {Math.round(player.x)}, {Math.round(player.y)}
              </span>{" "}
              · damage {player.damage} · revives {player.revives}/2
            </li>
          ))}
        </ul>
      )}
      {(state?.stage === "intermission" || state?.stage === "camp") && (
        <div className="game-card" role="status">
          <h3>
            {state.campaign
              ? state.stage === "camp"
                ? "Expedition rest stop"
                : "Encounter cleared"
              : `${state.boss.name} defeated`}
          </h3>
          <p>
            {state.campaign
              ? "Choose your own bounded upgrade or buy one at a shop, then continue together. A boss checkpoint revives eliminated teammates. After 45 seconds (60 at a rest stop), the team moves on."
              : "Living teammates recover 25 health. Change weapons, then continue together. The next encounter begins after twelve seconds."}
          </p>
          {state.campaign?.event && (
            <div aria-label="Shared expedition event">
              <p>
                {state.campaign.event.resolved
                  ? state.campaign.event.outcome
                  : "The party votes on this shared choice. Each account keeps its own rewards; ties use the expedition seed."}
              </p>
              {!state.campaign.event.resolved && (
                <div className="game-row">
                  {[
                    "Decline / keep the signal",
                    state.campaign.room.kind === "npc"
                      ? "Carry the shared signal key"
                      : state.campaign.room.kind === "secret"
                        ? "Open the shared secret"
                        : "Accept shared Glass confidence",
                  ].map((label, option) => (
                    <button
                      key={label}
                      aria-pressed={state.campaign!.event!.yourVote === option}
                      disabled={self?.status === "eliminated"}
                      onClick={() =>
                        network.send("game:action", {
                          type: "coop:event-vote",
                          option,
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <p>{state.campaign.event.votedCount} event votes received</p>
            </div>
          )}
          {state.campaign?.room.kind === "helper" && (
            <div className="game-row" aria-label="Choose your owned companion">
              {(["gunner", "medic"] as const).map((kind) => (
                <button
                  key={kind}
                  disabled={
                    self?.status !== "alive" ||
                    state.self.helperChosenRoom === state.campaign!.room.index
                  }
                  onClick={() =>
                    network.send("game:action", { type: "coop:helper", kind })
                  }
                >
                  Choose {kind} companion
                </button>
              ))}
            </div>
          )}
          {state.campaign && (
            <div className="game-row" aria-label="Personal expedition rewards">
              {state.campaign.rewards.map((reward) => (
                <button
                  key={reward.id}
                  title={reward.description}
                  disabled={
                    (state.self.upgrades[reward.id] ?? 0) >= 4 ||
                    (state.campaign!.room.kind === "shop"
                      ? state.self.credits < 18
                      : state.self.rewardClaimedRoom ===
                        state.campaign!.room.index) ||
                    self?.status === "eliminated"
                  }
                  onClick={() =>
                    network.send("game:action", {
                      type:
                        state.campaign!.room.kind === "shop"
                          ? "coop:buy"
                          : "coop:reward",
                      reward: reward.id,
                    })
                  }
                >
                  {state.campaign!.room.kind === "shop" ? "Buy" : "Choose"}{" "}
                  {reward.name}
                  {state.campaign!.room.kind === "shop" ? " · 18 shards" : ""} (
                  {state.self.upgrades[reward.id] ?? 0}/4)
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() =>
              network.send("game:action", { type: "coop:continue" })
            }
            disabled={
              state.continued.includes(userId) ||
              (!!state.campaign?.event && !state.campaign.event.resolved)
            }
          >
            Continue expedition
          </button>
        </div>
      )}
      {state?.stage === "choice" && state.campaign && (
        <div className="game-card" role="status">
          <h3>Choose the shared route</h3>
          <p>
            Each connected player votes. Majority wins after everyone votes or
            30 seconds; ties use the expedition seed.
          </p>
          <div className="game-row">
            {state.campaign.room.options?.map((option, i) => (
              <button
                key={option}
                aria-pressed={state.campaign!.yourVote === i}
                onClick={() =>
                  network.send("game:action", { type: "coop:vote", option: i })
                }
              >
                Vote {option}
              </button>
            ))}
          </div>
          <p>{state.campaign.voted.length} votes received</p>
        </div>
      )}
      {self?.status === "eliminated" && (
        <p role="status">
          You are spectating. A campaign boss checkpoint restores eliminated
          teammates at half their shards.
        </p>
      )}
      {state?.result && (
        <div className="game-card" role="status">
          <h3>{state.stage === "won" ? "Team victory" : "Expedition ended"}</h3>
          <p>{state.result.reason}</p>
          <p>
            The server recorded this team outcome. Co-op does not award
            TellCoins, casino credits, or ranked scores.
          </p>
          {state.stage === "won" && state.mode === "campaign" && (
            <p>
              A complete forty-room campaign unlocks permanent weapon and
              companion options and preserves discovered secrets for each
              eligible retained account. Reconnects cannot duplicate this grant.
            </p>
          )}
        </div>
      )}
      <p className="game-hint">
        Connection loss stops your input immediately. Campaign teammates have
        two minutes to reconnect; leaving transfers leadership and lets the
        remaining team continue. SQL checkpoints restore rooms after service or
        Redis loss. Solo saves remain separate. All-offline recovered
        expeditions wait for a signed-in teammate.
      </p>
    </section>
  );
}
