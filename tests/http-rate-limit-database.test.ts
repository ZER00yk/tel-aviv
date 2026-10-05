import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { db } from "@tell-aviv/database";
import {
  authenticatedRequestBucket,
  consumeRateLimit,
  enforceAuthenticatedRequestRate,
} from "../packages/platform/src/rateLimit";

describe("authenticated HTTP bucket selection", () => {
  const bucket = (path: string, method = "GET", input = {}, q = "") =>
    authenticatedRequestBucket(
      path.split("/"),
      method,
      `http://localhost:3000/api/${path}${q}`,
      input,
    );
  it("limits publication, discovery, market mutations and expensive cross-service searches explicitly", () => {
    expect(bucket("creations/author-level/publish", "POST")).toMatchObject({
      max: 20,
      seconds: 60,
    });
    expect(bucket("creations")).toMatchObject({ max: 60, seconds: 60 });
    expect(
      bucket("games/casino/action", "POST", {
        action: "marketplace.offer.create",
      }),
    ).toMatchObject({ max: 20 });
    expect(
      bucket("games/casino/action", "POST", { action: "marketplace.list" }),
    ).toMatchObject({ max: 30 });
    for (const action of [
      "marketplace.buy",
      "marketplace.cancel",
      "marketplace.offer.accept",
      "marketplace.offer.reject",
      "marketplace.offer.cancel",
      "collect.transfer",
    ])
      expect(bucket("games/casino/action", "POST", { action })).toMatchObject({
        max: 120,
      });
    for (const path of [
      "users",
      "servers/discover",
      "chat/room/messages",
      "chat/room/threads/thread",
    ])
      expect(bucket(path, "GET", {}, "?q=hello")).toMatchObject({
        bucket: "http:search",
        max: 60,
      });
  });
  it("leaves real-time ranked inputs, level inputs, normal chat polling, house casino and existing GIF limits alone", () => {
    for (const [path, method, input] of [
      ["games/ego-trip/ego-ranked", "POST", { action: "input" }],
      ["creations/level/attempts/id/input", "POST", {}],
      ["games/casino/action", "POST", { action: "poker.deal" }],
      ["chat/room/messages", "GET", {}],
      ["chat/gifs", "GET", {}],
      ["users/id", "GET", {}],
    ] as const)
      expect(bucket(path, method, input)).toBeUndefined();
  });
});

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "durable concurrent HTTP rates",
  () => {
    let id: string;
    beforeEach(async () => {
      id = randomUUID();
      await db`INSERT INTO users(id,username,display_name) VALUES(${id},${`http_rate_${id.slice(0, 8)}`},'HTTP rate test')`;
    });
    afterEach(async () => {
      await db`DELETE FROM users WHERE id=${id}`;
    });
    it("admits exactly the concurrent boundary, saturates the counter and preserves its original expiration", async () => {
      const outcomes = await Promise.allSettled(
        Array.from({ length: 40 }, () =>
          consumeRateLimit(id, "http:concurrent_test", 7, 60),
        ),
      );
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(7);
      expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(33);
      for (const r of outcomes)
        if (r.status === "rejected")
          expect(r.reason).toMatchObject({ status: 429 });
      const [before] =
        await db`SELECT count,window_start FROM social_rate_windows WHERE user_id=${id}`;
      expect(before.count).toBe(7);
      await expect(
        consumeRateLimit(id, "http:concurrent_test", 7, 60),
      ).rejects.toMatchObject({ status: 429 });
      expect(
        (
          await db`SELECT count,window_start FROM social_rate_windows WHERE user_id=${id}`
        )[0],
      ).toEqual(before);
      await db`UPDATE social_rate_windows SET window_start=clock_timestamp()-interval '61 seconds' WHERE user_id=${id}`;
      await consumeRateLimit(id, "http:concurrent_test", 7, 60);
      expect(
        (await db`SELECT count FROM social_rate_windows WHERE user_id=${id}`)[0]
          .count,
      ).toBe(1);
    });
    it("shares one search budget across endpoints while separating mutation and user budgets", async () => {
      const requests = Array.from({ length: 65 }, (_, i) =>
        enforceAuthenticatedRequestRate(
          id,
          i % 2 ? ["users"] : ["servers", "discover"],
          "GET",
          "http://localhost:3000/api/users?q=test",
        ),
      );
      const results = await Promise.allSettled(requests);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(60);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(5);
      await enforceAuthenticatedRequestRate(
        id,
        ["games", "casino", "action"],
        "POST",
        "http://localhost/api/games/casino/action",
        { action: "marketplace.list" },
      );
      expect(
        await db`SELECT count FROM social_rate_windows WHERE user_id=${id} AND bucket='http:market_list'`,
      ).toEqual([{ count: 1 }]);
      const other = randomUUID();
      await db`INSERT INTO users(id,username,display_name) VALUES(${other},${`http_rate_${other.slice(0, 8)}`},'Other HTTP user')`;
      try {
        await enforceAuthenticatedRequestRate(
          other,
          ["users"],
          "GET",
          "http://localhost/api/users?q=test",
        );
      } finally {
        await db`DELETE FROM users WHERE id=${other}`;
      }
    });
    it("keeps request accounting committed when later application work rolls back", async () => {
      await expect(
        (async () => {
          await enforceAuthenticatedRequestRate(
            id,
            ["creations", "id", "publish"],
            "POST",
            "http://localhost/api/creations/id/publish",
          );
          await db.begin(async (sql) => {
            await sql`UPDATE users SET display_name='Should roll back' WHERE id=${id}`;
            throw new Error("later validation failed");
          });
        })(),
      ).rejects.toThrow("later validation failed");
      expect(
        await db`SELECT count FROM social_rate_windows WHERE user_id=${id} AND bucket='http:creator_publish'`,
      ).toEqual([{ count: 1 }]);
      expect(
        (await db`SELECT display_name FROM users WHERE id=${id}`)[0]
          .display_name,
      ).toBe("HTTP rate test");
    });
  },
);
