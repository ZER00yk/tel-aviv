import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import { handleGames } from "../packages/platform/src/games";
import { handleSocial } from "../packages/platform/src/social";
import {
  COSMETIC_CATALOG,
  handleInventory,
  type InventoryData,
  type ProfilePresentation,
} from "../packages/platform/src/inventory";

// Each test owns its generated accounts. No existing achievements or shop stock are changed.
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "owned profile cosmetics and achievement showcase",
  () => {
    let users: User[] = [];
    const context = (user: User) => ({
      user,
      request: new Request("http://localhost:3000/api/inventory"),
    });
    const inventory = (user: User) =>
      handleInventory(
        ["inventory"],
        "GET",
        context(user),
        {},
      ) as Promise<InventoryData>;
    const equip = (user: User, slot: string, itemId: string | null) =>
      handleInventory(["inventory", "equip"], "POST", context(user), {
        slot,
        itemId,
      });
    const showcase = (user: User, achievementIds: string[]) =>
      handleInventory(["inventory", "showcase"], "POST", context(user), {
        achievementIds,
      });
    const publicView = (viewer: User, target: User) =>
      handleInventory(
        ["inventory", "profile", target.id],
        "GET",
        context(viewer),
        {},
      ) as Promise<ProfilePresentation>;
    const purchase = (user: User, itemId: string) =>
      handleGames(["economy", "purchase"], "POST", context(user), {
        itemId,
        price: 0,
        balance: 999999,
      });

    beforeEach(async () => {
      for (let index = 0; index < 2; index++) {
        const id = randomUUID();
        await db`INSERT INTO users(id,username,display_name,settings) VALUES(${id},${`inv_${id.slice(0, 8)}`},'Inventory fixture',${db.json({ privacy: { showFriends: false }, appearance: "light" })})`;
        await db`INSERT INTO currency_accounts(user_id,currency,balance) VALUES(${id},'tell-coins',200)`;
        users.push((await getUser(id))!);
      }
    });
    afterEach(async () => {
      for (const user of users) await db`DELETE FROM users WHERE id=${user.id}`;
      users = [];
    });

    it("uses the purchase catalog and serializes repeated purchases without trusting client prices", async () => {
      const user = users[0];
      const economy = (await handleGames(
        ["economy"],
        "GET",
        context(user),
        {},
      )) as { shop: { id: string; price: number; kind: string }[] };
      expect(
        economy.shop.map((item) => [item.id, item.price, item.kind]),
      ).toEqual(
        COSMETIC_CATALOG.map((item) => [item.id, item.price, item.kind]),
      );
      const purchases = await Promise.allSettled([
        purchase(user, "frame-neon"),
        purchase(user, "frame-neon"),
      ]);
      expect(
        purchases.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const owned = await inventory(user);
      expect(owned.balance).toBe(160);
      expect(owned.inventory.map((item) => item.itemId)).toEqual([
        "frame-neon",
      ]);
      const ledger =
        await db`SELECT amount,balance_after FROM currency_ledger WHERE user_id=${user.id} AND reason='cosmetic purchase'`;
      expect(ledger).toHaveLength(1);
      expect(Number(ledger[0].amount)).toBe(-40);
      expect(Number(ledger[0].balance_after)).toBe(160);
      expect((await inventory(users[1])).inventory).toHaveLength(0);
    });

    it("requires ownership and the correct slot, and prevents generic settings from forging cosmetics", async () => {
      const user = users[0];
      await expect(equip(user, "frame", "frame-neon")).rejects.toThrow("own");
      await purchase(user, "frame-neon");
      await expect(equip(user, "badge", "frame-neon")).rejects.toThrow("slot");
      await expect(equip(user, "frame", "administrator-badge")).rejects.toThrow(
        "slot",
      );
      await expect(
        handleSocial(["profile"], "POST", context(user), {
          settings: {
            cosmetics: { frame: "frame-neon" },
            achievementShowcase: ["deck-clear"],
          },
        }),
      ).rejects.toThrow();
      await expect(
        handleInventory(["inventory", "equip"], "POST", context(user), {
          slot: "frame",
          itemId: "frame-neon",
          userId: users[1].id,
        }),
      ).rejects.toThrow();
      await equip(user, "frame", "frame-neon");
      expect((await publicView(users[1], user)).equipment.frame?.id).toBe(
        "frame-neon",
      );
      await equip(user, "frame", null);
      expect((await inventory(user)).equipment.frame).toBeNull();
    });

    it("preserves simultaneous slot and ordinary profile changes without minting XP or currency", async () => {
      const user = users[0];
      await purchase(user, "frame-neon");
      await purchase(user, "title-night-owl");
      await Promise.all([
        equip(user, "frame", "frame-neon"),
        equip(user, "title", "title-night-owl"),
        handleSocial(["profile"], "POST", context(user), {
          bio: "Preserved biography",
          settings: { privacy: { allowFriendRequests: false } },
        }),
      ]);
      const owned = await inventory(user);
      expect(owned.equipment.frame?.id).toBe("frame-neon");
      expect(owned.equipment.title?.id).toBe("title-night-owl");
      expect(owned.balance).toBe(100);
      const fresh = (await getUser(user.id))!;
      expect(fresh.bio).toBe("Preserved biography");
      expect(fresh.settings.privacy).toEqual({
        showFriends: false,
        allowFriendRequests: false,
      });
      expect(fresh.settings.appearance).toBe("light");
      expect(fresh.xp).toBe(0);
    });

    it("accepts only earned unique achievements and preserves a selected display order", async () => {
      const user = users[0];
      await db`INSERT INTO user_achievements(user_id,achievement_id) VALUES(${user.id},'incremental-forge'),(${user.id},'tower-ten')`;
      await expect(showcase(user, ["deck-clear"])).rejects.toThrow("earned");
      await expect(showcase(user, ["tower-ten", "tower-ten"])).rejects.toThrow(
        "once",
      );
      await expect(
        showcase(user, ["1", "2", "3", "4", "5", "6"]),
      ).rejects.toThrow();
      await showcase(user, ["tower-ten", "incremental-forge"]);
      const shown = await publicView(users[1], user);
      expect(shown.showcase.map((achievement) => achievement.id)).toEqual([
        "tower-ten",
        "incremental-forge",
      ]);
      expect(shown).not.toHaveProperty("balance");
      expect(shown).not.toHaveProperty("inventory");
      expect((await getUser(user.id))!.xp).toBe(0);
      expect((await inventory(user)).balance).toBe(200);
      await showcase(user, []);
      expect((await publicView(users[1], user)).showcase).toHaveLength(0);
    });

    it("honors activity privacy and blocking while the owner can still view their showcase", async () => {
      const [owner, viewer] = users;
      await db`INSERT INTO user_achievements(user_id,achievement_id) VALUES(${owner.id},'incremental-forge')`;
      await showcase(owner, ["incremental-forge"]);
      await handleSocial(["profile"], "POST", context(owner), {
        settings: { privacy: { showActivity: false } },
      });
      const hidden = await publicView(viewer, owner);
      expect(hidden.showcase).toHaveLength(0);
      expect(hidden.showcasePrivate).toBe(true);
      expect((await publicView(owner, owner)).showcase).toHaveLength(1);
      await db`INSERT INTO user_blocks(user_id,blocked_id) VALUES(${viewer.id},${owner.id})`;
      await expect(publicView(viewer, owner)).rejects.toThrow("User not found");
    });

    it("filters invalid stored selections and rechecks disabled accounts", async () => {
      const [owner, viewer] = users;
      await db`UPDATE users SET settings=${db.json({ cosmetics: { frame: "frame-neon", badge: "owner" }, achievementShowcase: ["deck-clear"] })} WHERE id=${owner.id}`;
      const safe = await publicView(viewer, owner);
      expect(safe.equipment).toEqual({ frame: null, title: null, badge: null });
      expect(safe.showcase).toHaveLength(0);
      await db`UPDATE users SET disabled=true WHERE id=${owner.id}`;
      await expect(inventory(owner)).rejects.toThrow("Session unavailable");
      await expect(publicView(viewer, owner)).rejects.toThrow("User not found");
    });
  },
);
