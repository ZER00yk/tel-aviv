import type { WaveEnemy } from "../server/tower";
export function replayEnemy(enemy: WaveEnemy, time: number) {
  if (
    time < enemy.spawn ||
    time >= (enemy.endTime ?? Infinity) ||
    !enemy.points.length
  )
    return null;
  const before =
    [...enemy.points].reverse().find((point) => point.time <= time) ??
    enemy.points[0];
  const after = enemy.points.find((point) => point.time > time) ?? before;
  const ratio =
    after.time === before.time
      ? 0
      : Math.max(
          0,
          Math.min(1, (time - before.time) / (after.time - before.time)),
        );
  return {
    x: before.x + (after.x - before.x) * ratio,
    y: before.y + (after.y - before.y) * ratio,
    hp: before.hp + (after.hp - before.hp) * ratio,
    shield: before.shield + (after.shield - before.shield) * ratio,
  };
}
