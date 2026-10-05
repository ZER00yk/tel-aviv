"use client";
import { useEffect, useRef, useState } from "react";
import type { GameSDK } from "@tell-aviv/game-sdk";
import { validateScene, type SceneSave, type Tool } from "./scene";
export default function Sandbox({
  sdk,
  paused,
}: {
  sdk: GameSDK;
  paused: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    world = useRef<{
      engine: import("matter-js").Engine;
      Matter: typeof import("matter-js");
      mouse: import("matter-js").MouseConstraint;
      render: import("matter-js").Render;
    } | null>(null),
    prefs = useRef({ paused, tool: "box" as Tool }),
    jointStart = useRef<import("matter-js").Body | null>(null),
    keys = useRef(new Set<string>());
  const [tool, setTool] = useState<Tool>("box"),
    [gravity, setGravity] = useState(1),
    [count, setCount] = useState(0),
    [message, setMessage] = useState(""),
    [snapshot, setSnapshot] = useState<SceneSave | null>(null);
  prefs.current = { paused, tool };
  const capture = (): SceneSave | null => {
    const current = world.current;
    if (!current) return null;
    const { Matter: M, engine } = current;
    const bodies = M.Composite.allBodies(engine.world).filter(
      (body) => body.plugin.sceneId,
    );
    return {
      version: 1,
      gravity: engine.gravity.y,
      bodies: bodies.map((body) => ({
        id: body.plugin.sceneId,
        type: body.plugin.kind,
        x: body.position.x,
        y: body.position.y,
        angle: body.angle,
        width: body.plugin.width ?? 0,
        height: body.plugin.height ?? 0,
        radius: body.circleRadius ?? 0,
        isStatic: body.isStatic,
      })),
      joints: M.Composite.allConstraints(engine.world)
        .filter((c) => c.bodyA?.plugin.sceneId && c.bodyB?.plugin.sceneId)
        .map((c) => ({
          a: c.bodyA!.plugin.sceneId,
          b: c.bodyB!.plugin.sceneId,
          length: c.length,
          stiffness: c.stiffness,
        })),
    };
  };
  const add = (selected: Tool, x = 450, y = 100) => {
    const current = world.current;
    if (!current || prefs.current.paused) return;
    const { Matter: M, engine } = current;
    const all = M.Composite.allBodies(engine.world).filter(
      (b) => b.plugin.sceneId,
    );
    if (all.length >= 145) {
      setMessage(
        "Workshop limit: 150 bodies. Delete a few before adding more.",
      );
      return;
    }
    const create = (
      kind: string,
      bx: number,
      by: number,
      width: number,
      height: number,
      radius = 0,
      staticBody = false,
    ) => {
      const body = radius
        ? M.Bodies.circle(bx, by, radius)
        : M.Bodies.rectangle(bx, by, width, height);
      body.plugin = { sceneId: crypto.randomUUID(), kind, width, height };
      body.render.fillStyle =
        (
          {
            box: "#91b8e8",
            ball: "#f7cf70",
            plank: "#c19474",
            domino: "#c895e6",
            ragdoll: "#8bd5c6",
            vehicle: "#ff917d",
            wheel: "#535f80",
            explosive: "#ff526e",
            hazard: "#df68ec",
            bumper: "#bfff71",
          } as Record<string, string>
        )[kind] ?? "#a9c5d5";
      body.render.strokeStyle = "#202a3c";
      body.render.lineWidth = 2;
      body.friction = 0.5;
      body.restitution = kind === "ball" ? 0.65 : 0.15;
      M.Body.setStatic(body, staticBody);
      if (kind === "hazard" || kind === "bumper") body.isSensor = true;
      M.Composite.add(engine.world, body);
      return body;
    };
    if (selected === "select" || selected === "joint" || selected === "delete")
      return;
    if (selected === "ragdoll") {
      const head = create("ragdoll", x, y - 30, 0, 0, 13),
        torso = create("ragdoll", x, y, 22, 45),
        left = create("ragdoll", x - 22, y + 8, 13, 44),
        right = create("ragdoll", x + 22, y + 8, 13, 44),
        leg1 = create("ragdoll", x - 9, y + 45, 13, 44),
        leg2 = create("ragdoll", x + 9, y + 45, 13, 44);
      for (const part of [head, left, right, leg1, leg2])
        M.Composite.add(
          engine.world,
          M.Constraint.create({
            bodyA: torso,
            bodyB: part,
            length: Math.hypot(
              part.position.x - torso.position.x,
              part.position.y - torso.position.y,
            ),
            stiffness: 0.7,
            render: { strokeStyle: "#c8f4e7" },
          }),
        );
    } else if (selected === "vehicle") {
      const chassis = create("vehicle", x, y, 95, 24),
        a = create("wheel", x - 30, y + 22, 0, 0, 18),
        b = create("wheel", x + 30, y + 22, 0, 0, 18);
      for (const wheel of [a, b])
        M.Composite.add(
          engine.world,
          M.Constraint.create({
            bodyA: chassis,
            bodyB: wheel,
            length: 37,
            stiffness: 0.9,
            render: { strokeStyle: "#fbc1aa" },
          }),
        );
    } else {
      const shapes: Record<string, [number, number, number, boolean]> = {
        box: [45, 45, 0, false],
        ball: [0, 0, 22, false],
        plank: [120, 14, 0, false],
        domino: [13, 60, 0, false],
        explosive: [0, 0, 21, false],
        hazard: [110, 15, 0, true],
        bumper: [95, 18, 0, true],
      };
      const shape = shapes[selected];
      if (shape) create(selected, x, y, ...shape);
    }
    setCount(
      M.Composite.allBodies(engine.world).filter((b) => b.plugin.sceneId)
        .length,
    );
  };
  const restore = (scene: SceneSave) => {
    const current = world.current;
    if (!current || !validateScene(scene)) {
      setMessage("Scene file is invalid.");
      return;
    }
    const { Matter: M, engine } = current;
    for (const c of M.Composite.allConstraints(engine.world))
      if (c.bodyA?.plugin.sceneId || c.bodyB?.plugin.sceneId)
        M.Composite.remove(engine.world, c);
    for (const b of M.Composite.allBodies(engine.world))
      if (b.plugin.sceneId) M.Composite.remove(engine.world, b);
    const map = new Map<string, import("matter-js").Body>();
    for (const data of scene.bodies) {
      const body = data.radius
        ? M.Bodies.circle(data.x, data.y, data.radius)
        : M.Bodies.rectangle(data.x, data.y, data.width, data.height);
      body.plugin = {
        sceneId: data.id,
        kind: data.type,
        width: data.width,
        height: data.height,
      };
      body.render.fillStyle =
        data.type === "explosive"
          ? "#ff526e"
          : data.type === "hazard"
            ? "#df68ec"
            : data.type === "bumper"
              ? "#bfff71"
              : "#91b8e8";
      body.render.strokeStyle = "#202a3c";
      body.friction = 0.5;
      body.restitution = data.type === "ball" ? 0.65 : 0.15;
      body.isSensor = ["hazard", "bumper"].includes(data.type);
      M.Body.setAngle(body, data.angle);
      M.Body.setStatic(body, data.isStatic);
      map.set(data.id, body);
      M.Composite.add(engine.world, body);
    }
    for (const joint of scene.joints) {
      const a = map.get(joint.a),
        b = map.get(joint.b);
      if (a && b)
        M.Composite.add(
          engine.world,
          M.Constraint.create({
            bodyA: a,
            bodyB: b,
            length: joint.length,
            stiffness: joint.stiffness,
            render: { strokeStyle: "#bfe4f4" },
          }),
        );
    }
    engine.gravity.y = scene.gravity;
    setGravity(scene.gravity);
    setCount(scene.bodies.length);
    setMessage("Scene restored.");
  };
  const detonate = () => {
    const current = world.current;
    if (!current) return;
    const { Matter: M, engine } = current;
    const bodies = M.Composite.allBodies(engine.world);
    for (const bomb of bodies.filter((b) => b.plugin.kind === "explosive")) {
      for (const other of bodies) {
        if (other === bomb || other.isStatic) continue;
        const dx = other.position.x - bomb.position.x,
          dy = other.position.y - bomb.position.y,
          d = Math.hypot(dx, dy);
        if (d < 180 && d > 0)
          M.Body.applyForce(other, other.position, {
            x: (dx / d) * 0.08 * (1 - d / 180),
            y: (dy / d) * 0.08 * (1 - d / 180),
          });
      }
      M.Composite.remove(engine.world, bomb);
    }
    setCount(
      M.Composite.allBodies(engine.world).filter((b) => b.plugin.sceneId)
        .length,
    );
  };
  useEffect(() => {
    let destroyed = false,
      frame = 0;
    import("matter-js").then((imported) => {
      const M = imported.default ?? imported;
      if (destroyed || !host.current) return;
      const engine = M.Engine.create({ enableSleeping: true }),
        render = M.Render.create({
          element: host.current,
          engine,
          options: {
            width: 900,
            height: 560,
            wireframes: false,
            background: "#111b2c",
            showAngleIndicator: false,
            pixelRatio: 1,
          },
        });
      M.Composite.add(engine.world, [
        M.Bodies.rectangle(450, 560, 920, 35, {
          isStatic: true,
          render: { fillStyle: "#354460" },
        }),
        M.Bodies.rectangle(-15, 280, 30, 560, { isStatic: true }),
        M.Bodies.rectangle(915, 280, 30, 560, { isStatic: true }),
      ]);
      const mouse = M.Mouse.create(render.canvas),
        drag = M.MouseConstraint.create(engine, {
          mouse,
          constraint: { stiffness: 0.18, render: { visible: false } },
          collisionFilter: { mask: 0 },
        });
      M.Composite.add(engine.world, drag);
      world.current = { engine, Matter: M, mouse: drag, render };
      M.Render.run(render);
      let last = performance.now();
      const tick = (now: number) => {
        if (destroyed) return;
        const dt = Math.min(33, now - last);
        last = now;
        drag.collisionFilter.mask =
          prefs.current.tool === "select" ? 0xffffffff : 0;
        const bodies = M.Composite.allBodies(engine.world);
        if (!prefs.current.paused) {
          M.Engine.update(engine, dt);
          for (const b of bodies) {
            if (b.plugin.kind === "vehicle") {
              if (keys.current.has("ArrowRight"))
                M.Body.applyForce(b, b.position, { x: 0.007, y: 0 });
              if (keys.current.has("ArrowLeft"))
                M.Body.applyForce(b, b.position, { x: -0.007, y: 0 });
            }
            if (["hazard", "bumper"].includes(b.plugin.kind)) {
              for (const hit of M.Query.collides(
                b,
                bodies.filter((other) => other !== b && !other.isStatic),
              )) {
                const target = hit.bodyA === b ? hit.bodyB : hit.bodyA;
                if (b.plugin.kind === "bumper")
                  M.Body.applyForce(target, target.position, {
                    x: 0,
                    y: -0.028,
                  });
                else if (target.plugin.kind === "domino") {
                  M.Composite.remove(engine.world, target);
                }
              }
            }
          }
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      const pointer = (e: PointerEvent) => {
        const rect = render.canvas.getBoundingClientRect(),
          x = ((e.clientX - rect.left) / rect.width) * 900,
          y = ((e.clientY - rect.top) / rect.height) * 560;
        const selected = prefs.current.tool;
        if (selected === "delete") {
          const body = M.Query.point(M.Composite.allBodies(engine.world), {
            x,
            y,
          }).find((b) => b.plugin.sceneId);
          if (body) {
            for (const c of M.Composite.allConstraints(engine.world))
              if (c.bodyA === body || c.bodyB === body)
                M.Composite.remove(engine.world, c);
            M.Composite.remove(engine.world, body);
            setCount(
              M.Composite.allBodies(engine.world).filter(
                (b) => b.plugin.sceneId,
              ).length,
            );
          }
        } else if (selected === "joint") {
          const body = M.Query.point(M.Composite.allBodies(engine.world), {
            x,
            y,
          }).find((b) => b.plugin.sceneId);
          if (!body) return;
          if (jointStart.current && body !== jointStart.current) {
            M.Composite.add(
              engine.world,
              M.Constraint.create({
                bodyA: jointStart.current,
                bodyB: body,
                length: Math.hypot(
                  body.position.x - jointStart.current.position.x,
                  body.position.y - jointStart.current.position.y,
                ),
                stiffness: 0.85,
                render: { strokeStyle: "#bfe4f4" },
              }),
            );
            jointStart.current = null;
            setMessage("Joint connected.");
          } else {
            jointStart.current = body;
            setMessage("Select another body to connect.");
          }
        } else add(selected, x, y);
      };
      render.canvas.addEventListener("pointerdown", pointer);
      sdk
        .load<SceneSave>()
        .then((save) => {
          if (!destroyed && save.data && validateScene(save.data)) {
            setSnapshot(save.data);
            setMessage("Cloud scene available — choose Restore cloud scene.");
          }
        })
        .catch((e) => setMessage(e.message));
    });
    const down = (e: KeyboardEvent) => {
      keys.current.add(e.code);
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") e.preventDefault();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      destroyed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      if (world.current) {
        const { Matter: M, render, engine } = world.current;
        M.Render.stop(render);
        M.Mouse.clearSourceEvents(render.mouse);
        render.canvas.remove();
        M.Engine.clear(engine);
        world.current = null;
      }
    };
  }, [sdk]);
  const cloudSave = async () => {
    const scene = capture();
    if (!scene) return;
    try {
      await sdk.save(scene);
      setSnapshot(scene);
      setMessage("Workshop saved to cloud.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed");
    }
  };
  return (
    <div>
      <h2>Loose Parts workshop</h2>
      <p className="game-hint">
        Choose a tool, then click the workshop to place it. Drag uses a real
        spring constraint. Connect joints by clicking two bodies. Drive vehicle
        chassis with ← / →. Green bumpers push; violet hazards destroy dominoes.
      </p>
      <div className="game-tabs">
        {(
          [
            "select",
            "box",
            "ball",
            "plank",
            "domino",
            "ragdoll",
            "vehicle",
            "explosive",
            "joint",
            "hazard",
            "bumper",
            "delete",
          ] as Tool[]
        ).map((id) => (
          <button
            className={tool === id ? "selected" : ""}
            key={id}
            onClick={() => {
              setTool(id);
              jointStart.current = null;
            }}
          >
            {id}
          </button>
        ))}
      </div>
      <div className="game-canvas" ref={host}>
        {paused && <div className="game-overlay">Paused</div>}
      </div>
      <div className="game-row">
        <label>
          Gravity{" "}
          <input
            aria-label="Gravity"
            type="range"
            min={-2}
            max={2}
            step={0.1}
            value={gravity}
            onChange={(e) => {
              const value = Number(e.target.value);
              setGravity(value);
              if (world.current) world.current.engine.gravity.y = value;
            }}
          />
          {gravity.toFixed(1)}
        </label>
        <span>{count} / 150 bodies</span>
        <button disabled={paused} onClick={detonate}>
          Detonate bombs
        </button>
        <button onClick={() => void cloudSave()}>Save cloud scene</button>
        {snapshot && (
          <button onClick={() => restore(snapshot)}>Restore cloud scene</button>
        )}
      </div>
      <div className="game-row">
        <button
          onClick={() => {
            const scene = capture();
            if (!scene) return;
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(scene, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "tell-aviv-workshop.json";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export scene to share
        </button>
        <label className="game-button">
          Import scene{" "}
          <input
            aria-label="Import physics scene"
            type="file"
            accept=".json,application/json"
            style={{ maxWidth: 200 }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 200000) {
                setMessage("Scene file must be under 200 KB.");
                return;
              }
              try {
                const data = JSON.parse(await file.text()) as unknown;
                if (validateScene(data)) restore(data);
                else setMessage("Scene format is invalid.");
              } catch {
                setMessage("Could not read that scene.");
              }
            }}
          />
        </label>
        <button
          onClick={() =>
            restore({ version: 1, gravity: 1, bodies: [], joints: [] })
          }
        >
          Clear workshop
        </button>
      </div>
      <p className="game-hint" role="status">
        {message}
      </p>
    </div>
  );
}
