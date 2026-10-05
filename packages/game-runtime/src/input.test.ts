import { afterEach, describe, expect, it, vi } from "vitest";
import { readController } from "./input";
afterEach(() => vi.unstubAllGlobals());
describe("optional controller input", () => {
  it("keeps games playable when a browser denies gamepad access", () => {
    vi.stubGlobal("navigator", {
      getGamepads() {
        throw new Error("Permissions policy");
      },
    });
    expect(readController()).toMatchObject({
      x: 0,
      y: 0,
      attack: false,
      pause: false,
    });
  });
  it("ignores disconnected pads and clamps finite axes around the dead zone", () => {
    vi.stubGlobal("navigator", {
      getGamepads: () => [
        { connected: false, axes: [1, 1], buttons: [] },
        { connected: true, axes: [2, 0.1], buttons: [{ pressed: true }] },
      ],
    });
    expect(readController()).toMatchObject({
      x: 1,
      y: 0,
      attack: true,
      dash: false,
    });
    vi.stubGlobal("navigator", {
      getGamepads: () => [{ axes: [NaN, Infinity], buttons: [] }],
    });
    expect(readController()).toMatchObject({ x: 0, y: 0 });
  });
});
