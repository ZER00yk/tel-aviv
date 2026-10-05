/** Shared discovery/recovery scopes for server-validated game outcomes. */
export const leaderboardCategories: Record<string, string[]> = {
  "ego-trip": [
    "campaign",
    "campaign-volatile",
    "campaign-challenge",
    "default",
    "volatile",
    "standard-fragile",
    "standard-no-helper",
    "standard-fragile-no-helper",
    "volatile-fragile",
    "volatile-no-helper",
    "volatile-fragile-no-helper",
  ],
  incremental: ["default", "production"],
  "tower-defense": ["default", "switchback", "crossroads", "endless"],
  casino: ["default"],
  tycoon: ["default"],
  "deck-roguelike": ["default", "daily-run"],
};
