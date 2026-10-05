import { describe, expect, it } from "vitest";
import {
  scheduleReview,
  studyCards,
} from "../packages/platform/src/classes/study";
const empty = { intervalSeconds: 0, streak: 0, reviewCount: 0 };
describe("content identities and bounded review schedules", () => {
  it("preserves reordered cards and tag edits, resets text edits and distinguishes duplicates", () => {
    const original = studyCards({
      cards: [
        { front: "A", back: "Alpha" },
        { front: "B", back: "Beta" },
        { front: "A", back: "Alpha" },
      ],
    });
    const reordered = studyCards({
      cards: [
        { front: "B", back: "Beta", tags: ["new"] },
        { front: "A", back: "Alpha" },
        { front: "A", back: "Alpha" },
      ],
    });
    expect(reordered.map((card) => card.cardKey)).toEqual([
      original[1].cardKey,
      original[0].cardKey,
      original[2].cardKey,
    ]);
    expect(new Set(original.map((card) => card.cardKey)).size).toBe(3);
    expect(
      studyCards({ cards: [{ front: "A changed", back: "Alpha" }] })[0].cardKey,
    ).not.toBe(original[0].cardKey);
  });
  it("uses server intervals for every rating and caps long-term intervals", () => {
    const now = new Date("2030-10-01T00:00:00Z");
    expect(scheduleReview(empty, "again", now)).toMatchObject({
      intervalSeconds: 60,
      streak: 0,
      reviewCount: 1,
      dueAt: "2030-10-01T00:01:00.000Z",
    });
    expect(scheduleReview(empty, "hard", now).intervalSeconds).toBe(600);
    expect(scheduleReview(empty, "good", now).intervalSeconds).toBe(86400);
    expect(scheduleReview(empty, "easy", now).intervalSeconds).toBe(345600);
    expect(
      scheduleReview(
        { intervalSeconds: 31536000, streak: 30, reviewCount: 40 },
        "easy",
        now,
      ).intervalSeconds,
    ).toBe(31536000);
    expect(
      scheduleReview(
        { intervalSeconds: 345600, streak: 1, reviewCount: 1 },
        "good",
        now,
      ).intervalSeconds,
    ).toBeGreaterThan(345600);
  });
});
