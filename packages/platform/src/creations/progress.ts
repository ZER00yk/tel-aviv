import { randomBytes } from "node:crypto";
import { db } from "@tell-aviv/database";
import { ApiError } from "@tell-aviv/shared";
import type { JSONValue } from "postgres";
import { z } from "zod";
import {
  normalizeLevel,
  type LevelData,
} from "../../../creator-runtime/src/schema";
import {
  CREATOR_RUNTIME_REVISION,
  INPUT_KEYS,
  initialPlayer,
  stepPlayer,
} from "../../../creator-runtime/src/physics";

const MAX_TICKS = 18_000;
const frameSchema = z
  .object({
    keys: z.array(z.enum(INPUT_KEYS)).max(INPUT_KEYS.length),
    ticks: z.number().int().min(1).max(60),
  })
  .strict();
const inputSchema = z
  .object({
    expectedSequence: z.number().int().nonnegative(),
    frames: z.array(frameSchema).min(1).max(60),
  })
  .strict()
  .refine(
    (input) => input.frames.reduce((sum, frame) => sum + frame.ticks, 0) <= 300,
    "Send at most 300 simulation ticks per request",
  );
type State = ReturnType<typeof initialPlayer>;
type Attempt = {
  id: string;
  user_id: string;
  creation_id: string;
  creation_version: number;
  runtime_revision: string;
  seed: string | number;
  level: LevelData;
  state: State;
  next_sequence: number;
  simulated_ticks: number;
  status: string;
  started_at: Date | string;
};
function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}
function view(
  attempt: Attempt,
  completionRecorded = false,
  includeLevel = false,
) {
  return {
    id: attempt.id,
    attemptId: attempt.id,
    seed: Number(attempt.seed),
    creationVersion: attempt.creation_version,
    runtimeRevision: attempt.runtime_revision,
    nextSequence: attempt.next_sequence,
    simulatedTicks: attempt.simulated_ticks,
    maxTicks: MAX_TICKS,
    status: attempt.status,
    state: attempt.state,
    completionRecorded,
    ...(includeLevel ? { level: attempt.level } : {}),
  };
}

/** Only inputs are accepted. Every position, event and win is re-simulated here. */
export async function handleCreatorAttempt(
  creationId: string,
  userId: string,
  method: string,
  attemptId: string | undefined,
  suffix: string | undefined,
  input: Record<string, unknown>,
) {
  if (!attemptId && method === "POST") {
    z.object({}).strict().parse(input);
    return db.begin(async (tx) => {
      await tx`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
      const [creation] =
        await tx`SELECT id,version,level FROM creations WHERE id=${creationId} AND published=true FOR SHARE`;
      if (!creation) throw new ApiError(404, "Published level not found");
      const [rate] =
        await tx`SELECT count(*)::int AS count FROM creator_play_attempts WHERE user_id=${userId} AND started_at>clock_timestamp()-interval '1 hour'`;
      if (rate.count >= 30)
        throw new ApiError(
          429,
          "Try another level later; too many starts in one hour",
        );
      await tx`UPDATE creator_play_attempts SET status='expired' WHERE user_id=${userId} AND status='playing'`;
      const seed = randomBytes(4).readUInt32LE();
      const level = { ...normalizeLevel(creation.level as LevelData), seed };
      const state = initialPlayer(level);
      const [attempt] = await tx<
        Attempt[]
      >`INSERT INTO creator_play_attempts(creation_id,user_id,creation_version,seed,level,state,runtime_revision) VALUES(${creationId},${userId},${creation.version},${seed},${tx.json(json(level))},${tx.json(json(state))},${CREATOR_RUNTIME_REVISION}) RETURNING *`;
      return view(attempt, false, true);
    });
  }
  if (!attemptId) return undefined;
  const parsedId = z.string().uuid().parse(attemptId);
  if (method === "GET" && !suffix) {
    const [attempt] = await db<
      Attempt[]
    >`SELECT a.* FROM creator_play_attempts a JOIN creations c ON c.id=a.creation_id WHERE a.id=${parsedId} AND a.creation_id=${creationId} AND a.user_id=${userId} AND c.published=true`;
    if (!attempt) throw new ApiError(404, "Attempt not found");
    return view(attempt, false, true);
  }
  if (method !== "POST" || suffix !== "input") return undefined;
  const submitted = inputSchema.parse(input);
  return db.begin(async (tx) => {
    const [available] =
      await tx`SELECT id FROM creations WHERE id=${creationId} AND published=true FOR SHARE`;
    if (!available) throw new ApiError(404, "Published level not found");
    const [attempt] = await tx<
      Attempt[]
    >`SELECT * FROM creator_play_attempts WHERE id=${parsedId} AND creation_id=${creationId} AND user_id=${userId} FOR UPDATE`;
    if (!attempt) throw new ApiError(404, "Attempt not found");
    if (attempt.status !== "playing") return view(attempt);
    if (attempt.next_sequence !== submitted.expectedSequence)
      throw new ApiError(
        409,
        "This attempt advanced. Recover it before sending more inputs.",
      );
    const ageMs = Date.now() - new Date(attempt.started_at).getTime();
    if (ageMs > 20 * 60_000)
      throw new ApiError(409, "This attempt expired. Start again.");
    const ticks = submitted.frames.reduce((sum, frame) => sum + frame.ticks, 0);
    if (attempt.simulated_ticks + ticks > MAX_TICKS)
      throw new ApiError(
        400,
        "This level attempt reached its five-minute simulation limit",
      );
    if (
      attempt.simulated_ticks + ticks >
      Math.max(0, Math.floor(ageMs * 0.06)) + 30
    )
      throw new ApiError(
        409,
        "Inputs are ahead of elapsed server time. Retry shortly.",
      );
    const level = normalizeLevel(attempt.level);
    let state = attempt.state;
    let advanced = 0;
    simulation: for (const frame of submitted.frames) {
      const keys = new Set(frame.keys);
      for (let tick = 0; tick < frame.ticks; tick++) {
        state = stepPlayer(level, state, keys, 1 / 60);
        advanced++;
        if (
          state.won ||
          ("failed" in state && state.failed) ||
          ("logicHalted" in state && state.logicHalted)
        )
          break simulation;
      }
    }
    const failed =
      ("failed" in state && Boolean(state.failed)) ||
      ("logicHalted" in state && Boolean(state.logicHalted));
    const status = failed ? "failed" : state.won ? "completed" : "playing";
    const completedTicks = attempt.simulated_ticks + advanced;
    let completionRecorded = false;
    if (status === "completed") {
      const added =
        await tx`INSERT INTO creator_completions(creation_id,user_id,creation_version,attempt_id,ticks,deaths) VALUES(${creationId},${userId},${attempt.creation_version},${attempt.id},${completedTicks},${state.deaths}) ON CONFLICT DO NOTHING RETURNING id`;
      completionRecorded = added.length > 0;
    }
    const [updated] = await tx<
      Attempt[]
    >`UPDATE creator_play_attempts SET state=${tx.json(json(state))},simulated_ticks=${completedTicks},next_sequence=next_sequence+1,status=${status},updated_at=clock_timestamp(),validated_at=CASE WHEN ${status}='completed' THEN clock_timestamp() ELSE NULL END WHERE id=${attempt.id} RETURNING *`;
    return view(updated, completionRecorded);
  });
}
