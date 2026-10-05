import { createHash, randomBytes } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import { z } from "zod";
import { db } from "@tell-aviv/database";
import { fail, type ApiContext } from "@tell-aviv/shared";
import {
  bosses,
  weapons,
  mods,
  modLimits,
  type WeaponId,
} from "../../../games/ego-trip/content";
import {
  EGO_RANKED_VERSION,
  actEgoRanked,
  egoUnlocks,
  newEgoRanked,
  rankedStatistics,
  type EgoRankedState,
  type EgoPermanentProgress,
} from "../../../games/server/ego-ranked";
import { GameRuleError } from "../../../games/server/rules";
import { JOURNEY_RULES } from "../../../games/ego-trip/journey";

type Sql = TransactionSql;
interface RankedEconomy {
  ensureAccount(sql: Sql, userId: string, currency: string): Promise<void>;
  changeBalance(
    sql: Sql,
    userId: string,
    currency: string,
    amount: number,
    reason: string,
    reference: string,
  ): Promise<void>;
  unlock(
    sql: Sql,
    userId: string,
    achievementId: string,
    unlocked: string[],
  ): Promise<void>;
  score(
    sql: Sql,
    userId: string,
    gameId: string,
    category: string,
    value: number,
    metadata?: unknown,
  ): Promise<void>;
}
interface RunRow {
  id: string;
  user_id: string;
  seed: string;
  game_version: string;
  mode: string;
  difficulty: "standard" | "volatile";
  modifiers: string[];
  status: string;
  validation_status: string;
  revision: number;
  state: EgoRankedState;
  statistics: Record<string, unknown>;
  started_at: Date;
  updated_at: Date;
  ended_at: Date | null;
  completion_ms: string | null;
  deaths: number;
  final_boss_reached: string | null;
  rewarded_at: Date | null;
}
export interface EgoRankedRunView {
  id: string;
  seed: number;
  gameVersion: string;
  mode: string;
  difficulty: "standard" | "volatile";
  modifiers: string[];
  status: string;
  validationStatus: string;
  revision: number;
  startedAt: string;
  endedAt: string | null;
  completionMs: number | null;
  deaths: number;
  finalBossReached: string | null;
  statistics: Record<string, unknown>;
}
export interface EgoRankedView {
  run:
    | (EgoRankedRunView & {
        world: EgoRankedState["world"];
        simulatedMs: number;
        idleMs: number;
      })
    | null;
  progress: EgoPermanentProgress;
  history: EgoRankedRunView[];
  achievements?: string[];
}
function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    fail(400, result.error.issues[0]?.message ?? "Invalid ranked input");
  return result.data;
}
function currentVersion() {
  return `${EGO_RANKED_VERSION}-${createHash("sha256").update(JSON.stringify({ bosses, weapons, mods, modLimits, journey: JOURNEY_RULES })).digest("hex").slice(0, 12)}`;
}
function summary(run: RunRow): EgoRankedRunView {
  return {
    id: run.id,
    seed: Number(run.seed),
    gameVersion: run.game_version,
    mode: run.mode,
    difficulty: run.difficulty,
    modifiers: run.modifiers,
    status: run.status,
    validationStatus: run.validation_status,
    revision: run.revision,
    startedAt: new Date(run.started_at).toISOString(),
    endedAt: run.ended_at ? new Date(run.ended_at).toISOString() : null,
    completionMs: run.completion_ms === null ? null : Number(run.completion_ms),
    deaths: run.deaths,
    finalBossReached: run.final_boss_reached,
    statistics: run.statistics,
  };
}
async function progress(
  sql: Sql,
  userId: string,
): Promise<EgoPermanentProgress> {
  const [row] =
    await sql`SELECT bosses,completions,runs,insight,discoveries,(SELECT count(*) FROM ego_coop_completion_receipts WHERE user_id=${userId}) AS coop_completions FROM ego_permanent_progress WHERE user_id=${userId}`;
  return egoUnlocks(
    row?.bosses ?? [],
    Number(row?.completions ?? 0),
    Number(row?.runs ?? 0),
    Number(row?.insight ?? 0),
    row?.discoveries ?? [],
    Number(row?.coop_completions ?? 0),
  );
}
async function view(
  sql: Sql,
  userId: string,
  selectedId?: string,
): Promise<EgoRankedView> {
  const history = await sql<
    RunRow[]
  >`SELECT * FROM ego_ranked_runs WHERE user_id=${userId} ORDER BY started_at DESC LIMIT 20`;
  const run = selectedId
    ? history.find((row) => row.id === selectedId)
    : (history.find((row) => row.status === "active") ?? history[0]);
  return {
    run: run
      ? {
          ...summary(run),
          world: run.state.world,
          simulatedMs: Math.round(run.state.simulatedMs),
          idleMs: Math.round(run.state.idleMs),
        }
      : null,
    progress: await progress(sql, userId),
    history: history.map(summary),
  };
}

/** Account export includes owned summaries/progress, never the canonical simulation or held input. */
export async function egoRankedExport(sql: Sql, userId: string) {
  const rows = await sql<
    RunRow[]
  >`SELECT * FROM ego_ranked_runs WHERE user_id=${userId} ORDER BY started_at`;
  const coOpCompletions =
    await sql`SELECT match_id AS "matchId",discoveries,recorded_at AS "recordedAt" FROM ego_coop_completion_receipts WHERE user_id=${userId} ORDER BY recorded_at`;
  return {
    runs: rows.map(summary),
    progress: await progress(sql, userId),
    coOpCompletions,
  };
}

async function awardProgress(
  sql: Sql,
  userId: string,
  run: RunRow,
  economy: RankedEconomy,
  completed: boolean,
) {
  const [old] =
    await sql`SELECT bosses,completions,runs,insight FROM ego_permanent_progress WHERE user_id=${userId} FOR UPDATE`;
  const owned = new Set<string>(old.bosses);
  const defeated = bosses
    .slice(0, run.state.world.kills)
    .map((boss) => boss.name);
  const achievements: string[] = [];
  let added = 0;
  for (const name of defeated) {
    if (!owned.has(name)) {
      owned.add(name);
      added++;
    }
    // A co-op unlock grants the option, not the ranked achievement. The existing
    // unique achievement grant still makes repeated ranked settlement idempotent.
    await economy.unlock(
      sql,
      userId,
      `ego-ranked-${name.toLowerCase()}`,
      achievements,
    );
  }
  if (completed && !run.rewarded_at) {
    await economy.unlock(
      sql,
      userId,
      run.mode === "campaign" ? "ego-ranked-campaign" : "ego-ranked-clear",
      achievements,
    );
    if (run.difficulty === "volatile")
      await economy.unlock(sql, userId, "ego-ranked-volatile", achievements);
    await sql`INSERT INTO cosmetic_inventory(user_id,item_id) VALUES(${userId},'badge-ego-victory') ON CONFLICT DO NOTHING`;
    await economy.ensureAccount(sql, userId, "tell-coins");
    await economy.changeBalance(
      sql,
      userId,
      "tell-coins",
      15,
      "server-simulated Ego Trip completion",
      run.id,
    );
    await sql`UPDATE ego_ranked_runs SET rewarded_at=now() WHERE id=${run.id}`;
  }
  await sql`UPDATE ego_permanent_progress SET bosses=${sql.json([...owned])},completions=completions+${completed && !run.rewarded_at ? 1 : 0},insight=insight+${added * 5 + (completed && !run.rewarded_at ? 10 : 0)},updated_at=now() WHERE user_id=${userId}`;
  return achievements;
}

export async function handleEgoRanked(
  path: string[],
  method: string,
  context: ApiContext,
  input: Record<string, unknown>,
  economy: RankedEconomy,
) {
  if (path[0] !== "games" || path[1] !== "ego-trip" || path[2] !== "ranked")
    return undefined;
  const userId = context.user.id;
  if (method === "GET" && path.length === 3)
    return db.begin((sql) => view(sql, userId));
  if (method !== "POST") return undefined;
  return db.begin(async (sql) => {
    // This locks runs, permanent progress and reward grants in a single stable owner order.
    const [owner] =
      await sql`SELECT id FROM users WHERE id=${userId} AND disabled=false FOR UPDATE`;
    if (!owner) fail(403, "This account cannot control ranked runs");
    await sql`INSERT INTO ego_permanent_progress(user_id) VALUES(${userId}) ON CONFLICT DO NOTHING`;
    const now = Date.now();
    if (path[3] === "start") {
      const options = parse(
        z
          .object({
            mode: z
              .enum(["boss-gauntlet", "campaign"])
              .default("boss-gauntlet"),
            weapon: z.string().min(1).max(30).default("pulse"),
            difficulty: z.enum(["standard", "volatile"]).default("standard"),
            modifiers: z
              .array(z.enum(["fragile", "no-helper"]))
              .max(2)
              .default([]),
            helper: z.enum(["gunner", "medic"]).nullable().default(null),
          })
          .strict(),
        input,
      );
      const [active] =
        await sql`SELECT id FROM ego_ranked_runs WHERE user_id=${userId} AND status='active' FOR UPDATE`;
      if (active) fail(409, "Resume or abandon your active ranked run first");
      const [count] =
        await sql`SELECT count(*)::integer AS count FROM ego_ranked_runs WHERE user_id=${userId} AND started_at>now()-interval '10 minutes'`;
      if (count.count >= 30)
        fail(429, "Too many ranked starts; try again later");
      const unlocks = await progress(sql, userId);
      if (!unlocks.unlockedWeapons.includes(options.weapon))
        fail(403, "This ranked weapon is not unlocked");
      if (
        options.difficulty === "volatile" &&
        !unlocks.challenges.includes("volatile")
      )
        fail(403, "Defeat Austin to unlock volatile ranked runs");
      if (
        options.modifiers.some(
          (modifier) => !unlocks.challenges.includes(modifier),
        )
      )
        fail(403, "Defeat Austin to unlock ranked modifiers");
      if (options.helper && !unlocks.unlockedHelpers.includes(options.helper))
        fail(403, "This ranked helper is not unlocked");
      if (options.helper && options.modifiers.includes("no-helper"))
        fail(400, "No-helper runs cannot start with a helper");
      const modifiers = [...new Set(options.modifiers)].sort();
      const seed = randomBytes(4).readUInt32LE();
      const state = newEgoRanked(
        options.weapon as WeaponId,
        seed,
        now,
        options.difficulty,
        modifiers,
        options.helper,
        options.mode,
      );
      const [run] =
        await sql`INSERT INTO ego_ranked_runs(user_id,seed,game_version,mode,difficulty,modifiers,state,final_boss_reached) VALUES(${userId},${seed},${currentVersion()},${options.mode},${options.difficulty},${sql.json(modifiers)},${sql.json(json(state))},${bosses[0].name}) RETURNING id`;
      await sql`UPDATE ego_permanent_progress SET runs=runs+1,updated_at=now() WHERE user_id=${userId}`;
      return view(sql, userId, run.id);
    }
    const command = parse(
      z
        .object({
          runId: z.string().uuid(),
          expectedRevision: z.number().int().min(0),
          command: z.enum([
            "input",
            "mod",
            "shop",
            "continue",
            "route",
            "event",
            "abandon",
          ]),
          payload: z.record(z.string(), z.unknown()).default({}),
        })
        .strict(),
      input,
    );
    if (path[3] !== "intent") fail(404, "Unknown ranked operation");
    const [run] = await sql<
      RunRow[]
    >`SELECT * FROM ego_ranked_runs WHERE id=${command.runId} AND user_id=${userId} FOR UPDATE`;
    if (!run) fail(404, "Ranked run not found");
    if (run.status !== "active") fail(409, "This ranked run has ended");
    if (run.revision !== command.expectedRevision)
      fail(409, "Ranked revision conflict; refresh this run");
    let status = "active";
    let validationStatus = run.validation_status;
    if (command.command === "abandon") {
      if (Object.keys(command.payload).length)
        fail(400, "Abandon accepts no outcome or score");
      status = "abandoned";
      if (run.game_version !== currentVersion())
        validationStatus = "version-preserved";
    } else {
      if (run.game_version !== currentVersion())
        fail(
          409,
          "This ranked engine version has changed; the run is preserved and may be abandoned",
        );
      if (now - new Date(run.started_at).getTime() > 24 * 3600000)
        status = "expired";
      else {
        if (
          command.command === "input" &&
          now - new Date(run.updated_at).getTime() < 40
        )
          fail(429, "Ranked controls update too quickly");
        try {
          actEgoRanked(run.state, command.command, command.payload, now);
        } catch (error) {
          if (error instanceof GameRuleError) fail(400, error.message);
          throw error;
        }
        if (run.state.world.stage === "won") status = "completed";
        if (run.state.world.stage === "lost") status = "failed";
      }
    }
    if (
      status === "completed" &&
      (run.state.world.kills !== run.state.bossCount ||
        (run.mode === "campaign" &&
          (run.state.world.campaign?.cleared !== 40 ||
            run.state.world.campaign.path.length !== 40)))
    )
      fail(
        409,
        "The full ranked run has not been validated; the run is preserved",
      );
    const statistics = rankedStatistics(run.state);
    const elapsed = Math.max(0, now - new Date(run.started_at).getTime());
    await sql`UPDATE ego_ranked_runs SET state=${sql.json(json(run.state))},statistics=${sql.json(json(statistics))},status=${status},validation_status=${validationStatus},revision=revision+1,updated_at=now(),ended_at=${status === "active" ? null : new Date(now)},completion_ms=${status === "completed" ? elapsed : null},deaths=${statistics.deaths},final_boss_reached=${statistics.finalBossReached} WHERE id=${run.id}`;
    const achievements =
      validationStatus === "server-simulated"
        ? await awardProgress(sql, userId, run, economy, status === "completed")
        : [];
    if (status === "completed") {
      const category =
        run.mode === "campaign"
          ? run.modifiers.length
            ? "campaign-challenge"
            : run.difficulty === "volatile"
              ? "campaign-volatile"
              : "campaign"
          : run.modifiers.length
            ? `${run.difficulty}-${run.modifiers.join("-")}`
            : run.difficulty === "standard"
              ? "default"
              : "volatile";
      await economy.score(
        sql,
        userId,
        "ego-trip",
        category,
        Math.max(0, 1000000000 - elapsed),
        {
          mode: run.mode,
          route: run.state.world.campaign?.path ?? [],
          runId: run.id,
          runStartedAt: new Date(run.started_at).toISOString(),
          completionMs: elapsed,
          seed: Number(run.seed),
          version: run.game_version,
          difficulty: run.difficulty,
          modifiers: run.modifiers,
          validation: validationStatus,
        },
      );
    }
    return { ...(await view(sql, userId, run.id)), achievements };
  });
}
