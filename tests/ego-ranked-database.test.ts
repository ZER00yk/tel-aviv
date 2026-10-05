import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import { handleGames } from "../packages/platform/src/games";
import { handleInventory } from "../packages/platform/src/inventory";
import {
  egoRankedExport,
  type EgoRankedView,
} from "../packages/platform/src/egoRanked";
import { bosses } from "../games/ego-trip/content";
import { newCampaignWorld } from "../games/ego-trip/engine";
import type { EgoRankedState } from "../games/server/ego-ranked";
const neutral = {
  x: 0,
  y: 0,
  aimX: 450,
  aimY: 170,
  attack: false,
  alternate: false,
  dash: false,
};
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "Ego ranked owner isolation and settlement",
  () => {
    const owned: User[] = [];
    const context = (user: User) => ({
      user,
      request: new Request("http://localhost:3000/api/games/ego-trip/ranked"),
    });
    const get = (user = owned[0]) =>
      handleGames(
        ["games", "ego-trip", "ranked"],
        "GET",
        context(user),
        {},
      ) as Promise<EgoRankedView>;
    const start = (input: Record<string, unknown> = {}, user = owned[0]) =>
      handleGames(
        ["games", "ego-trip", "ranked", "start"],
        "POST",
        context(user),
        input,
      ) as Promise<EgoRankedView>;
    const intent = (
      runId: string,
      expectedRevision: number,
      command = "input",
      payload: Record<string, unknown> = neutral,
      user = owned[0],
    ) =>
      handleGames(
        ["games", "ego-trip", "ranked", "intent"],
        "POST",
        context(user),
        { runId, expectedRevision, command, payload },
      ) as Promise<EgoRankedView>;
    beforeEach(async () => {
      for (let index = 0; index < 2; index++) {
        const id = randomUUID();
        await db`INSERT INTO users(id,username,display_name) VALUES(${id},${`er_${id.slice(0, 12)}`},'Ranked fixture')`;
        owned.push((await getUser(id))!);
      }
    });
    afterEach(async () => {
      for (const user of owned) await db`DELETE FROM users WHERE id=${user.id}`;
      owned.length = 0;
    });
    const prepareKill = async (runId: string, final = false) => {
      const [run] =
        await db`SELECT state FROM ego_ranked_runs WHERE id=${runId} AND user_id=${owned[0].id}`;
      const state = run.state as EgoRankedState;
      // Owned canonical fixture: the API still must simulate the final hit and settle atomically.
      if (final) {
        state.world.bossIndex = bosses.length - 1;
        state.world.kills = bosses.length - 1;
      }
      state.world.boss.hp = 1;
      state.world.bullets = [
        {
          x: state.world.boss.x,
          y: state.world.boss.y,
          vx: 0,
          vy: 0,
          life: 1,
          damage: 9,
          radius: 5,
          enemy: false,
          explosive: false,
        },
      ];
      state.lastServerTick = Date.now() - 100;
      await db`UPDATE ego_ranked_runs SET state=${db.json(JSON.parse(JSON.stringify(state)))},updated_at=now()-interval '1 second' WHERE id=${runId} AND user_id=${owned[0].id}`;
    };
    it("rejects browser seed/outcome and locked options, and keeps casual saves separate", async () => {
      await expect(start({ seed: 42 })).rejects.toThrow();
      await expect(start({ weapon: "comet" })).rejects.toThrow("unlocked");
      await expect(start({ difficulty: "volatile" })).rejects.toThrow("Austin");
      await handleGames(
        ["games", "ego-trip", "save"],
        "POST",
        context(owned[0]),
        {
          data: {
            won: true,
            insight: 1e6,
            bosses: bosses.map((boss) => boss.name),
          },
          schemaVersion: 1,
        },
      );
      const ranked = await start();
      expect(ranked.progress.bosses).toEqual([]);
      expect(ranked.progress.insight).toBe(0);
      expect(ranked.run?.world.kills).toBe(0);
      expect(ranked.run?.validationStatus).toBe("server-simulated");
      await expect(start()).rejects.toThrow("active");
    });
    it("protects run ownership and rejects replayed/concurrent revisions", async () => {
      const initial = await start();
      const run = initial.run!;
      await expect(intent(run.id, 0, "abandon", {}, owned[1])).rejects.toThrow(
        "not found",
      );
      await db`UPDATE ego_ranked_runs SET updated_at=now()-interval '1 second' WHERE id=${run.id}`;
      const results = await Promise.allSettled([
        intent(run.id, 0),
        intent(run.id, 0),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      expect((await get()).run?.revision).toBe(1);
      await expect(intent(run.id, 0)).rejects.toThrow("conflict");
      expect((await get(owned[1])).run).toBeNull();
    });
    it("rechecks disabled/deleted owners under the first lock without reviving runs or granting rewards", async () => {
      const initial = await start();
      await db`UPDATE users SET disabled=true WHERE id=${owned[0].id}`;
      await expect(intent(initial.run!.id, 0)).rejects.toThrow(
        "cannot control",
      );
      expect((await get()).run!.revision).toBe(0);
      await db`UPDATE users SET disabled=false WHERE id=${owned[0].id}`;
      const results = await Promise.allSettled([
        intent(initial.run!.id, 0),
        db.begin(async (sql) => {
          await sql`SELECT id FROM users WHERE id=${owned[0].id} FOR UPDATE`;
          await sql`DELETE FROM users WHERE id=${owned[0].id}`;
        }),
      ]);
      expect(results[1].status).toBe("fulfilled");
      expect(
        await db`SELECT 1 FROM ego_ranked_runs WHERE user_id=${owned[0].id}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT 1 FROM ego_permanent_progress WHERE user_id=${owned[0].id}`,
      ).toHaveLength(0);
      await expect(start()).rejects.toThrow("cannot control");
      expect(
        await db`SELECT 1 FROM currency_ledger WHERE user_id=${owned[0].id}`,
      ).toHaveLength(0);
    });
    it("derives boss achievements once from server combat and persists actual unlocks", async () => {
      const initial = await start();
      const run = initial.run!;
      await prepareKill(run.id);
      const killed = await intent(run.id, 0);
      expect(killed.run?.world.kills).toBe(1);
      expect(killed.progress.bosses).toEqual(["Rowan"]);
      expect(killed.progress.unlockedWeapons).toContain("comet");
      expect(killed.progress.unlockedHelpers).toContain("gunner");
      expect(killed.achievements).toContain("ego-ranked-rowan");
      await intent(run.id, killed.run!.revision, "abandon", {});
      const second = await start({ weapon: "comet", helper: "gunner" });
      await prepareKill(second.run!.id);
      const again = await intent(second.run!.id, 0);
      expect(again.progress.insight).toBe(5);
      expect(again.achievements).toEqual([]);
      const ledger =
        await db`SELECT amount FROM currency_ledger WHERE user_id=${owned[0].id} AND reference_id='ego-ranked-rowan'`;
      expect(ledger).toHaveLength(1);
      expect(Number(ledger[0].amount)).toBe(20);
    });
    it("settles completions once, keeps ledger conservation, and earns an equipable badge", async () => {
      const initial = await start();
      const run = initial.run!;
      await expect(
        handleGames(["economy", "purchase"], "POST", context(owned[0]), {
          itemId: "badge-ego-victory",
        }),
      ).rejects.toThrow("not found");
      await prepareKill(run.id, true);
      const completed = await intent(run.id, 0);
      expect(completed.run?.status).toBe("completed");
      expect(completed.run?.completionMs).toBeGreaterThanOrEqual(0);
      expect(completed.progress.completions).toBe(1);
      expect(completed.run?.statistics.bossesDefeated).toBe(bosses.length);
      await expect(intent(run.id, completed.run!.revision)).rejects.toThrow(
        "ended",
      );
      const rewards =
        await db`SELECT amount FROM currency_ledger WHERE user_id=${owned[0].id} AND reference_id=${run.id}`;
      expect(rewards).toHaveLength(1);
      expect(Number(rewards[0].amount)).toBe(15);
      const [account] =
        await db`SELECT balance FROM currency_accounts WHERE user_id=${owned[0].id} AND currency='tell-coins'`;
      const [total] =
        await db`SELECT sum(amount)::bigint AS amount FROM currency_ledger WHERE user_id=${owned[0].id} AND currency='tell-coins'`;
      expect(Number(account.balance)).toBe(Number(total.amount));
      await handleInventory(["inventory", "equip"], "POST", context(owned[0]), {
        slot: "badge",
        itemId: "badge-ego-victory",
      });
      const publicProfile = (await handleInventory(
        ["inventory", "profile", owned[0].id],
        "GET",
        context(owned[1]),
        {},
      )) as { equipment: { badge: { id: string } } };
      expect(publicProfile.equipment.badge.id).toBe("badge-ego-victory");
      const leaderboard = (await handleGames(
        ["games", "ego-trip", "leaderboard"],
        "GET",
        context(owned[0]),
        {},
      )) as {
        ranked: boolean;
        entries: { userId: string; metadata: { runId: string } }[];
      };
      expect(leaderboard.ranked).toBe(true);
      expect(
        leaderboard.entries.find((entry) => entry.userId === owned[0].id)
          ?.metadata.runId,
      ).toBe(run.id);
      const exported = await db.begin((sql) =>
        egoRankedExport(sql, owned[0].id),
      );
      expect(exported.runs).toHaveLength(1);
      expect(exported.runs[0]).not.toHaveProperty("world");
      expect(exported.runs[0]).not.toHaveProperty("state");
    });
    it("preserves incompatible engine versions and allows deliberate abandonment without grants", async () => {
      const initial = await start();
      const run = initial.run!;
      await db`UPDATE ego_ranked_runs SET game_version='future-version',updated_at=now()-interval '1 second' WHERE id=${run.id}`;
      await expect(intent(run.id, 0)).rejects.toThrow("version");
      const abandoned = await intent(run.id, 0, "abandon", {});
      expect(abandoned.run?.validationStatus).toBe("version-preserved");
      expect(abandoned.progress.insight).toBe(0);
      expect(abandoned.achievements).toEqual([]);
      expect(
        await db`SELECT 1 FROM currency_ledger WHERE user_id=${owned[0].id}`,
      ).toHaveLength(0);
    });
    it("persists every restored compact ranked campaign route and settles only the full canonical forty-room completion", async () => {
      let result = await start({ mode: "campaign" });
      const runId = result.run!.id;
      expect(result.run!.mode).toBe("campaign");
      expect(result.run!.world.campaign!.pacingVersion).toBe(1);
      const [checkpoint] =
        await db`SELECT state FROM ego_ranked_runs WHERE id=${runId} AND user_id=${owned[0].id}`;
      const restored = checkpoint.state as EgoRankedState;
      // Restore a compact legacy checkpoint for this settlement-only fixture.
      // Public start still opts into paced missions; no browser accepts world data.
      restored.world = newCampaignWorld(
        restored.world.weapon,
        restored.world.seed,
        {
          difficulty: restored.difficulty,
          pacingVersion: null,
        },
      );
      await db`UPDATE ego_ranked_runs SET state=${db.json(JSON.parse(JSON.stringify(restored)))} WHERE id=${runId} AND user_id=${owned[0].id}`;
      result = await get();
      for (
        let safety = 0;
        safety < 250 && result.run!.status === "active";
        safety++
      ) {
        const run = result.run!,
          stage = run.world.stage;
        if (stage === "fight") {
          const [stored] =
            await db`SELECT state FROM ego_ranked_runs WHERE id=${runId}`;
          const state = stored.state as EgoRankedState;
          // Owned server fixture shortens targets; the API must perform every
          // validated transition, offer, grant, and final settlement itself.
          state.world.boss.hp = 0;
          for (const enemy of state.world.enemies) {
            enemy.hp = 0;
            enemy.spawned = true;
          }
          if (state.world.campaign!.objective)
            state.world.campaign!.objective!.progress =
              state.world.campaign!.objective!.target;
          state.lastServerTick = Date.now() - 100;
          await db`UPDATE ego_ranked_runs SET state=${db.json(JSON.parse(JSON.stringify(state)))},updated_at=now()-interval '1 second' WHERE id=${runId}`;
          result = await intent(runId, run.revision);
        } else if (stage === "choice")
          result = await intent(runId, run.revision, "mod", {
            id: run.world.offered[0],
          });
        else if (stage === "route")
          result = await intent(runId, run.revision, "route", {
            id: run.world.campaign!.routes[0].id,
          });
        else if (stage === "shop")
          result = await intent(runId, run.revision, "continue", {});
        else if (stage === "event")
          result = await intent(runId, run.revision, "event", {
            choice: "safe",
          });
        else throw new Error(`Unexpected active stage ${stage}`);
      }
      expect(result.run!.status).toBe("completed");
      expect(result.run!.statistics).toMatchObject({
        mode: "campaign",
        roomsCleared: 40,
        bossesDefeated: 8,
      });
      expect(result.run!.world.campaign!.path).toHaveLength(40);
      expect(result.achievements).toContain("ego-ranked-campaign");
      const entries =
        await db`SELECT category,metadata FROM leaderboard_entries WHERE user_id=${owned[0].id} AND game_id='ego-trip'`;
      expect(entries.length).toBeGreaterThan(0);
      expect(
        entries.every(
          (entry) =>
            entry.category === "campaign" && entry.metadata.runId === runId,
        ),
      ).toBe(true);
      expect(
        await db`SELECT 1 FROM currency_ledger WHERE user_id=${owned[0].id} AND reference_id=${runId}`,
      ).toHaveLength(1);
      await expect(
        intent(runId, result.run!.revision, "route", { id: "0:battle:0" }),
      ).rejects.toThrow("ended");
    });
  },
);
