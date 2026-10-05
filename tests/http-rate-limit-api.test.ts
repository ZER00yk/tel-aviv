import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@tell-aviv/database";
import { hashToken } from "@tell-aviv/auth";
import { GET, POST } from "../apps/web/app/api/[...path]/route";
import { starterLevel } from "../packages/creator-runtime/src/schema";

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "authenticated rate integration through the actual API route",
  () => {
    let userId: string;
    let token: string;
    const origin = new URL(process.env.APP_URL ?? "http://localhost:3000")
      .origin;
    const request = (
      path: string,
      method = "GET",
      payload?: Record<string, unknown>,
      signedIn = true,
    ) => {
      const req = new Request(`${origin}/api/${path}`, {
        method,
        headers: {
          origin,
          ...(signedIn ? { cookie: `ta_session=${token}` } : {}),
          ...(payload ? { "content-type": "application/json" } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      return (method === "GET" ? GET : POST)(req, {
        params: Promise.resolve({ path: path.split("?")[0].split("/") }),
      });
    };
    beforeEach(async () => {
      userId = randomUUID();
      token = randomBytes(32).toString("base64url");
      await db`INSERT INTO users(id,username,display_name) VALUES(${userId},${`route_rate_${userId.slice(0, 8)}`},'Route rate fixture')`;
      await db`INSERT INTO sessions(id,token_hash,user_id,expires_at) VALUES(${randomUUID()},${hashToken(token)},${userId},now()+interval '1 hour')`;
    });
    afterEach(async () => {
      await db`DELETE FROM users WHERE id=${userId}`;
    });
    it("returns one success and one structured 429 at concurrent discovery's exact boundary", async () => {
      await db`INSERT INTO social_rate_windows(user_id,bucket,window_start,count) VALUES(${userId},'http:creator_discovery',clock_timestamp(),59)`;
      const responses = await Promise.all([
        request("creations"),
        request("creations"),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 429]);
      const rejected = responses.find((r) => r.status === 429)!;
      expect(await rejected.json()).toMatchObject({
        code: "rate_limited",
        correlationId: expect.any(String),
      });
      expect(rejected.headers.get("cache-control")).toBe("no-store");
      expect(
        (
          await db`SELECT count FROM social_rate_windows WHERE user_id=${userId}`
        )[0].count,
      ).toBe(60);
    });
    it("limits actual publish requests and counts invalid marketplace attempts despite action rollback", async () => {
      const created = await request("creations", "POST", {
        title: "Route publication fixture",
        level: starterLevel(),
      });
      expect(created.status).toBe(200);
      const { data: creation } = await created.json();
      await db`INSERT INTO social_rate_windows(user_id,bucket,window_start,count) VALUES(${userId},'http:creator_publish',clock_timestamp(),19)`;
      const published = await Promise.all([
        request(`creations/${creation.id}/publish`, "POST", {
          published: true,
        }),
        request(`creations/${creation.id}/publish`, "POST", {
          published: true,
        }),
      ]);
      expect(published.map((r) => r.status).sort()).toEqual([200, 429]);
      const invalid = await request("games/casino/action", "POST", {
        action: "marketplace.list",
        payload: { copyId: "invalid", price: 100 },
      });
      expect(invalid.status).toBe(400);
      expect(
        await db`SELECT count FROM social_rate_windows WHERE user_id=${userId} AND bucket='http:market_list'`,
      ).toEqual([{ count: 1 }]);
      expect(
        await db`SELECT id FROM casino_marketplace WHERE seller_id=${userId}`,
      ).toHaveLength(0);
    });
    it("rejects unsigned requests before budgets and leaves ordinary game-view requests unthrottled", async () => {
      expect((await request("creations", "GET", undefined, false)).status).toBe(
        401,
      );
      expect(
        await db`SELECT count FROM social_rate_windows WHERE user_id=${userId}`,
      ).toHaveLength(0);
      await db`INSERT INTO social_rate_windows(user_id,bucket,window_start,count) VALUES(${userId},'http:search',clock_timestamp(),60)`;
      expect((await request("users?q=fixture")).status).toBe(429);
      expect((await request("games/casino")).status).toBe(200);
    });
  },
);
