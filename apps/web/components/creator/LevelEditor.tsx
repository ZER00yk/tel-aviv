"use client";
import { useRef, useState } from "react";
import {
  levelSchema,
  normalizeLevel,
  objectTypes,
  type LevelData,
  type LevelObject,
} from "../../../../packages/platform/src/classes/models";
import { objectAtTime, objectColors } from "./physics";
import Playtest from "./Playtest";
import LogicEditor from "./LogicEditor";
import ObjectShape from "./ObjectShape";
import { objectLabel } from "./logicEditing";
import styles from "../classes/Workspace.module.css";
type Props = {
  initial: LevelData;
  onChange: (level: LevelData) => void;
  readonly?: boolean;
  creationId?: string;
};
function boundedMotion(object: LevelObject, level: LevelData): LevelObject {
  if (!object.motion) return object;
  const { axis, distance } = object.motion;
  const position = object[axis];
  const size = axis === "x" ? object.width : object.height;
  const limit = axis === "x" ? level.width : level.height;
  return {
    ...object,
    motion: {
      ...object.motion,
      distance: Math.max(
        -position,
        object.type === "moving-hazard" ? -300 : -800,
        Math.min(
          limit - position - size,
          object.type === "moving-hazard" ? 300 : 800,
          distance,
        ),
      ),
      periodSeconds: Math.max(
        object.type === "moving-hazard" ? 2 : 1,
        object.motion.periodSeconds,
      ),
    },
  };
}
export default function LevelEditor({
  initial,
  onChange,
  readonly = false,
  creationId,
}: Props) {
  const [level, setLevel] = useState<LevelData>(() => normalizeLevel(initial));
  const [tab, setTab] = useState<"scene" | "logic">("scene");
  const [selection, setSelection] = useState<string | null>(null);
  const [tool, setTool] = useState<"select" | LevelObject["type"]>("select");
  const [snap, setSnap] = useState(true);
  const [playing, setPlaying] = useState(readonly);
  const [undo, setUndo] = useState<LevelData[]>([]);
  const [redo, setRedo] = useState<LevelData[]>([]);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    before: LevelData;
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const selected = level.objects.find((object) => object.id === selection);
  const validation = levelSchema.safeParse(level);
  const valid = validation.success;
  function commit(next: LevelData) {
    setUndo((previous) => [...previous.slice(-49), level]);
    setRedo([]);
    setLevel(next);
    onChange(next);
  }
  function travel(back: boolean) {
    const source = back ? undo : redo;
    if (!source.length) return;
    const next = source[source.length - 1];
    if (back) {
      setUndo(source.slice(0, -1));
      setRedo([...redo, level]);
    } else {
      setRedo(source.slice(0, -1));
      setUndo([...undo, level]);
    }
    setLevel(next);
    onChange(next);
  }
  function point(event: React.PointerEvent<SVGSVGElement>) {
    const bounds = svg.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * level.width,
      y: ((event.clientY - bounds.top) / bounds.height) * level.height,
    };
  }
  function snapped(value: number) {
    return snap ? Math.round(value / 20) * 20 : Math.round(value);
  }
  function down(event: React.PointerEvent<SVGSVGElement>) {
    if (readonly) return;
    const p = point(event);
    const target = (event.target as Element).getAttribute("data-id");
    if (tool !== "select") {
      if (level.objects.length >= 300) return;
      const width = [
          "platform",
          "moving-platform",
          "one-way-platform",
          "angled-platform",
          "slope",
          "polygon-platform",
          "rotating-hazard",
        ].includes(tool)
          ? 120
          : tool === "cart"
            ? 64
            : ["button", "pressure-plate", "switch"].includes(tool)
              ? 60
              : tool === "trigger-zone"
                ? 120
                : tool === "sign"
                  ? 160
                  : 40,
        height = [
          "platform",
          "moving-platform",
          "one-way-platform",
          "angled-platform",
          "rotating-hazard",
        ].includes(tool)
          ? 20
          : tool === "cart"
            ? 24
            : tool === "door"
              ? 100
              : ["button", "pressure-plate"].includes(tool)
                ? 12
                : tool === "trigger-zone"
                  ? 100
                  : tool === "sign"
                    ? 48
                    : 40;
      const object: LevelObject = boundedMotion(
        {
          id: crypto.randomUUID(),
          type: tool,
          x: Math.max(0, Math.min(level.width - width, snapped(p.x))),
          y: Math.max(0, Math.min(level.height - height, snapped(p.y))),
          width,
          height,
          rotation: 0,
          layer: 0,
          active: true,
          ...(["moving-platform", "moving-hazard"].includes(tool)
            ? {
                motion: { axis: "x" as const, distance: 160, periodSeconds: 4 },
              }
            : {}),
          ...(["button", "switch", "pressure-plate"].includes(tool)
            ? {
                targetIds: [],
                buttonMode:
                  tool === "switch" ? ("toggle" as const) : ("hold" as const),
              }
            : {}),
          ...(tool === "enemy" ? { health: 3 } : {}),
          ...(tool === "collectible" ? { item: "key" } : {}),
          ...(tool === "sign" ? { text: "A new adventure" } : {}),
          ...(tool === "slope" ? { slopeDirection: "right" as const } : {}),
          ...(tool === "angled-platform" ? { rotation: -15 } : {}),
          ...(tool === "polygon-platform"
            ? {
                vertices: [
                  { x: 0.15, y: 0 },
                  { x: 0.85, y: 0 },
                  { x: 1, y: 1 },
                  { x: 0, y: 1 },
                ],
              }
            : {}),
          ...(tool === "rotating-hazard" ? { rotationSpeed: 60 } : {}),
          ...(tool === "cart" ? { cartSpeed: 150 } : {}),
          ...(tool === "explosive"
            ? {
                explosive: {
                  radius: 120,
                  damage: 40,
                  force: 220,
                  fuseSeconds: 1,
                  trigger: "interact" as const,
                },
              }
            : {}),
        },
        level,
      );
      commit({ ...level, objects: [...level.objects, object] });
      setSelection(object.id);
      return;
    }
    setSelection(target);
    if (target) {
      const object = level.objects.find((item) => item.id === target)!;
      drag.current = {
        before: level,
        id: target,
        offsetX: p.x - object.x,
        offsetY: p.y - object.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function move(event: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const p = point(event),
      current = drag.current;
    setLevel((previous) => ({
      ...previous,
      objects: previous.objects.map((object) =>
        object.id === current.id
          ? boundedMotion(
              {
                ...object,
                x: Math.max(
                  0,
                  Math.min(
                    previous.width - object.width,
                    snapped(p.x - current.offsetX),
                  ),
                ),
                y: Math.max(
                  0,
                  Math.min(
                    previous.height - object.height,
                    snapped(p.y - current.offsetY),
                  ),
                ),
              },
              previous,
            )
          : object,
      ),
    }));
  }
  function up() {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (current.before === level) return;
    // State updaters can run after this handler. Keep the snapshot rather than
    // reading a drag ref that has already been cleared.
    setUndo((previous) => [...previous.slice(-49), current.before]);
    setRedo([]);
    onChange(level);
  }
  function update(patch: Partial<LevelObject>) {
    if (!selected) return;
    const next = { ...selected, ...patch };
    next.width = Math.max(8, Math.min(2400, level.width - next.x, next.width));
    next.height = Math.max(
      8,
      Math.min(500, level.height - next.y, next.height),
    );
    next.x = Math.max(0, Math.min(level.width - next.width, next.x));
    next.y = Math.max(0, Math.min(level.height - next.height, next.y));
    if (["moving-hazard", "rotating-hazard"].includes(next.type)) {
      next.width = Math.min(240, next.width);
      next.height = Math.min(240, next.height);
    }
    if (["cart", "one-way-platform"].includes(next.type)) next.rotation = 0;
    commit({
      ...level,
      objects: level.objects.map((object) =>
        object.id === selected.id ? boundedMotion(next, level) : object,
      ),
    });
  }
  function remove() {
    if (!selected) return;
    commit({
      ...level,
      objects: level.objects
        .filter((object) => object.id !== selection)
        .map((object) =>
          object.targetIds?.includes(selected.id)
            ? {
                ...object,
                targetIds: object.targetIds.filter((id) => id !== selected.id),
              }
            : object,
        ),
    });
    setSelection(null);
  }
  function duplicate() {
    if (!selected || level.objects.length >= 300) return;
    const next = boundedMotion(
      {
        ...selected,
        id: crypto.randomUUID(),
        ...(selected.label
          ? { label: `${selected.label} copy`.slice(0, 80) }
          : {}),
        x: Math.min(level.width - selected.width, selected.x + 20),
        y: Math.min(level.height - selected.height, selected.y + 20),
      },
      level,
    );
    commit({ ...level, objects: [...level.objects, next] });
    setSelection(next.id);
  }
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        {!readonly && (
          <>
            <button disabled={!undo.length} onClick={() => travel(true)}>
              Undo
            </button>
            <button disabled={!redo.length} onClick={() => travel(false)}>
              Redo
            </button>
            <label>
              <span>
                <input
                  type="checkbox"
                  checked={snap}
                  onChange={(event) => setSnap(event.target.checked)}
                />{" "}
                Snap to 20px grid
              </span>
            </label>
          </>
        )}
        <button
          className={playing ? styles.active : ""}
          disabled={!playing && !valid}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? "Back to editor" : "Playtest"}
        </button>
      </div>
      {playing ? (
        <Playtest level={level} creationId={creationId} />
      ) : (
        <>
          {!readonly && (
            <div
              className={styles.row}
              role="tablist"
              aria-label="Creator workspace"
            >
              <button
                role="tab"
                aria-selected={tab === "scene"}
                className={tab === "scene" ? styles.active : ""}
                onClick={() => setTab("scene")}
              >
                Scene
              </button>
              <button
                role="tab"
                aria-selected={tab === "logic"}
                className={tab === "logic" ? styles.active : ""}
                onClick={() => setTab("logic")}
              >
                Logic &amp; variables
              </button>
            </div>
          )}
          {tab === "logic" && !readonly ? (
            <LogicEditor level={level} onChange={commit} />
          ) : (
            <>
              {!readonly && (
                <div className={styles.toolbar}>
                  <button
                    className={tool === "select" ? styles.active : ""}
                    onClick={() => setTool("select")}
                  >
                    Select / move
                  </button>
                  {objectTypes.map((type) => (
                    <button
                      key={type}
                      className={tool === type ? styles.active : ""}
                      onClick={() => setTool(type)}
                    >
                      {type}
                    </button>
                  ))}
                  <label>
                    Select a scene object
                    <select
                      aria-label="Select a scene object"
                      value={selection ?? ""}
                      onChange={(event) => {
                        setTool("select");
                        setSelection(event.target.value || null);
                      }}
                    >
                      <option value="">No object selected</option>
                      {level.objects.map((object) => (
                        <option key={object.id} value={object.id}>
                          {objectLabel(object, level.objects)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <p className={styles.muted}>
                Choose an object to place it. Select and drag to move; use the
                inspector to name, resize, rotate and change layers. Connect
                controls to doors in the inspector, or use Logic &amp; variables
                for events, conditions and actions. Dashed lines show
                connections and motion paths.
              </p>
              {!valid && (
                <p className={styles.error} role="alert">
                  Repair this level in the scene inspector or Logic &amp;
                  variables, or Undo the last change. Playtest is paused until
                  it is valid.{" "}
                  {!validation.success &&
                    validation.error.issues
                      .slice(0, 3)
                      .map((issue) => issue.message)
                      .join(". ")}
                </p>
              )}
              <div className={styles.canvas}>
                <svg
                  ref={svg}
                  viewBox={`0 0 ${level.width} ${level.height}`}
                  tabIndex={0}
                  aria-label="Level editor canvas"
                  onPointerDown={down}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={up}
                  onKeyDown={(event) => {
                    if (readonly) return;
                    if ((event.ctrlKey || event.metaKey) && event.key === "z") {
                      event.preventDefault();
                      travel(!event.shiftKey);
                    } else if (
                      event.key === "Delete" ||
                      event.key === "Backspace"
                    ) {
                      event.preventDefault();
                      remove();
                    }
                  }}
                >
                  <defs>
                    <pattern
                      id="creator-grid"
                      width="20"
                      height="20"
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d="M 20 0 L 0 0 0 20"
                        fill="none"
                        stroke="#35425f"
                        strokeWidth=".5"
                      />
                    </pattern>
                  </defs>
                  {snap && (
                    <rect
                      width="100%"
                      height="100%"
                      fill="url(#creator-grid)"
                    />
                  )}
                  {level.objects.flatMap((object) => {
                    const center = {
                      x: object.x + object.width / 2,
                      y: object.y + object.height / 2,
                    };
                    const lines = (object.targetIds ?? []).map((id) => {
                      const target = level.objects.find(
                        (candidate) => candidate.id === id,
                      );
                      return target ? (
                        <line
                          key={`${object.id}-${id}`}
                          x1={center.x}
                          y1={center.y}
                          x2={target.x + target.width / 2}
                          y2={target.y + target.height / 2}
                          stroke="#ffa972"
                          strokeWidth="2"
                          strokeDasharray="6 4"
                          pointerEvents="none"
                        />
                      ) : null;
                    });
                    if (object.motion) {
                      const end = objectAtTime(
                        object,
                        object.motion.periodSeconds / 2,
                      );
                      lines.push(
                        <line
                          key={`${object.id}-motion`}
                          x1={center.x}
                          y1={center.y}
                          x2={end.x + end.width / 2}
                          y2={end.y + end.height / 2}
                          stroke="#76d4ef"
                          strokeWidth="2"
                          strokeDasharray="6 4"
                          pointerEvents="none"
                        />,
                      );
                    }
                    return lines;
                  })}
                  {[...level.objects]
                    .sort((a, b) => a.layer - b.layer)
                    .map((object) => (
                      <g key={object.id}>
                        <title>{objectLabel(object, level.objects)}</title>
                        <ObjectShape
                          object={object}
                          dataId={object.id}
                          fill={objectColors[object.type]}
                          opacity={
                            object.active === false
                              ? 0.35
                              : object.type === "trigger-zone"
                                ? 0.45
                                : 1
                          }
                          stroke={
                            selection === object.id ? "#fff" : "transparent"
                          }
                          strokeWidth={3}
                        />
                        <text
                          x={object.x + 3}
                          y={object.y + Math.min(16, object.height - 3)}
                          fontSize="11"
                          fill="#142239"
                          pointerEvents="none"
                        >
                          {object.label || object.type}
                        </text>
                      </g>
                    ))}
                  <circle
                    cx={level.spawn.x + 10}
                    cy={level.spawn.y + 14}
                    r="10"
                    fill="#fff4aa"
                    pointerEvents="none"
                  />
                </svg>
              </div>
              {selected && !readonly && (
                <div className={styles.card}>
                  <strong>Inspector: {selected.type}</strong>
                  <label>
                    Object label
                    <input
                      value={selected.label ?? ""}
                      maxLength={80}
                      placeholder={`Name this ${selected.type.replaceAll("-", " ")}`}
                      onChange={(event) =>
                        update({ label: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>
                      <input
                        type="checkbox"
                        checked={selected.active !== false}
                        onChange={(event) =>
                          update({ active: event.target.checked })
                        }
                      />{" "}
                      Active at level start
                    </span>
                  </label>
                  {selected.type === "enemy" && (
                    <label>
                      Enemy health
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={selected.health ?? 3}
                        onChange={(event) => {
                          const health = Number(event.target.value);
                          if (Number.isFinite(health))
                            update({
                              health: Math.max(
                                1,
                                Math.min(20, Math.round(health)),
                              ),
                            });
                        }}
                      />
                    </label>
                  )}
                  {selected.type === "collectible" && (
                    <label>
                      Collectible item name
                      <input
                        value={selected.item ?? "key"}
                        maxLength={40}
                        onChange={(event) =>
                          update({ item: event.target.value })
                        }
                      />
                      <small>
                        Use a letter, then letters, numbers, underscores or
                        hyphens.
                      </small>
                    </label>
                  )}
                  {selected.type === "sign" && (
                    <label>
                      Sign text
                      <input
                        value={selected.text ?? ""}
                        maxLength={300}
                        onChange={(event) =>
                          update({ text: event.target.value })
                        }
                      />
                    </label>
                  )}
                  {selected.type === "teleporter" && (
                    <label>
                      Teleporter destination
                      <select
                        aria-label="Teleporter destination"
                        value={selected.targetId ?? ""}
                        onChange={(event) => {
                          if (event.target.value)
                            update({ targetId: event.target.value });
                          else {
                            const next = { ...selected };
                            delete next.targetId;
                            commit({
                              ...level,
                              objects: level.objects.map((object) =>
                                object.id === selected.id ? next : object,
                              ),
                            });
                          }
                        }}
                      >
                        <option value="">No destination yet</option>
                        {selected.targetId &&
                          !level.objects.some(
                            (object) =>
                              object.id === selected.targetId &&
                              object.type === "teleporter",
                          ) && (
                            <option value={selected.targetId}>
                              Missing destination — choose a replacement
                            </option>
                          )}
                        {level.objects
                          .filter(
                            (object) =>
                              object.type === "teleporter" &&
                              object.id !== selected.id,
                          )
                          .map((object) => (
                            <option key={object.id} value={object.id}>
                              {objectLabel(object, level.objects)}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  {selected.type === "slope" && (
                    <label>
                      Slope rises toward
                      <select
                        aria-label="Slope rises toward"
                        value={selected.slopeDirection ?? "right"}
                        onChange={(event) =>
                          update({
                            slopeDirection:
                              event.target.value === "left" ? "left" : "right",
                          })
                        }
                      >
                        <option value="right">Right</option>
                        <option value="left">Left</option>
                      </select>
                    </label>
                  )}
                  {selected.type === "rotating-hazard" && (
                    <label>
                      Rotation degrees per second
                      <input
                        aria-label="Rotation degrees per second"
                        type="number"
                        min={-180}
                        max={180}
                        value={selected.rotationSpeed ?? 60}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value))
                            update({
                              rotationSpeed: Math.max(
                                -180,
                                Math.min(180, value),
                              ),
                            });
                        }}
                      />
                      <small>
                        Use 5–180 or −180–−5. Collision follows the visible arm.
                      </small>
                    </label>
                  )}
                  {selected.type === "cart" && (
                    <label>
                      Cart maximum speed
                      <input
                        aria-label="Cart maximum speed"
                        type="number"
                        min={40}
                        max={180}
                        value={selected.cartSpeed ?? 150}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value))
                            update({
                              cartSpeed: Math.max(40, Math.min(180, value)),
                            });
                        }}
                      />
                      <small>
                        A horizontal rail cart. Press E near the seat, drive
                        with movement keys, and press E again to leave.
                      </small>
                    </label>
                  )}
                  {selected.type === "one-way-platform" && (
                    <p className={styles.muted}>
                      Jump through from below. Falling players land on its upper
                      face. This platform remains horizontal.
                    </p>
                  )}
                  {selected.type === "polygon-platform" && (
                    <div className={styles.stack}>
                      <strong>Convex polygon shape</strong>
                      <div className={styles.row}>
                        <button
                          onClick={() =>
                            update({
                              vertices: [
                                { x: 0, y: 1 },
                                { x: 1, y: 0 },
                                { x: 1, y: 1 },
                              ],
                            })
                          }
                        >
                          Triangle shape
                        </button>
                        <button
                          onClick={() =>
                            update({
                              vertices: [
                                { x: 0.15, y: 0 },
                                { x: 0.85, y: 0 },
                                { x: 1, y: 1 },
                                { x: 0, y: 1 },
                              ],
                            })
                          }
                        >
                          Trapezoid shape
                        </button>
                        <button
                          onClick={() =>
                            update({
                              vertices: [
                                { x: 0.25, y: 0 },
                                { x: 0.75, y: 0 },
                                { x: 1, y: 0.5 },
                                { x: 0.75, y: 1 },
                                { x: 0.25, y: 1 },
                                { x: 0, y: 0.5 },
                              ],
                            })
                          }
                        >
                          Hexagon shape
                        </button>
                      </div>
                      {(selected.vertices ?? []).map((point, index) => (
                        <div key={index} className={styles.row}>
                          {(["x", "y"] as const).map((axis) => (
                            <label key={axis}>
                              Vertex {index + 1}{" "}
                              {axis === "x" ? "horizontal" : "vertical"}
                              <input
                                type="number"
                                min={0}
                                max={1}
                                step={0.05}
                                value={point[axis]}
                                onChange={(event) => {
                                  const value = Number(event.target.value);
                                  if (Number.isFinite(value))
                                    update({
                                      vertices: selected.vertices!.map(
                                        (vertex, i) =>
                                          i === index
                                            ? {
                                                ...vertex,
                                                [axis]: Math.max(
                                                  0,
                                                  Math.min(1, value),
                                                ),
                                              }
                                            : vertex,
                                      ),
                                    });
                                }}
                              />
                            </label>
                          ))}
                        </div>
                      ))}
                      <small>
                        Coordinates range from 0 to 1 across the object's width
                        and height. Keep edges convex and in order;
                        crossing/concave edges disable play until repaired.
                      </small>
                    </div>
                  )}
                  {selected.type === "explosive" && (
                    <div className={styles.stack}>
                      <strong>Explosion settings</strong>
                      <label>
                        Fuse trigger
                        <select
                          aria-label="Fuse trigger"
                          value={selected.explosive?.trigger ?? "interact"}
                          onChange={(event) =>
                            update({
                              explosive: {
                                radius: 120,
                                damage: 40,
                                force: 220,
                                fuseSeconds: 1,
                                ...selected.explosive,
                                trigger:
                                  event.target.value === "contact"
                                    ? "contact"
                                    : "interact",
                              },
                            })
                          }
                        >
                          <option value="interact">Press E nearby</option>
                          <option value="contact">Player contact</option>
                        </select>
                      </label>
                      {(
                        [
                          ["radius", "Blast radius", 40, 240],
                          ["damage", "Blast damage", 1, 100],
                          ["force", "Blast force", 0, 500],
                          ["fuseSeconds", "Fuse seconds", 0.25, 10],
                        ] as const
                      ).map(([property, label, minimum, maximum]) => (
                        <label key={property}>
                          {label}
                          <input
                            type="number"
                            min={minimum}
                            max={maximum}
                            step={property === "fuseSeconds" ? 0.25 : 1}
                            value={
                              selected.explosive?.[property] ??
                              {
                                radius: 120,
                                damage: 40,
                                force: 220,
                                fuseSeconds: 1,
                              }[property]
                            }
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              if (Number.isFinite(value))
                                update({
                                  explosive: {
                                    radius: 120,
                                    damage: 40,
                                    force: 220,
                                    fuseSeconds: 1,
                                    trigger: "interact",
                                    ...selected.explosive,
                                    [property]: Math.max(
                                      minimum,
                                      Math.min(
                                        maximum,
                                        property === "damage"
                                          ? Math.round(value)
                                          : value,
                                      ),
                                    ),
                                  },
                                });
                            }}
                          />
                        </label>
                      ))}
                      <small>
                        Blasts break destructibles, damage enemies and the
                        player, and ignite nearby explosives. Each tick permits
                        at most 16 blasts, 64 targets per blast and eight chain
                        links; excess chains continue on later ticks.
                      </small>
                    </div>
                  )}
                  <div className={styles.row}>
                    {(
                      [
                        "x",
                        "y",
                        "width",
                        "height",
                        "rotation",
                        "layer",
                      ] as const
                    ).map((property) => (
                      <label key={property}>
                        {property}
                        <input
                          type="number"
                          value={selected[property]}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isFinite(value))
                              update({
                                [property]:
                                  property === "rotation"
                                    ? Math.max(-360, Math.min(360, value))
                                    : property === "layer"
                                      ? Math.max(
                                          0,
                                          Math.min(5, Math.round(value)),
                                        )
                                      : value,
                              });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  {selected.motion && (
                    <div className={styles.row}>
                      <label>
                        Motion axis
                        <select
                          value={selected.motion.axis}
                          onChange={(event) =>
                            update({
                              motion: {
                                ...selected.motion!,
                                axis: event.target.value === "y" ? "y" : "x",
                              },
                            })
                          }
                        >
                          <option value="x">Horizontal</option>
                          <option value="y">Vertical</option>
                        </select>
                      </label>
                      <label>
                        Travel distance
                        <input
                          type="number"
                          min="-800"
                          max="800"
                          value={selected.motion.distance}
                          onChange={(event) => {
                            const distance = Number(event.target.value);
                            if (Number.isFinite(distance))
                              update({
                                motion: {
                                  ...selected.motion!,
                                  distance: Math.max(
                                    -800,
                                    Math.min(800, distance),
                                  ),
                                },
                              });
                          }}
                        />
                      </label>
                      <label>
                        Cycle seconds
                        <input
                          type="number"
                          min="1"
                          max="30"
                          step="0.5"
                          value={selected.motion.periodSeconds}
                          onChange={(event) => {
                            const periodSeconds = Number(event.target.value);
                            if (Number.isFinite(periodSeconds))
                              update({
                                motion: {
                                  ...selected.motion!,
                                  periodSeconds: Math.max(
                                    1,
                                    Math.min(30, periodSeconds),
                                  ),
                                },
                              });
                          }}
                        />
                      </label>
                    </div>
                  )}
                  {["button", "switch", "pressure-plate"].includes(
                    selected.type,
                  ) && (
                    <div className={styles.stack}>
                      <label>
                        Button behavior
                        <select
                          value={selected.buttonMode ?? "hold"}
                          onChange={(event) =>
                            update({
                              buttonMode:
                                event.target.value === "toggle"
                                  ? "toggle"
                                  : "hold",
                            })
                          }
                        >
                          <option value="hold">Open while pressed</option>
                          <option value="toggle">Toggle on each press</option>
                        </select>
                      </label>
                      <strong>When pressed → open these doors</strong>
                      {!level.objects.some(
                        (object) => object.type === "door",
                      ) && (
                        <p className={styles.muted}>
                          Place a door to add a connection.
                        </p>
                      )}
                      {level.objects
                        .filter((object) => object.type === "door")
                        .map((door, index) => (
                          <label key={door.id}>
                            <span>
                              <input
                                type="checkbox"
                                checked={
                                  selected.targetIds?.includes(door.id) ?? false
                                }
                                disabled={
                                  !selected.targetIds?.includes(door.id) &&
                                  (selected.targetIds?.length ?? 0) >= 16
                                }
                                onChange={(event) =>
                                  update({
                                    targetIds: event.target.checked
                                      ? [...(selected.targetIds ?? []), door.id]
                                      : (selected.targetIds ?? []).filter(
                                          (id) => id !== door.id,
                                        ),
                                  })
                                }
                              />{" "}
                              {door.label ||
                                `Door ${index + 1} at ${Math.round(door.x)}, ${Math.round(door.y)}`}
                            </span>
                          </label>
                        ))}
                    </div>
                  )}
                  <div className={styles.row}>
                    <button
                      disabled={level.objects.length >= 300}
                      onClick={duplicate}
                    >
                      Duplicate
                    </button>
                    <button
                      onClick={() =>
                        update({ rotation: (selected.rotation + 15) % 360 })
                      }
                    >
                      Rotate +15°
                    </button>
                    <button onClick={remove}>Delete</button>
                    <button
                      onClick={() =>
                        commit({
                          ...level,
                          spawn: {
                            x: Math.min(level.width - 20, selected.x),
                            y: Math.max(0, selected.y - 32),
                          },
                        })
                      }
                    >
                      Set spawn above object
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
