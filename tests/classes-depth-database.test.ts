import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db, getUser } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import { handleClasses } from "../packages/platform/src/classes";
import { generateSchoolReminders } from "../packages/platform/src/classes/reminders";
interface Resource {
  id: string;
  version: number;
  data: Record<string, unknown>;
}
interface Queued {
  cards: {
    cardKey: string;
    index: number;
    reviewToken: string;
    reviewVersion: number;
  }[];
}
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "Classes depth with isolated private database fixtures",
  () => {
    let owner: User, learner: User, stranger: User, classId: string;
    const call = (
      user: User,
      path: string,
      method = "GET",
      input: Record<string, unknown> = {},
    ) =>
      handleClasses(
        path.split("?")[0].split("/"),
        method,
        { user, request: new Request(`http://localhost:3000/api/${path}`) },
        input,
      );
    const create = (kind: string, data: Record<string, unknown>) =>
      call(owner, `classes/${classId}/resources`, "POST", {
        kind,
        title: `Depth ${kind}`,
        data,
      }) as Promise<Resource>;
    const share = (resource: Resource, permission = "view") =>
      call(owner, `classes/resources/${resource.id}/share`, "POST", {
        username: learner.username,
        permission,
      });
    beforeAll(async () => {
      const suffix = randomUUID().slice(0, 8);
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      await db`insert into users(id,username,display_name) values(${ids[0]},${`dpowner_${suffix}`},'Depth owner'),(${ids[1]},${`dplearn_${suffix}`},'Depth learner'),(${ids[2]},${`dpother_${suffix}`},'Depth other')`;
      owner = (await getUser(ids[0]))!;
      learner = (await getUser(ids[1]))!;
      stranger = (await getUser(ids[2]))!;
      classId = (
        (await call(owner, "classes", "POST", { name: "Depth fixture" })) as {
          id: string;
        }
      ).id;
    });
    afterAll(async () => {
      if (classId) await db`delete from school_classes where id=${classId}`;
      if (owner && learner && stranger)
        await db`delete from users where id in (${owner.id},${learner.id},${stranger.id})`;
    });
    it("records exactly one private chronological review event and exposes own per-card stats only", async () => {
      const deck = await create("flashcards", {
        cards: [
          { front: "Alpha", back: "A" },
          { front: "Beta", back: "B" },
        ],
      });
      await share(deck);
      const queue = (await call(
        learner,
        `classes/resources/${deck.id}/study`,
      )) as Queued;
      const card = queue.cards[0];
      const input = {
        cardKey: card.cardKey,
        reviewToken: card.reviewToken,
        reviewVersion: card.reviewVersion,
        rating: "good",
      };
      const outcomes = await Promise.allSettled([
        call(
          learner,
          `classes/resources/${deck.id}/study/review`,
          "POST",
          input,
        ),
        call(
          learner,
          `classes/resources/${deck.id}/study/review`,
          "POST",
          input,
        ),
      ]);
      expect(
        outcomes.filter((item) => item.status === "fulfilled"),
      ).toHaveLength(1);
      const history = (await call(
        learner,
        `classes/resources/${deck.id}/study/history`,
      )) as { card_key: string; rating: string }[];
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        card_key: card.cardKey,
        rating: "good",
      });
      expect(
        await call(learner, `classes/resources/${deck.id}/study/stats`),
      ).toMatchObject({
        total_reviews: 1,
        successful_reviews: 1,
        successRate: 100,
        dueCount: 1,
      });
      expect(
        await call(owner, `classes/resources/${deck.id}/study/history`),
      ).toEqual([]);
      await expect(
        call(stranger, `classes/resources/${deck.id}/study/history`),
      ).rejects.toMatchObject({ status: 404 });
      await call(
        owner,
        `classes/resources/${deck.id}/share/${learner.id}`,
        "DELETE",
      );
      await expect(
        call(learner, `classes/resources/${deck.id}/study/stats`),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("preserves learning events when a card is edited and resets only its schedule", async () => {
      let deck = await create("flashcards", {
        cards: [{ front: "Original question", back: "Original answer" }],
      });
      const queue = (await call(
        owner,
        `classes/resources/${deck.id}/study`,
      )) as Queued;
      const card = queue.cards[0];
      await call(owner, `classes/resources/${deck.id}/study/review`, "POST", {
        cardKey: card.cardKey,
        reviewToken: card.reviewToken,
        reviewVersion: card.reviewVersion,
        rating: "easy",
      });
      deck = (await call(owner, `classes/resources/${deck.id}`, "PATCH", {
        expectedVersion: deck.version,
        data: {
          cards: [{ front: "Edited question", back: "Original answer" }],
        },
      })) as Resource;
      const next = (await call(
        owner,
        `classes/resources/${deck.id}/study`,
      )) as Queued;
      expect(next.cards[0].cardKey).not.toBe(card.cardKey);
      expect(
        (await call(
          owner,
          `classes/resources/${deck.id}/study/history`,
        )) as unknown[],
      ).toHaveLength(1);
      expect(
        await call(owner, `classes/resources/${deck.id}/study/stats`),
      ).toMatchObject({ total_reviews: 1, studied_cards: 0 });
    });
    it("paginates equal-timestamp review events without dropping or repeating per-card history", async () => {
      const deck = await create("flashcards", {
        cards: [{ front: "Cursor question", back: "Cursor answer" }],
      });
      const queue = (await call(
        owner,
        `classes/resources/${deck.id}/study`,
      )) as Queued;
      const stamp = new Date().toISOString(),
        cardKey = queue.cards[0].cardKey;
      const rows = Array.from({ length: 55 }, (_, index) => ({
        resource_id: deck.id,
        user_id: owner.id,
        card_key: cardKey,
        rating: "good",
        front: "Cursor question",
        back: "Cursor answer",
        interval_seconds: 86400,
        review_version: index + 1,
        due_at: stamp,
        created_at: stamp,
      }));
      await db`insert into school_flashcard_reviews ${db(rows, "resource_id", "user_id", "card_key", "rating", "front", "back", "interval_seconds", "review_version", "due_at", "created_at")}`;
      const first = (await call(
        owner,
        `classes/resources/${deck.id}/study/history?cardKey=${cardKey}`,
      )) as { id: string; created_at: string }[];
      expect(first).toHaveLength(50);
      const last = first.at(-1)!;
      const params = new URLSearchParams({
        cardKey,
        before: new Date(last.created_at).toISOString(),
        beforeId: last.id,
      });
      const second = (await call(
        owner,
        `classes/resources/${deck.id}/study/history?${params}`,
      )) as { id: string }[];
      expect(second).toHaveLength(5);
      expect(new Set([...first, ...second].map((row) => row.id)).size).toBe(55);
    });
    it("stores immutable answer breakdowns, hides keys before submission and restricts owner analytics to aggregate counts", async () => {
      const quiz = await create("quiz", {
        questions: [
          {
            prompt: "Prime?",
            type: "multi-select",
            options: ["2", "3", "4"],
            answer: ["2", "3"],
          },
          { prompt: "Sun?", type: "true-false", answer: "true" },
        ],
        randomOrder: false,
      });
      await share(quiz);
      const view = (await call(
        learner,
        `classes/resources/${quiz.id}`,
      )) as Resource;
      expect(JSON.stringify(view.data)).not.toContain('"answer"');
      const result = (await call(
        learner,
        `classes/resources/${quiz.id}/attempt`,
        "POST",
        { answers: [["3", "2"], "false"] },
      )) as { score: number; total: number };
      expect(result).toMatchObject({ score: 1, total: 2 });
      const own = (await call(
        learner,
        `classes/resources/${quiz.id}/attempts`,
      )) as { breakdown: { correct: boolean }[] }[];
      expect(own).toHaveLength(1);
      expect(own[0].breakdown.map((item) => item.correct)).toEqual([
        true,
        false,
      ]);
      expect(
        await call(owner, `classes/resources/${quiz.id}/attempts`),
      ).toEqual([]);
      const analytics = (await call(
        owner,
        `classes/resources/${quiz.id}/analytics`,
      )) as {
        attempts: number;
        learners: number;
        questions: { correct: number }[];
      };
      expect(analytics).toMatchObject({ attempts: 1, learners: 1 });
      expect(analytics.questions.map((item) => item.correct)).toEqual([1, 0]);
      expect(JSON.stringify(analytics)).not.toContain(learner.id);
      await expect(
        call(learner, `classes/resources/${quiz.id}/analytics`),
      ).rejects.toMatchObject({ status: 403 });
      await call(owner, `classes/resources/${quiz.id}`, "PATCH", {
        expectedVersion: quiz.version,
        data: {
          questions: [{ prompt: "New", type: "short-answer", answer: "New" }],
        },
      });
      const preserved = (await call(
        learner,
        `classes/resources/${quiz.id}/attempts`,
      )) as { breakdown: { prompt: string }[] }[];
      expect(preserved[0].breakdown[0].prompt).toBe("Prime?");
    });
    it("tracks assignment completion history while keeping the planner private", async () => {
      let assignment = await create("assignment", {
        description: "Lab",
        priority: "high",
        status: "not-started",
        dueDate: new Date(Date.now() + 86400000).toISOString(),
      });
      assignment = (await call(
        owner,
        `classes/resources/${assignment.id}`,
        "PATCH",
        {
          expectedVersion: assignment.version,
          data: {
            ...assignment.data,
            status: "done",
            notes: "Finished the experiment",
          },
        },
      )) as Resource;
      const history = (await call(
        owner,
        `classes/resources/${assignment.id}/history`,
      )) as { status: string }[];
      expect(history.map((item) => item.status)).toEqual([
        "done",
        "not-started",
      ]);
      await expect(
        call(learner, `classes/resources/${assignment.id}/history`),
      ).rejects.toMatchObject({ status: 404 });
      const board = (await call(owner, "classes/assignments")) as {
        assignments: Resource[];
      };
      expect(board.assignments.some((row) => row.id === assignment.id)).toBe(
        true,
      );
      const other = (await call(learner, "classes/assignments")) as {
        assignments: Resource[];
      };
      expect(other.assignments).toEqual([]);
    });
    it("delivers assignment/review reminders once even under concurrent requests and respects completion, trash, revocation and opt-out", async () => {
      const assignment = await create("assignment", {
        dueDate: new Date(Date.now() + 60000).toISOString(),
        status: "not-started",
      });
      await Promise.all([
        generateSchoolReminders(owner.id),
        generateSchoolReminders(owner.id),
      ]);
      expect(
        await db`select notification_id from school_reminder_deliveries where user_id=${owner.id} and resource_id=${assignment.id}`,
      ).toHaveLength(1);
      const deck = await create("flashcards", {
        cards: [{ front: "Reminder card", back: "Answer" }],
      });
      await share(deck);
      await call(learner, `classes/resources/${deck.id}/study`);
      expect(await generateSchoolReminders(learner.id)).toMatchObject({
        generated: 1,
      });
      expect(await generateSchoolReminders(learner.id)).toMatchObject({
        generated: 0,
      });
      await call(
        owner,
        `classes/resources/${deck.id}/share/${learner.id}`,
        "DELETE",
      );
      await db`delete from school_reminder_deliveries where user_id=${learner.id} and resource_id=${deck.id}`;
      expect(await generateSchoolReminders(learner.id)).toMatchObject({
        generated: 0,
      });
      const complete = await create("assignment", {
        dueDate: new Date(Date.now() - 60000).toISOString(),
        status: "done",
      });
      const trashed = await create("assignment", {
        dueDate: new Date(Date.now() + 60000).toISOString(),
      });
      await call(owner, `classes/resources/${trashed.id}`, "DELETE");
      await generateSchoolReminders(owner.id);
      expect(
        await db`select resource_id from school_reminder_deliveries where resource_id in (${complete.id},${trashed.id})`,
      ).toHaveLength(0);
      await db`update users set settings=${db.json({ notifications: { school: false } })} where id=${owner.id}`;
      const muted = await create("assignment", {
        dueDate: new Date(Date.now() + 60000).toISOString(),
      });
      expect(await generateSchoolReminders(owner.id)).toMatchObject({
        generated: 0,
      });
      expect(
        await db`select resource_id from school_reminder_deliveries where resource_id=${muted.id}`,
      ).toHaveLength(0);
    });
  },
);
