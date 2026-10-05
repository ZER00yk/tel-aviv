export const TOWER_DEFS = {
  rapid: { name: "Rapid", cost: 45, damage: 6, range: 2.2, interval: 0.5 },
  heavy: { name: "Heavy", cost: 70, damage: 25, range: 2, interval: 1.6 },
  splash: { name: "Splash", cost: 95, damage: 13, range: 2.2, interval: 1.4 },
  slow: { name: "Slow", cost: 60, damage: 2, range: 2.5, interval: 0.7 },
  sniper: { name: "Sniper", cost: 110, damage: 32, range: 5, interval: 2 },
  burn: { name: "Ink", cost: 80, damage: 8, range: 2.2, interval: 0.8 },
  support: { name: "Beacon", cost: 90, damage: 0, range: 2.2, interval: 1 },
  economy: { name: "Mint", cost: 75, damage: 0, range: 0, interval: 1 },
} as const;
export type TowerKind = keyof typeof TOWER_DEFS;

export type TowerMapId = "boulevard" | "switchback" | "crossroads";
export type TowerMode = "campaign" | "endless";
export type TowerTarget = "first" | "strongest" | "support";
export interface PathPoint {
  x: number;
  y: number;
}
export interface TowerMap {
  name: string;
  description: string;
  routes: readonly (readonly PathPoint[])[];
  bonusTiles: readonly {
    x: number;
    y: number;
    kind: "high-ground" | "power-node";
  }[];
}
export const TOWER_MAPS = {
  boulevard: {
    name: "City Boulevard",
    description:
      "A direct lane. Fast runners punish builds with gaps; open space supports flexible upgrades.",
    routes: [
      [
        { x: -0.4, y: 2 },
        { x: 7.7, y: 2 },
      ],
    ],
    bonusTiles: [
      { x: 1, y: 0, kind: "high-ground" },
      { x: 6, y: 4, kind: "power-node" },
    ],
  },
  switchback: {
    name: "Canal Switchback",
    description:
      "A long winding route with shared firing angles and fewer building tiles. Healers and regenerating enemies gain time to recover.",
    routes: [
      [
        { x: -0.4, y: 1 },
        { x: 6, y: 1 },
        { x: 6, y: 3 },
        { x: 1, y: 3 },
        { x: 1, y: 4 },
        { x: 7.7, y: 4 },
      ],
    ],
    bonusTiles: [
      { x: 4, y: 2, kind: "power-node" },
      { x: 7, y: 2, kind: "high-ground" },
    ],
  },
  crossroads: {
    name: "Two-Way Crossing",
    description:
      "Enemies divide between two routes. Central defenses cover both lanes; distant towers risk missing a whole group.",
    routes: [
      [
        { x: -0.4, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: 3 },
        { x: 7.7, y: 3 },
      ],
      [
        { x: -0.4, y: 3 },
        { x: 4, y: 3 },
        { x: 4, y: 1 },
        { x: 7.7, y: 1 },
      ],
    ],
    bonusTiles: [
      { x: 2, y: 2, kind: "high-ground" },
      { x: 5, y: 2, kind: "power-node" },
    ],
  },
} as const satisfies Record<TowerMapId, TowerMap>;
export function towerMap(id: TowerMapId | undefined): TowerMap {
  return TOWER_MAPS[id ?? "boulevard"];
}
export function pathLength(route: readonly PathPoint[]) {
  return route
    .slice(1)
    .reduce(
      (sum, point, index) =>
        sum + Math.hypot(point.x - route[index].x, point.y - route[index].y),
      0,
    );
}
export function pathPosition(
  route: readonly PathPoint[],
  distance: number,
): PathPoint {
  let remaining = Math.max(0, distance);
  for (let index = 1; index < route.length; index++) {
    const start = route[index - 1],
      end = route[index],
      length = Math.hypot(end.x - start.x, end.y - start.y);
    if (remaining <= length)
      return {
        x: start.x + ((end.x - start.x) * remaining) / length,
        y: start.y + ((end.y - start.y) * remaining) / length,
      };
    remaining -= length;
  }
  return { ...route[route.length - 1] };
}
export function pathTile(map: TowerMap, x: number, y: number) {
  return map.routes.some((route) =>
    route.slice(1).some((point, index) => {
      const before = route[index];
      return (
        (before.y === point.y &&
          y === point.y &&
          x >= Math.min(before.x, point.x) &&
          x <= Math.max(before.x, point.x)) ||
        (before.x === point.x &&
          x === point.x &&
          y >= Math.min(before.y, point.y) &&
          y <= Math.max(before.y, point.y))
      );
    }),
  );
}
export const ENEMY_DEFS = {
  grunt: {
    name: "Crawler",
    hp: 1,
    speed: 1,
    armor: 0,
    description: "Basic infantry.",
  },
  runner: {
    name: "Runner",
    hp: 0.7,
    speed: 1.8,
    armor: 0,
    description: "Fast and fragile; rapid coverage is essential.",
  },
  armored: {
    name: "Ironclad",
    hp: 1.6,
    speed: 0.7,
    armor: 0.55,
    description:
      "Resists rapid and splash hits. Heavy, sniper and burn bypass armor.",
  },
  shield: {
    name: "Shieldbearer",
    hp: 1.05,
    speed: 0.9,
    armor: 0,
    description: "An extra shield absorbs early hits. Ink burns through it.",
  },
  healer: {
    name: "Medic",
    hp: 1.2,
    speed: 0.8,
    armor: 0,
    description:
      "Heals nearby damaged enemies. Support-priority targeting picks it first.",
  },
  splitter: {
    name: "Splitter",
    hp: 1.15,
    speed: 0.9,
    armor: 0,
    description: "Defeat releases two runners. Splash clears the children.",
  },
  regen: {
    name: "Regenerator",
    hp: 1.3,
    speed: 0.85,
    armor: 0,
    description:
      "Recovers health while unburned. Ink disables its regeneration.",
  },
  disruptor: {
    name: "Jammer",
    hp: 1.5,
    speed: 0.9,
    armor: 0,
    description: "Slows nearby tower reloads. Prioritize support enemies.",
  },
  stealth: {
    name: "Veil",
    hp: 0.85,
    speed: 1.25,
    armor: 0,
    description: "Only snipers or towers near a Beacon can acquire it.",
  },
  boss: {
    name: "Siege Engine",
    hp: 3,
    speed: 0.7,
    armor: 0.25,
    description:
      "A heavily protected wave leader. Shields, sustained burns and armor piercing matter.",
  },
} as const;
export type EnemyKind = keyof typeof ENEMY_DEFS;
export const TOWER_SYNERGIES = [
  {
    name: "Cryo shatter",
    description: "Heavy and splash deal 35% more damage to slowed enemies.",
  },
  {
    name: "Painted target",
    description:
      "Rapid hits mark enemies for two seconds; sniper hits deal 40% more damage to marked targets.",
  },
  {
    name: "Thermal shock",
    description:
      "Ink damage over time doubles while an enemy is slowed; burning also blocks regeneration.",
  },
  {
    name: "Beacon network",
    description:
      "Nearby Beacons boost damage, extend range and reveal Veils. The aura is bounded to four Beacons.",
  },
] as const;

export function waveKinds(
  wave: number,
  count = 5 + Math.floor(wave * 1.5),
): EnemyKind[] {
  return Array.from({ length: Math.min(80, count) }, (_, index) => {
    if (wave % 5 === 0 && index === Math.min(80, count) - 1) return "boss";
    if (wave >= 12 && index % 10 === 8) return "stealth";
    if (wave >= 11 && index % 13 === 6) return "disruptor";
    if (wave >= 9 && index % 11 === 5) return "splitter";
    if (wave >= 7 && index % 9 === 4) return "healer";
    if (wave >= 6 && index % 7 === 2) return "shield";
    if (wave >= 4 && index % 8 === 1) return "regen";
    if (wave >= 3 && index % 6 === 3) return "armored";
    if (wave >= 2 && index % 5 === 0) return "runner";
    return "grunt";
  });
}
