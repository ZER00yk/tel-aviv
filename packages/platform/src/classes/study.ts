import { createHash } from "node:crypto";
import { db } from "@tell-aviv/database";
import { ApiError } from "@tell-aviv/shared";
import type { Sql } from "postgres";
import { z } from "zod";
import { flashcardDeckSchema } from "./flashcards";

export const reviewRating = z.enum(["again", "hard", "good", "easy"]);
export type ReviewRating = z.infer<typeof reviewRating>;
export interface ScheduleState {
  intervalSeconds: number;
  streak: number;
  reviewCount: number;
}
const DAY_SECONDS = 24 * 60 * 60;
/** A deliberately small scheduling heuristic with bounded intervals, not an SM-2 claim. */
export function scheduleReview(
  previous: ScheduleState,
  rating: ReviewRating,
  now = new Date(),
) {
  let intervalSeconds: number;
  if (rating === "again") intervalSeconds = 60;
  else if (rating === "hard")
    intervalSeconds = Math.max(600, Math.round(previous.intervalSeconds * 1.2));
  else if (rating === "easy")
    intervalSeconds = Math.max(
      4 * DAY_SECONDS,
      Math.round(previous.intervalSeconds * 3),
    );
  else
    intervalSeconds =
      previous.streak === 0
        ? DAY_SECONDS
        : previous.streak === 1
          ? Math.max(
              3 * DAY_SECONDS,
              Math.round(previous.intervalSeconds * 2.2),
            )
          : Math.max(DAY_SECONDS, Math.round(previous.intervalSeconds * 2.2));
  intervalSeconds = Math.min(365 * DAY_SECONDS, intervalSeconds);
  return {
    intervalSeconds,
    streak: rating === "again" ? 0 : previous.streak + 1,
    reviewCount: previous.reviewCount + 1,
    dueAt: new Date(now.getTime() + intervalSeconds * 1000).toISOString(),
  };
}
export function studyCards(data: unknown) {
  const result = flashcardDeckSchema.safeParse(data);
  if (!result.success) throw new ApiError(400, "Invalid flashcard deck");
  const occurrences = new Map<string, number>();
  return result.data.cards.map((card, index) => {
    // Tags do not change what is being learned. Text or illustration changes start a new card.
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([card.front, card.back, card.imageResourceId]))
      .digest("hex");
    const occurrence = occurrences.get(fingerprint) ?? 0;
    occurrences.set(fingerprint, occurrence + 1);
    const cardKey = createHash("sha256")
      .update(`${fingerprint}:${occurrence}`)
      .digest("hex");
    return { ...card, cardKey, index };
  });
}
type StudyResource = {
  id: string;
  class_id: string;
  kind: string;
  data: Record<string, unknown>;
};
type Authorizer = (
  resourceId: string,
  userId: string,
) => Promise<StudyResource>;
type ProgressRow = {
  card_key: string;
  due_at: Date | string;
  interval_seconds: number;
  streak: number;
  review_count: number;
  review_version: number;
  review_nonce: string | null;
  nonce_expires_at: Date | string | null;
};
async function queueSummary(tx: Sql, resourceId: string, userId: string) {
  const [summary] =
    await tx`select count(*)::int as total_cards,count(*) filter(where due_at<=now())::int as due_count,min(due_at) filter(where due_at>now()) as next_due_at from flashcard_progress where resource_id=${resourceId} and user_id=${userId}`;
  return {
    totalCards: summary.total_cards as number,
    dueCount: summary.due_count as number,
    nextDueAt: summary.next_due_at as Date | string | null,
  };
}
async function synchronizeCards(
  tx: Sql,
  resource: StudyResource,
  userId: string,
) {
  if (resource.kind !== "flashcards")
    throw new ApiError(400, "This resource is not a flashcard deck");
  const cards = studyCards(resource.data);
  if (!cards.length) {
    await tx`delete from flashcard_progress where resource_id=${resource.id} and user_id=${userId}`;
    return cards;
  }
  const keys = cards.map((card) => card.cardKey);
  await tx`delete from flashcard_progress where resource_id=${resource.id} and user_id=${userId} and card_key not in ${tx(keys)}`;
  const rows = cards.map((card) => ({
    resource_id: resource.id,
    user_id: userId,
    card_key: card.cardKey,
  }));
  await tx`insert into flashcard_progress ${tx(rows, "resource_id", "user_id", "card_key")} on conflict do nothing`;
  return cards;
}
const gradeInput = z
  .object({
    cardKey: z.string().regex(/^[0-9a-f]{64}$/),
    reviewToken: z.string().uuid(),
    reviewVersion: z.number().int().nonnegative(),
    rating: reviewRating,
  })
  .strict();
export async function handleFlashcardStudy(
  resource: StudyResource,
  userId: string,
  method: string,
  suffix: string | undefined,
  input: Record<string, unknown>,
  authorize: Authorizer,
  searchParams = new URLSearchParams(),
) {
  if (method === "GET" && ["history", "stats"].includes(suffix ?? "")) {
    return db.begin(async (sql) => {
      const [cls] =
        await sql`select id from school_classes where id=${resource.class_id} for update`;
      if (!cls) throw new ApiError(404, "Resource not found");
      const current = await authorize(resource.id, userId);
      const tx = sql as unknown as Sql;
      const cards = await synchronizeCards(tx, current, userId);
      if (suffix === "stats") {
        const [reviews] =
          await sql`select count(*)::int as total_reviews,count(*) filter(where rating in ('good','easy'))::int as successful_reviews,count(*) filter(where rating='again')::int as again_reviews,count(*) filter(where created_at>=now()-interval '7 days')::int as last_week_reviews from school_flashcard_reviews where resource_id=${resource.id} and user_id=${userId}`;
        const [progress] =
          await sql`select count(*) filter(where review_count>0)::int as studied_cards,count(*) filter(where interval_seconds>=604800 and streak>=3)::int as mastered_cards from flashcard_progress where resource_id=${resource.id} and user_id=${userId}`;
        const perCard =
          await sql`select p.card_key,p.due_at,p.interval_seconds,p.streak,p.review_count,p.last_review_at,count(r.id) filter(where r.rating in ('good','easy'))::int as successes from flashcard_progress p left join school_flashcard_reviews r on r.resource_id=p.resource_id and r.user_id=p.user_id and r.card_key=p.card_key where p.resource_id=${resource.id} and p.user_id=${userId} group by p.resource_id,p.user_id,p.card_key order by p.card_key`;
        return {
          ...(await queueSummary(tx, resource.id, userId)),
          ...reviews,
          ...progress,
          cards: perCard.map((row) => ({
            ...row,
            front:
              cards.find((card) => card.cardKey === row.card_key)?.front ?? "",
          })),
          successRate: reviews.total_reviews
            ? Math.round(
                (100 * reviews.successful_reviews) / reviews.total_reviews,
              )
            : null,
        };
      }
      const cardKey = searchParams.get("cardKey");
      if (cardKey && !/^[0-9a-f]{64}$/.test(cardKey))
        throw new ApiError(400, "Invalid card key");
      const before = searchParams.get("before");
      if (
        before &&
        !z.string().datetime({ offset: true }).safeParse(before).success
      )
        throw new ApiError(400, "Invalid history cursor");
      const beforeId = searchParams.get("beforeId");
      if (beforeId && !z.string().uuid().safeParse(beforeId).success)
        throw new ApiError(400, "Invalid history cursor");
      if (beforeId && !before)
        throw new ApiError(400, "History cursor needs a timestamp");
      return sql`select id,card_key,rating,front,back,interval_seconds,due_at,created_at from school_flashcard_reviews where resource_id=${resource.id} and user_id=${userId} and (${cardKey === null} or card_key=${cardKey ?? ""}) and (${before === null} or (created_at,id)<(${before ?? new Date().toISOString()}::timestamptz,${beforeId ?? "00000000-0000-0000-0000-000000000000"}::uuid)) order by created_at desc,id desc limit 50`;
    });
  }
  if (
    (method === "GET" && suffix !== undefined) ||
    (method !== "GET" && !(method === "POST" && suffix === "review"))
  )
    return undefined;
  const grade = method === "POST" ? gradeInput.safeParse(input) : null;
  if (grade && !grade.success)
    throw new ApiError(400, grade.error.issues[0]?.message ?? "Invalid review");
  return db.begin(async (sql) => {
    // Same lock order as edits, trash, restore and deletion; recheck grants after acquiring it.
    const [cls] =
      await sql`select id from school_classes where id=${resource.class_id} for update`;
    if (!cls) throw new ApiError(404, "Resource not found");
    const current = await authorize(resource.id, userId);
    const tx = sql as unknown as Sql;
    const cards = await synchronizeCards(tx, current, userId);
    if (method === "GET") {
      const due =
        await sql`select card_key from flashcard_progress where resource_id=${resource.id} and user_id=${userId} and due_at<=now() order by due_at,card_key limit 20`;
      if (!due.length)
        return { cards: [], ...(await queueSummary(tx, resource.id, userId)) };
      const rows =
        await sql`update flashcard_progress set review_nonce=case when review_nonce is not null and nonce_expires_at>now() then review_nonce else gen_random_uuid() end,nonce_expires_at=case when review_nonce is not null and nonce_expires_at>now() then nonce_expires_at else now()+interval '30 minutes' end where resource_id=${resource.id} and user_id=${userId} and card_key in ${sql(due.map((row) => row.card_key))} returning *`;
      const progress = new Map(
        (rows as unknown as ProgressRow[]).map((row) => [row.card_key, row]),
      );
      return {
        cards: due.map((row) => {
          const card = cards.find((item) => item.cardKey === row.card_key)!;
          const state = progress.get(card.cardKey)!;
          return {
            ...card,
            reviewToken: state.review_nonce,
            reviewVersion: state.review_version,
            reviewCount: state.review_count,
            dueAt: state.due_at,
          };
        }),
        ...(await queueSummary(tx, resource.id, userId)),
      };
    }
    if (!grade?.success) throw new ApiError(400, "Invalid review");
    const submitted = grade.data;
    if (!cards.some((card) => card.cardKey === submitted.cardKey))
      throw new ApiError(409, "This card changed. Refresh your study queue.");
    const [row] =
      await sql`select *,clock_timestamp() as server_now from flashcard_progress where resource_id=${resource.id} and user_id=${userId} and card_key=${submitted.cardKey} for update`;
    const now = row ? new Date(row.server_now) : new Date();
    if (
      !row ||
      row.review_nonce !== submitted.reviewToken ||
      row.review_version !== submitted.reviewVersion ||
      !row.nonce_expires_at ||
      new Date(row.nonce_expires_at).getTime() <= now.getTime() ||
      new Date(row.due_at).getTime() > now.getTime()
    )
      throw new ApiError(
        409,
        "This review was already saved or expired. Refresh your study queue.",
      );
    const next = scheduleReview(
      {
        intervalSeconds: row.interval_seconds,
        streak: row.streak,
        reviewCount: row.review_count,
      },
      submitted.rating,
      now,
    );
    const [updated] =
      await sql`update flashcard_progress set due_at=${next.dueAt},interval_seconds=${next.intervalSeconds},streak=${next.streak},review_count=${next.reviewCount},review_version=review_version+1,review_nonce=null,nonce_expires_at=null,last_review_at=${now.toISOString()} where resource_id=${resource.id} and user_id=${userId} and card_key=${submitted.cardKey} returning review_version`;
    const reviewedCard = cards.find(
      (card) => card.cardKey === submitted.cardKey,
    )!;
    await sql`insert into school_flashcard_reviews(resource_id,user_id,card_key,rating,front,back,interval_seconds,review_version,due_at,created_at) values(${resource.id},${userId},${submitted.cardKey},${submitted.rating},${reviewedCard.front},${reviewedCard.back},${next.intervalSeconds},${updated.review_version},${next.dueAt},${now.toISOString()})`;
    return {
      cardKey: submitted.cardKey,
      rating: submitted.rating,
      ...next,
      reviewVersion: updated.review_version,
      ...(await queueSummary(tx, resource.id, userId)),
    };
  });
}
