export type GamePermission =
  | "saves.read"
  | "saves.write"
  | "presence.write"
  | "leaderboards.read"
  | "matchmaking.use"
  | "currency.read"
  | "currency.spend";
export interface GameManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  developer: string;
  icon: string;
  cover: string;
  route: string;
  players: [number, number];
  multiplayer: boolean;
  controller: boolean;
  mobile: boolean;
  saveSchemaVersion: number;
  permissions: GamePermission[];
  category: string;
  tags: string[];
  featureFlags: string[];
  ranked: boolean;
}
const make = (
  id: string,
  name: string,
  description: string,
  icon: string,
  category: string,
  tags: string[],
  options: Partial<GameManifest> = {},
): GameManifest => ({
  id,
  name,
  description,
  version: "0.1.0",
  developer: "Tell Aviv",
  icon,
  cover: `/game-covers/${id}.svg`,
  route: `/games/${id}`,
  players: [1, 1],
  multiplayer: false,
  controller: false,
  mobile: true,
  saveSchemaVersion: 1,
  permissions: [
    "saves.read",
    "saves.write",
    "presence.write",
    "leaderboards.read",
  ],
  category,
  tags,
  featureFlags: [],
  ranked: false,
  ...options,
});
export const games: GameManifest[] = [
  make(
    "incremental",
    "Signal Foundry",
    "Turn a tiny spark into an automated industrial cosmos. Build production chains, research, and prestige.",
    "⚡",
    "Incremental",
    ["idle", "automation", "cloud saves"],
    {
      permissions: [
        "saves.read",
        "presence.write",
        "leaderboards.read",
        "currency.read",
        "currency.spend",
      ],
      ranked: true,
    },
  ),
  make(
    "tower-defense",
    "Neon Defense",
    "Defend three neon routes with tower synergies, enemy roles, campaign bosses, and bounded Endless waves.",
    "♜",
    "Strategy",
    ["strategy", "waves", "upgrades"],
    {
      ranked: true,
      multiplayer: true,
      players: [1, 4],
      permissions: [
        "saves.read",
        "saves.write",
        "presence.write",
        "leaderboards.read",
        "matchmaking.use",
      ],
    },
  ),
  make(
    "party-games",
    "After Hours",
    "Reaction races, trivia, and drawing with friends in private rooms. Solo warmups included.",
    "✦",
    "Party",
    ["multiplayer", "quick play"],
    {
      players: [1, 8],
      multiplayer: true,
      permissions: [
        "saves.read",
        "saves.write",
        "presence.write",
        "leaderboards.read",
        "matchmaking.use",
      ],
    },
  ),
  make(
    "casino",
    "Velvet Casino",
    "Fictional Credits only. Server-dealt games, private 2–6-player poker tables, collectibles, and escrowed trading.",
    "♦",
    "Casino",
    ["fictional currency", "cards", "chance"],
    {
      players: [1, 6],
      multiplayer: true,
      permissions: [
        "saves.read",
        "presence.write",
        "leaderboards.read",
        "currency.read",
        "currency.spend",
        "matchmaking.use",
      ],
      ranked: true,
    },
  ),
  make(
    "tycoon",
    "Empire Exchange",
    "Open businesses, hire a workforce, tune prices, and build an empire in a changing market.",
    "▥",
    "Simulation",
    ["economy", "offline", "management"],
    {
      permissions: [
        "saves.read",
        "presence.write",
        "leaderboards.read",
        "currency.read",
        "currency.spend",
      ],
      ranked: true,
    },
  ),
  make(
    "deck-roguelike",
    "Paper Odyssey",
    "Build an original deck, read enemy intentions, and choose a route through a changing expedition.",
    "▧",
    "Roguelike",
    ["cards", "turn based", "runs"],
    { ranked: true },
  ),
  make(
    "ego-trip",
    "Ego Trip",
    "Explore a forty-room campaign across eight districts, tackle a ranked boss gauntlet, or play synchronized co-op with friends.",
    "◈",
    "Action",
    ["campaign", "roguelike", "co-op"],
    {
      controller: true,
      multiplayer: true,
      players: [1, 4],
      ranked: true,
      permissions: [
        "saves.read",
        "saves.write",
        "presence.write",
        "leaderboards.read",
        "matchmaking.use",
      ],
    },
  ),
  make(
    "physics-sandbox",
    "Loose Parts",
    "A real 2D physics workshop. Build ragdolls, vehicles, constraints, and explosive contraptions.",
    "⚙",
    "Sandbox",
    ["physics", "creation", "cloud saves"],
  ),
  make(
    "social-deduction",
    "Night Shift",
    "Restore a station together while a hidden saboteur works against the crew. Private 4–12 player rooms.",
    "◉",
    "Social",
    ["hidden roles", "multiplayer"],
    {
      players: [4, 12],
      multiplayer: true,
      permissions: ["presence.write", "matchmaking.use", "leaderboards.read"],
    },
  ),
  make(
    "board-games",
    "Four in a Row",
    "Play Four in a Row, chess, or checkers locally or in authoritative two-player rooms.",
    "●",
    "Board",
    ["casual", "multiplayer"],
    {
      players: [1, 2],
      multiplayer: true,
      permissions: [
        "saves.read",
        "saves.write",
        "presence.write",
        "leaderboards.read",
        "matchmaking.use",
      ],
    },
  ),
];
export const gameById = (id: string) => games.find((game) => game.id === id);
