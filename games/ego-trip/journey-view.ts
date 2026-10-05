import type { World } from "./engine";

/** Player-facing instructions derived only from the current visible encounter. */
export function journeyView(world: World) {
  const campaign = world.campaign;
  const journey = campaign?.journey;
  if (!campaign?.pacingVersion || !journey) return null;
  const gated = journey.stage <= journey.stages;
  const boss = ["boss", "miniboss"].includes(campaign.room.kind);
  const objective = campaign.objective;
  const enemies = world.enemies.filter((enemy) => enemy.hp > 0).length;
  const task = objective
    ? objective.kind === "parcel"
      ? objective.carrying
        ? "Deliver the signal to the green marker."
        : "Recover the next signal at the green marker."
      : objective.kind === "ward"
        ? "Reach the next ward mark."
        : objective.kind === "escort"
          ? objective.carrying
            ? "Guide the relay through the green markers."
            : "Pick up the relay at the green marker."
          : "Reach the green marker."
    : gated
      ? "Defeat the squad to reveal the next objective."
      : "The shield is broken. Attack the boss.";
  return {
    label:
      (campaign.room.kind === "boss" ? `Phase ${journey.bossPhase}/3 · ` : "") +
      (gated
        ? `mission ${journey.stage}/${journey.stages}`
        : "missions cleared"),
    task:
      task +
      (objective ? ` ${objective.progress}/${objective.target} marks.` : "") +
      (objective && enemies ? " Clear the ambush to finish this mission." : ""),
    shielded: gated && boss,
  };
}
