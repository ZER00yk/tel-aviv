import type { World } from "./engine";
export interface CombatTelemetry {
  damageDealt: number;
  damageTaken: number;
  healing: number;
}
export const EGO_SATCHEL_LIMIT = 250;
/** Existing larger balances are preserved; current campaigns cannot accumulate unlimited surplus. */
export function grantEgo(w: World, amount: number) {
  const before = w.ego;
  w.ego =
    w.campaign?.contentVersion === 2
      ? Math.max(before, Math.min(EGO_SATCHEL_LIMIT, before + amount))
      : before + amount;
  return w.ego - before;
}
export function healPlayer(w: World, amount: number) {
  const healed = Math.max(0, Math.min(w.player.maxHp - w.player.hp, amount));
  w.player.hp += healed;
  if (w.telemetry) w.telemetry.healing += healed;
  return healed;
}
export function damageTarget(w: World, target: { hp: number }, amount: number) {
  const dealt = Math.max(0, Math.min(target.hp, amount));
  target.hp -= amount;
  if (w.telemetry) w.telemetry.damageDealt += dealt;
}
