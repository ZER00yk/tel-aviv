import { z } from "zod";
import type { JSONValue } from "postgres";
import { db } from "@tell-aviv/database";
import { fail, type ApiHandler } from "@tell-aviv/shared";

export type CosmeticSlot = "frame" | "title" | "badge";
export interface CosmeticItem {
  id: string;
  name: string;
  kind: CosmeticSlot;
  price: number;
  description: string;
  icon: string;
  color: string;
  earnedOnly?: boolean;
}
// These are the same three items offered by the authoritative economy purchase handler.
export const COSMETIC_CATALOG: readonly CosmeticItem[] = [
  {
    id: "frame-neon",
    name: "Neon frame",
    kind: "frame",
    price: 40,
    description: "A bright mint halo around your profile avatar.",
    icon: "◈",
    color: "#8ee8c4",
  },
  {
    id: "title-night-owl",
    name: "Night owl",
    kind: "title",
    price: 60,
    description: "An evening title beside your Tell Aviv identity.",
    icon: "☾",
    color: "#b9a5ec",
  },
  {
    id: "badge-foundry",
    name: "Foundry badge",
    kind: "badge",
    price: 100,
    description: "A small badge for a builder at heart.",
    icon: "✦",
    color: "#e5cb89",
  },
  {
    id: "badge-ego-victory",
    name: "Verified confidence",
    kind: "badge",
    price: 0,
    earnedOnly: true,
    description:
      "Earned by completing an entire server-simulated Ego Trip ranked gauntlet.",
    icon: "✺",
    color: "#c27fff",
  },
];

export interface ShowcaseAchievement {
  id: string;
  gameId: string;
  name: string;
  description: string;
  icon: string;
  points: number;
  unlockedAt: string;
}
export interface ProfilePresentation {
  equipment: Record<CosmeticSlot, CosmeticItem | null>;
  showcase: ShowcaseAchievement[];
  showcasePrivate: boolean;
}
export interface InventoryData extends ProfilePresentation {
  balance: number;
  shop: (CosmeticItem & { owned: boolean })[];
  inventory: { itemId: string; acquiredAt: string }[];
  achievements: ShowcaseAchievement[];
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    fail(400, result.error.issues[0]?.message ?? "Invalid inventory input");
  return result.data;
}
function object(value: unknown): Record<string, JSONValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JSONValue>)
    : {};
}
function selectedIds(settings: Record<string, JSONValue>): string[] {
  const selected = settings.achievementShowcase;
  return Array.isArray(selected)
    ? [
        ...new Set(
          selected.filter((item): item is string => typeof item === "string"),
        ),
      ].slice(0, 5)
    : [];
}
async function ownedCosmetics(userId: string) {
  const rows =
    await db`SELECT item_id AS "itemId",acquired_at AS "acquiredAt" FROM cosmetic_inventory WHERE user_id=${userId} ORDER BY acquired_at DESC`;
  return rows.map((row) => ({
    itemId: String(row.itemId),
    acquiredAt: new Date(row.acquiredAt).toISOString(),
  }));
}
async function unlockedAchievements(
  userId: string,
): Promise<ShowcaseAchievement[]> {
  const rows =
    await db`SELECT d.id,d.game_id AS "gameId",d.name,d.description,d.icon,d.points,a.unlocked_at AS "unlockedAt" FROM user_achievements a JOIN achievement_definitions d ON d.id=a.achievement_id WHERE a.user_id=${userId} ORDER BY a.unlocked_at DESC LIMIT 200`;
  return rows.map((row) => ({
    id: String(row.id),
    gameId: String(row.gameId),
    name: String(row.name),
    description: String(row.description),
    icon: String(row.icon),
    points: Number(row.points),
    unlockedAt: new Date(row.unlockedAt).toISOString(),
  }));
}
function presentation(
  settings: Record<string, JSONValue>,
  inventory: { itemId: string }[],
  achievements: ShowcaseAchievement[],
  privateShowcase: boolean,
): ProfilePresentation {
  const equipped = object(settings.cosmetics);
  const owned = new Set(inventory.map((item) => item.itemId));
  const item = (slot: CosmeticSlot) =>
    COSMETIC_CATALOG.find(
      (candidate) =>
        candidate.kind === slot &&
        candidate.id === equipped[slot] &&
        owned.has(candidate.id),
    ) ?? null;
  return {
    equipment: {
      frame: item("frame"),
      title: item("title"),
      badge: item("badge"),
    },
    showcase: privateShowcase
      ? []
      : selectedIds(settings)
          .map((id) =>
            achievements.find((achievement) => achievement.id === id),
          )
          .filter(
            (achievement): achievement is ShowcaseAchievement => !!achievement,
          ),
    showcasePrivate: privateShowcase,
  };
}

export async function profilePresentation(
  viewerId: string,
  targetId: string,
): Promise<ProfilePresentation> {
  parse(z.string().uuid(), targetId);
  const [target] =
    await db`SELECT settings FROM users WHERE id=${targetId} AND disabled=false`;
  if (!target) fail(404, "User not found");
  if (
    viewerId !== targetId &&
    (
      await db`SELECT 1 FROM user_blocks WHERE (user_id=${viewerId} AND blocked_id=${targetId}) OR (user_id=${targetId} AND blocked_id=${viewerId})`
    ).length
  )
    fail(404, "User not found");
  const settings = object(target.settings);
  const privateShowcase =
    viewerId !== targetId && object(settings.privacy).showActivity === false;
  const [inventory, achievements] = await Promise.all([
    ownedCosmetics(targetId),
    privateShowcase ? Promise.resolve([]) : unlockedAchievements(targetId),
  ]);
  return presentation(settings, inventory, achievements, privateShowcase);
}

export const handleInventory: ApiHandler = async (
  path,
  method,
  { user },
  input,
) => {
  if (path[0] !== "inventory") return undefined;
  const [active] =
    await db`SELECT settings FROM users WHERE id=${user.id} AND disabled=false`;
  if (!active) fail(401, "Session unavailable");
  if (method === "GET" && path.length === 1) {
    const [inventory, achievements, account] = await Promise.all([
      ownedCosmetics(user.id),
      unlockedAchievements(user.id),
      db`SELECT balance FROM currency_accounts WHERE user_id=${user.id} AND currency='tell-coins'`,
    ]);
    const owned = new Set(inventory.map((item) => item.itemId));
    return {
      ...presentation(object(active.settings), inventory, achievements, false),
      balance: Number(account[0]?.balance ?? 0),
      shop: COSMETIC_CATALOG.map((item) => ({
        ...item,
        owned: owned.has(item.id),
      })),
      inventory,
      achievements,
    } satisfies InventoryData;
  }
  if (method === "GET" && path.length === 3 && path[1] === "profile")
    return profilePresentation(user.id, path[2]);
  if (method === "POST" && path.length === 2 && path[1] === "equip") {
    const data = parse(
      z
        .object({
          slot: z.enum(["frame", "title", "badge"]),
          itemId: z.string().max(80).nullable(),
        })
        .strict(),
      input,
    );
    const item = data.itemId
      ? COSMETIC_CATALOG.find(
          (candidate) =>
            candidate.id === data.itemId && candidate.kind === data.slot,
        )
      : null;
    if (data.itemId !== null && !item)
      fail(400, "Choose a cosmetic for this slot");
    return db.begin(async (sql) => {
      const [current] =
        await sql`SELECT settings FROM users WHERE id=${user.id} AND disabled=false FOR UPDATE`;
      if (!current) fail(401, "Session unavailable");
      if (
        item &&
        !(
          await sql`SELECT 1 FROM cosmetic_inventory WHERE user_id=${user.id} AND item_id=${item.id}`
        ).length
      )
        fail(403, "You must own this cosmetic before equipping it");
      const settings = object(current.settings);
      const cosmetics = {
        ...object(settings.cosmetics),
        [data.slot]: data.itemId,
      };
      await sql`UPDATE users SET settings=${sql.json({ ...settings, cosmetics })},updated_at=now() WHERE id=${user.id}`;
      return { ok: true, slot: data.slot, itemId: data.itemId };
    });
  }
  if (method === "POST" && path.length === 2 && path[1] === "showcase") {
    const data = parse(
      z
        .object({
          achievementIds: z
            .array(z.string().min(1).max(100))
            .max(5)
            .refine(
              (ids) => new Set(ids).size === ids.length,
              "Choose each achievement once",
            ),
        })
        .strict(),
      input,
    );
    return db.begin(async (sql) => {
      const [current] =
        await sql`SELECT settings FROM users WHERE id=${user.id} AND disabled=false FOR UPDATE`;
      if (!current) fail(401, "Session unavailable");
      if (data.achievementIds.length) {
        const earned =
          await sql`SELECT achievement_id FROM user_achievements WHERE user_id=${user.id} AND achievement_id IN ${sql(data.achievementIds)}`;
        if (earned.length !== data.achievementIds.length)
          fail(403, "Only achievements you have earned can be showcased");
      }
      await sql`UPDATE users SET settings=${sql.json({ ...object(current.settings), achievementShowcase: data.achievementIds })},updated_at=now() WHERE id=${user.id}`;
      return { ok: true, achievementIds: data.achievementIds };
    });
  }
  fail(404, "Inventory endpoint not found");
};
