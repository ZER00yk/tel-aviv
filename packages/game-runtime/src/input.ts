export function readController() {
  let pad: Gamepad | null | undefined;
  try {
    pad =
      typeof navigator !== "undefined"
        ? navigator
            .getGamepads?.()
            .find((value) => value && value.connected !== false)
        : null;
  } catch {
    // Some embedded browsers disable this optional API through a permissions policy.
    pad = null;
  }
  const dead = (n: number) =>
    Number.isFinite(n) && Math.abs(n) > 0.15 ? Math.max(-1, Math.min(1, n)) : 0;
  return {
    x: dead(pad?.axes[0] ?? 0),
    y: dead(pad?.axes[1] ?? 0),
    attack: pad?.buttons[0]?.pressed ?? false,
    dash: pad?.buttons[1]?.pressed ?? false,
    alternate: pad?.buttons[2]?.pressed ?? false,
    pause: pad?.buttons[9]?.pressed ?? false,
  };
}
