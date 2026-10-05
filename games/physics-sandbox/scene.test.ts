import { it, expect } from "vitest";
import { validateScene } from "./scene";
it("accepts a bounded scene but rejects oversized or nonfinite physics input", () => {
  const scene = {
    version: 1,
    gravity: 1,
    bodies: [
      {
        id: "a",
        type: "box",
        x: 100,
        y: 100,
        angle: 0,
        width: 40,
        height: 40,
        radius: 0,
        isStatic: false,
      },
    ],
    joints: [],
  };
  expect(validateScene(scene)).toBe(true);
  expect(
    validateScene({
      ...scene,
      bodies: [{ ...scene.bodies[0], width: 100000 }],
    }),
  ).toBe(false);
  expect(
    validateScene({ ...scene, bodies: [{ ...scene.bodies[0], x: NaN }] }),
  ).toBe(false);
  expect(
    validateScene({
      ...scene,
      joints: [{ a: "a", b: "b", length: 1, stiffness: 2 }],
    }),
  ).toBe(false);
});
