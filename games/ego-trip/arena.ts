import type { Vec } from "./engine";
import { bosses, type ArenaId } from "./content";
export interface Terrain extends Vec {
  radius: number;
  kind: "cover" | "heat" | "slow";
}
export interface ArenaLayout {
  id: ArenaId;
  name: string;
  description: string;
  terrain: Terrain[];
  conveyor: number;
}
const cover = (x: number, y: number, radius = 32): Terrain => ({
  x,
  y,
  radius,
  kind: "cover",
});
const layouts: Record<ArenaId, ArenaLayout> = {
  orbit: {
    id: "orbit",
    name: "The amphitheatre",
    description:
      "Open concentric floor; rings reward moving between safe bands.",
    terrain: [],
    conveyor: 0,
  },
  grid: {
    id: "grid",
    name: "The blueprint",
    description: "Two pillars block projectiles. Beams still cross cover.",
    terrain: [cover(250, 285, 38), cover(650, 285, 38)],
    conveyor: 0,
  },
  track: {
    id: "track",
    name: "The express lane",
    description:
      "The lower lane carries you right; the upper lane carries you left.",
    terrain: [],
    conveyor: 38,
  },
  signal: {
    id: "signal",
    name: "The transmitter court",
    description: "Four pylons give cover, but the central court stays exposed.",
    terrain: [
      cover(230, 170),
      cover(670, 170),
      cover(230, 410),
      cover(670, 410),
    ],
    conveyor: 0,
  },
  glass: {
    id: "glass",
    name: "The mirror gallery",
    description:
      "A diamond of mirrors splits the arena. Reflections target your last position.",
    terrain: [
      cover(450, 115, 28),
      cover(275, 280, 28),
      cover(625, 280, 28),
      cover(450, 445, 28),
    ],
    conveyor: 0,
  },
  furnace: {
    id: "furnace",
    name: "The cooling floor",
    description:
      "Two furnace grates pulse every six seconds. Use the center to cool down.",
    terrain: [
      { x: 180, y: 285, radius: 75, kind: "heat" },
      { x: 720, y: 285, radius: 75, kind: "heat" },
    ],
    conveyor: 0,
  },
  archive: {
    id: "archive",
    name: "The promise archive",
    description:
      "Three stacks give cover; loose pages slow movement near the bottom corners.",
    terrain: [
      cover(290, 220, 32),
      cover(450, 310, 32),
      cover(610, 220, 32),
      { x: 110, y: 465, radius: 68, kind: "slow" },
      { x: 790, y: 465, radius: 68, kind: "slow" },
    ],
    conveyor: 0,
  },
  eclipse: {
    id: "eclipse",
    name: "The open ending",
    description:
      "An open arena and two small refuges. Noa's verdict leaves a readable safe corridor.",
    terrain: [cover(185, 280, 27), cover(715, 280, 27)],
    conveyor: 0,
  },
};
export function arenaFor(index: number) {
  return layouts[bosses[index]?.arena ?? "orbit"];
}
/** All clients and server simulation use the same non-random arena geometry. */
export function keepOutsideCover(
  point: Vec,
  terrain: Terrain[],
  radius: number,
) {
  for (const obstacle of terrain)
    if (obstacle.kind === "cover") {
      const dx = point.x - obstacle.x,
        dy = point.y - obstacle.y,
        distance = Math.hypot(dx, dy);
      if (distance < obstacle.radius + radius) {
        const angle = distance < 0.001 ? 0 : Math.atan2(dy, dx);
        point.x = obstacle.x + Math.cos(angle) * (obstacle.radius + radius);
        point.y = obstacle.y + Math.sin(angle) * (obstacle.radius + radius);
      }
    }
}
