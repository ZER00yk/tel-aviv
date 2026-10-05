/** Server-owned campaign content. No browser-provided enemy, drop or room state. */
export const COOP_CAMPAIGN_ROOMS = 40;
export type CoopRoomKind =
  | "combat"
  | "elite"
  | "challenge"
  | "boss"
  | "treasure"
  | "shop"
  | "helper"
  | "shrine"
  | "environment"
  | "choice"
  | "npc"
  | "curse"
  | "secret";
export type CoopReward = "power" | "guard" | "tempo" | "helper";
export interface CoopRoom {
  index: number;
  kind: CoopRoomKind;
  name: string;
  district: number;
  bossIndex: number;
  reward: number;
  options?: CoopRoomKind[];
}
export function campaignRandom(seed: number, room: number, salt = 0) {
  let n =
    (seed ^
      Math.imul(room + 1, 0x9e3779b9) ^
      Math.imul(salt + 1, 0x85ebca6b)) >>>
    0;
  n ^= n >>> 16;
  n = Math.imul(n, 0x7feb352d);
  n ^= n >>> 15;
  n = Math.imul(n, 0x846ca68b);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}
const districts = [
  "Afterimage avenue",
  "Perfect margins",
  "Momentum crossing",
  "Last signal station",
  "Glass archive",
  "Burnout furnace",
  "Promise vault",
  "Unwritten horizon",
];
export function campaignRoom(
  seed: number,
  index: number,
  selected?: CoopRoomKind,
): CoopRoom {
  const district = Math.floor(index / 5),
    slot = index % 5;
  const kind: CoopRoomKind =
    selected ??
    (slot === 4
      ? "boss"
      : slot === 1
        ? "choice"
        : slot === 2
          ? (["shop", "helper", "shrine", "treasure", "npc", "curse"] as const)[
              Math.floor(campaignRandom(seed, index) * 6)
            ]
          : slot === 3
            ? (["elite", "challenge", "environment"] as const)[
                Math.floor(campaignRandom(seed, index) * 3)
              ]
            : "combat");
  return {
    index,
    kind,
    name: `${districts[district % districts.length]} · ${kind === "choice" ? "Fork in the signal" : kind}`,
    district,
    bossIndex: district,
    reward:
      kind === "boss" ? 32 : kind === "elite" || kind === "challenge" ? 20 : 12,
    ...(kind === "choice"
      ? { options: ["combat", "elite", "treasure"] as CoopRoomKind[] }
      : {}),
  };
}
export const coopRewards: {
  id: CoopReward;
  name: string;
  description: string;
}[] = [
  {
    id: "power",
    name: "Clear emphasis",
    description: "Bounded damage upgrade; up to four stacks.",
  },
  {
    id: "guard",
    name: "Margin shield",
    description: "More maximum health and a small heal; up to four stacks.",
  },
  {
    id: "tempo",
    name: "Fast thoughts",
    description:
      "Faster primary fire with diminishing returns; up to four stacks.",
  },
  {
    id: "helper",
    name: "Signal companion",
    description:
      "An owned helper fires with you. Further stacks improve it, up to four.",
  },
];
