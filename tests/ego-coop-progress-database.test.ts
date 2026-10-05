import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import { createCoopState, type CoopState } from "../games/ego-trip/coop-engine";
import { campaignRoom } from "../games/ego-trip/coop-campaign";
import { bosses } from "../games/ego-trip/content";
import { settleEgoCoopProgress } from "../packages/platform/src/egoCoop";
import { egoRankedExport } from "../packages/platform/src/egoRanked";
import { handleGames } from "../packages/platform/src/games";
import type { EgoRankedState } from "../games/server/ego-ranked";
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "Ego canonical co-op permanent options",
  () => {
    let ids: string[] = [],
      matches: string[] = [];
    beforeEach(async () => {
      ids = [randomUUID(), randomUUID(), randomUUID()];
      for (const id of ids)
        await db`INSERT INTO users(id,username,display_name) VALUES(${id},${`ec_${id.slice(0, 12)}`},'Co-op fixture')`;
    });
    afterEach(async () => {
      await db`DELETE FROM multiplayer_matches WHERE id IN ${db(matches.length ? matches : [randomUUID()])}`;
      await db`DELETE FROM users WHERE id IN ${db(ids)}`;
      ids = [];
      matches = [];
    });
    function win(): CoopState {
      // Server checkpoint fixture; the public co-op protocol never accepts this data.
      const s = createCoopState(ids, 1000, "campaign", 81, "legacy");
      s.stage = "won";
      s.campaign!.room = campaignRoom(81, 39);
      s.campaign!.clearedRooms = 40;
      s.campaign!.checkpointRoom = 40;
      s.campaign!.secrets = ["restored-relay", "pilgrims-refuge"];
      s.bossIndex = 7;
      s.boss.hp = 0;
      s.result = {
        winners: ids.slice(),
        scores: Object.fromEntries(ids.map((id) => [id, 100])),
        reason: "All eight districts restored together",
      };
      return s;
    }
    async function record(s: CoopState) {
      const id = randomUUID();
      matches.push(id);
      await db`INSERT INTO multiplayer_matches(id,game_id,lobby_code,started_at,result) VALUES(${id},'ego-trip','EGOTEST',now(),${db.json(s.result!)})`;
      return id;
    }
    it("serializes repeated party settlement, filters disabled/departed owners and grants no economic or ranked rewards", async () => {
      const s = win();
      s.players[ids[2]].departed = true;
      s.result!.winners.pop();
      await db`UPDATE users SET disabled=true WHERE id=${ids[1]}`;
      const match = await record(s);
      await Promise.all([
        db.begin((sql) => settleEgoCoopProgress(sql, match, s)),
        db.begin((sql) => settleEgoCoopProgress(sql, match, s)),
      ]);
      const receipts =
        await db`SELECT user_id FROM ego_coop_completion_receipts WHERE match_id=${match}`;
      expect(receipts.map((row) => row.user_id)).toEqual([ids[0]]);
      const exported = await db.begin((sql) => egoRankedExport(sql, ids[0]));
      expect(exported.progress).toMatchObject({
        completions: 0,
        coopCompletions: 1,
        insight: 50,
        discoveries: ["restored-relay", "pilgrims-refuge"],
      });
      expect(exported.progress.unlockedWeapons).toContain("prism");
      expect(exported.progress.unlockedHelpers).toEqual(["gunner", "medic"]);
      expect(exported.coOpCompletions).toHaveLength(1);
      expect(exported.coOpCompletions[0]).not.toHaveProperty("state");
      expect(
        await db`SELECT 1 FROM currency_ledger WHERE user_id IN ${db(ids)}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT 1 FROM leaderboard_entries WHERE user_id IN ${db(ids)}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT 1 FROM user_achievements WHERE user_id IN ${db(ids)}`,
      ).toHaveLength(0);
      // A genuinely different completion receives its own bounded ten insight, but
      // already discovered bosses/secret options do not grant another discovery bonus.
      const second = await record(s);
      await db.begin((sql) => settleEgoCoopProgress(sql, second, s));
      const [progress] =
        await db`SELECT insight FROM ego_permanent_progress WHERE user_id=${ids[0]}`;
      expect(progress.insight).toBe(60);
      await db`DELETE FROM users WHERE id=${ids[0]}`;
      expect(
        await db`SELECT 1 FROM ego_coop_completion_receipts WHERE user_id=${ids[0]}`,
      ).toHaveLength(0);
    });
    it("rejects incomplete, losing, gauntlet, mismatched-match and departed-winner checkpoints", async () => {
      const variants = [win(), win(), win(), win(), win()];
      variants[0].campaign!.clearedRooms = 39;
      variants[1].stage = "lost";
      variants[2].mode = "gauntlet";
      variants[3].players[ids[0]].departed = true;
      variants[4].campaign!.checkpointRoom = 35;
      for (const s of variants) {
        const match = await record(s);
        await db.begin((sql) => settleEgoCoopProgress(sql, match, s));
      }
      const s = win(),
        match = await record(s);
      await db`UPDATE multiplayer_matches SET game_id='reaction' WHERE id=${match}`;
      await db.begin((sql) => settleEgoCoopProgress(sql, match, s));
      expect(
        await db`SELECT 1 FROM ego_coop_completion_receipts WHERE user_id IN ${db(ids)}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT 1 FROM ego_permanent_progress WHERE user_id IN ${db(ids)}`,
      ).toHaveLength(0);
    });
    it("keeps co-op unlocked options separate from ranked achievement eligibility", async () => {
      const s = win(),
        match = await record(s);
      await db.begin((sql) => settleEgoCoopProgress(sql, match, s));
      const user = (await getUser(ids[0]))!,
        context = {
          user,
          request: new Request("http://localhost/api/games/ego-trip/ranked"),
        };
      const start = (await handleGames(
        ["games", "ego-trip", "ranked", "start"],
        "POST",
        context,
        { weapon: "prism", helper: "medic" },
      )) as { run: { id: string } };
      const [row] =
        await db`SELECT state FROM ego_ranked_runs WHERE id=${start.run.id}`;
      const state = row.state as EgoRankedState;
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
      await db`UPDATE ego_ranked_runs SET state=${db.json(JSON.parse(JSON.stringify(state)))},updated_at=now()-interval '1 second' WHERE id=${start.run.id}`;
      const result = (await handleGames(
        ["games", "ego-trip", "ranked", "intent"],
        "POST",
        context,
        {
          runId: start.run.id,
          expectedRevision: 0,
          command: "input",
          payload: {
            x: 0,
            y: 0,
            aimX: 450,
            aimY: 170,
            attack: false,
            alternate: false,
            dash: false,
          },
        },
      )) as { achievements: string[] };
      expect(result.achievements).toContain(
        `ego-ranked-${bosses[0].name.toLowerCase()}`,
      );
      const [progress] =
        await db`SELECT insight FROM ego_permanent_progress WHERE user_id=${ids[0]}`;
      expect(progress.insight).toBe(50);
    });
  },
);
