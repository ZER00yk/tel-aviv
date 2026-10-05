import { describe, expect, it } from "vitest";
import {
  movementKeysSchema,
  translateMovementCode,
  translateMovementKey,
} from "../packages/shared/src/movement";
describe("safe movement remapping", () => {
  it("maps physical keys, disables replaced WASD keys and retains arrows and action keys", () => {
    const binding = { right: "KeyI" } as const;
    expect(translateMovementCode("KeyI", binding)).toBe("KeyD");
    expect(translateMovementCode("KeyD", binding)).toBe("");
    expect(translateMovementCode("ArrowRight", binding)).toBe("ArrowRight");
    expect(translateMovementCode("Space", binding)).toBe("Space");
    expect(translateMovementKey("KeyI", "I", binding)).toBe("d");
  });
  it("rejects conflicting, reserved and unknown bindings", () => {
    for (const invalid of [
      { left: "KeyW" },
      { up: "KeyI", right: "KeyI" },
      { up: "Escape" },
      { up: "KeyE" },
      { script: "alert(1)" },
    ])
      expect(movementKeysSchema.safeParse(invalid).success).toBe(false);
    expect(
      movementKeysSchema.safeParse({
        up: "KeyI",
        down: "KeyM",
        left: "KeyU",
        right: "KeyO",
      }).success,
    ).toBe(true);
  });
});
