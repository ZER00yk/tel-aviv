import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, getUser } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import { handleClasses } from "../packages/platform/src/classes";
interface Deck {
  id: string;
  version: number;
  data: {
    cards: {
      front: string;
      back: string;
      tags: string[];
      imageResourceId: string | null;
    }[];
  };
}
interface QueuedCard {
  cardKey: string;
  front: string;
  back: string;
  reviewToken: string;
  reviewVersion: number;
}
interface Queue {
  cards: QueuedCard[];
  dueCount: number;
  totalCards: number;
  nextDueAt: string | null;
}
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "private flashcard review transactions",
  () => {
    let owner: User;
    let learner: User;
    let stranger: User;
    let classId: string;
    const call = (
      user: User,
      path: string,
      method = "GET",
      input: Record<string, unknown> = {},
    ) =>
      handleClasses(
        path.split("/"),
        method,
        { user, request: new Request(`http://localhost:3000/api/${path}`) },
        input,
      );
    const queue = (user: User, deck: Deck) =>
      call(user, `classes/resources/${deck.id}/study`) as Promise<Queue>;
    const grade = (
      user: User,
      deck: Deck,
      card: QueuedCard,
      rating = "good",
      extra: Record<string, unknown> = {},
    ) =>
      call(user, `classes/resources/${deck.id}/study/review`, "POST", {
        cardKey: card.cardKey,
        reviewToken: card.reviewToken,
        reviewVersion: card.reviewVersion,
        rating,
        ...extra,
      });
    const makeDeck = async (shared = false, parentId?: string) => {
      const deck = (await call(owner, `classes/${classId}/resources`, "POST", {
        kind: "flashcards",
        title: "Study fixture",
        parentId: parentId ?? null,
        data: {
          cards: [
            { front: "A", back: "Alpha" },
            { front: "B", back: "Beta" },
          ],
        },
      })) as Deck;
      if (shared)
        await call(owner, `classes/resources/${deck.id}/share`, "POST", {
          username: learner.username,
          permission: "view",
        });
      return deck;
    };
    beforeAll(async () => {
      const suffix = randomUUID().slice(0, 8);
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      await db`insert into users(id,username,display_name) values(${ids[0]},${`srowner_${suffix}`},'Review owner'),(${ids[1]},${`srlearn_${suffix}`},'Review learner'),(${ids[2]},${`srother_${suffix}`},'Review stranger')`;
      owner = (await getUser(ids[0]))!;
      learner = (await getUser(ids[1]))!;
      stranger = (await getUser(ids[2]))!;
      classId = (
        (await call(owner, "classes", "POST", {
          name: "Review test fixture",
        })) as { id: string }
      ).id;
    });
    afterAll(async () => {
      if (classId) await db`delete from school_classes where id=${classId}`;
      if (owner && learner && stranger)
        await db`delete from users where id in (${owner.id},${learner.id},${stranger.id})`;
    });
    it("requires resource view access for both queue and grade, including folder grants", async () => {
      const deck = await makeDeck();
      const ownerQueue = await queue(owner, deck);
      await expect(queue(learner, deck)).rejects.toMatchObject({ status: 404 });
      await expect(
        grade(learner, deck, ownerQueue.cards[0]),
      ).rejects.toMatchObject({ status: 404 });
      const folder = (await call(
        owner,
        `classes/${classId}/resources`,
        "POST",
        { kind: "folder", title: "Shared study folder" },
      )) as { id: string };
      const contained = await makeDeck(false, folder.id);
      await call(owner, `classes/resources/${folder.id}/share`, "POST", {
        username: learner.username,
        permission: "view",
      });
      expect((await queue(learner, contained)).dueCount).toBe(2);
      await expect(queue(stranger, contained)).rejects.toMatchObject({
        status: 404,
      });
    });
    it("keeps schedules and tokens separate for learners and rejects injected progress", async () => {
      const deck = await makeDeck(true);
      const a = await queue(owner, deck),
        b = await queue(learner, deck);
      expect(a.cards[0].reviewToken).not.toBe(b.cards[0].reviewToken);
      await expect(grade(learner, deck, a.cards[0])).rejects.toMatchObject({
        status: 409,
      });
      await expect(
        grade(learner, deck, b.cards[0], "good", {
          dueAt: "2099-01-01T00:00:00Z",
          reviewCount: 999,
          userId: owner.id,
        }),
      ).rejects.toMatchObject({ status: 400 });
      await grade(owner, deck, a.cards[0], "easy");
      expect((await queue(owner, deck)).dueCount).toBe(1);
      expect((await queue(learner, deck)).dueCount).toBe(2);
      expect(
        (await queue(learner, deck)).cards.every(
          (card) => !("user_id" in card) && !("ownerProgress" in card),
        ),
      ).toBe(true);
      const [ownReview] =
        await db`select review_count from flashcard_progress where resource_id=${deck.id} and user_id=${owner.id} and card_key=${a.cards[0].cardKey}`;
      expect(ownReview.review_count).toBe(1);
      const otherReviews =
        await db`select review_count from flashcard_progress where resource_id=${deck.id} and user_id=${learner.id}`;
      expect(otherReviews.every((row) => row.review_count === 0)).toBe(true);
    });
    it("commits exactly one review when the same queue token is graded concurrently", async () => {
      const deck = await makeDeck();
      const card = (await queue(owner, deck)).cards[0];
      const outcomes = await Promise.allSettled([
        grade(owner, deck, card),
        grade(owner, deck, card, "easy"),
      ]);
      expect(
        outcomes.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = outcomes.find(
        (result) => result.status === "rejected",
      ) as PromiseRejectedResult;
      expect(rejected.reason.status).toBe(409);
      const [progress] =
        await db`select review_count,review_version,review_nonce,last_review_at from flashcard_progress where resource_id=${deck.id} and user_id=${owner.id} and card_key=${card.cardKey}`;
      expect(progress).toMatchObject({
        review_count: 1,
        review_version: 1,
        review_nonce: null,
      });
      expect(progress.last_review_at).toBeTruthy();
      await expect(grade(owner, deck, card)).rejects.toMatchObject({
        status: 409,
      });
    });
    it("renews expired tokens and disallows grading a card before its due time", async () => {
      const deck = await makeDeck();
      const old = (await queue(owner, deck)).cards[0];
      await db`update flashcard_progress set nonce_expires_at=now()-interval '1 minute' where resource_id=${deck.id} and user_id=${owner.id} and card_key=${old.cardKey}`;
      await expect(grade(owner, deck, old)).rejects.toMatchObject({
        status: 409,
      });
      const fresh = (await queue(owner, deck)).cards.find(
        (card) => card.cardKey === old.cardKey,
      )!;
      expect(fresh.reviewToken).not.toBe(old.reviewToken);
      await db`update flashcard_progress set due_at=now()+interval '1 day' where resource_id=${deck.id} and user_id=${owner.id} and card_key=${fresh.cardKey}`;
      await expect(grade(owner, deck, fresh)).rejects.toMatchObject({
        status: 409,
      });
    });
    it("preserves reordered and unchanged content while replacing edited card schedules", async () => {
      let deck = await makeDeck();
      const initial = await queue(owner, deck),
        cardA = initial.cards.find((card) => card.front === "A")!,
        cardB = initial.cards.find((card) => card.front === "B")!;
      await grade(owner, deck, cardA, "easy");
      deck = (await call(owner, `classes/resources/${deck.id}`, "PATCH", {
        expectedVersion: deck.version,
        data: { cards: [deck.data.cards[1], deck.data.cards[0]] },
      })) as Deck;
      let current = await queue(owner, deck);
      expect(current.dueCount).toBe(1);
      expect(current.cards[0].cardKey).toBe(cardB.cardKey);
      const [preserved] =
        await db`select review_count from flashcard_progress where resource_id=${deck.id} and user_id=${owner.id} and card_key=${cardA.cardKey}`;
      expect(preserved.review_count).toBe(1);
      deck = (await call(owner, `classes/resources/${deck.id}`, "PATCH", {
        expectedVersion: deck.version,
        data: {
          cards: [
            { ...deck.data.cards[0], front: "B revised" },
            deck.data.cards[1],
          ],
        },
      })) as Deck;
      current = await queue(owner, deck);
      expect(current.dueCount).toBe(1);
      expect(current.cards[0].cardKey).not.toBe(cardB.cardKey);
      expect(
        await db`select card_key from flashcard_progress where resource_id=${deck.id} and user_id=${owner.id}`,
      ).toHaveLength(2);
      await expect(grade(owner, deck, cardB)).rejects.toMatchObject({
        status: 409,
      });
    });
    it("rechecks revoked sharing before any learner queue or grade is accepted", async () => {
      const deck = await makeDeck(true);
      const card = (await queue(learner, deck)).cards[0];
      await call(
        owner,
        `classes/resources/${deck.id}/share/${learner.id}`,
        "DELETE",
      );
      await expect(queue(learner, deck)).rejects.toMatchObject({ status: 404 });
      await expect(grade(learner, deck, card)).rejects.toMatchObject({
        status: 404,
      });
      const [progress] =
        await db`select review_count from flashcard_progress where resource_id=${deck.id} and user_id=${learner.id} and card_key=${card.cardKey}`;
      expect(progress.review_count).toBe(0);
    });
  },
);
