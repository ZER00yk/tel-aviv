import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import { handleClasses } from "../packages/platform/src/classes";
import {
  starterLevel,
  type LevelData,
} from "../packages/creator-runtime/src/schema";

type Creation = { id: string; version: number; plays: number };
type Attempt = {
  attemptId: string;
  status: string;
  nextSequence: number;
  simulatedTicks: number;
  state: { won: boolean };
  completionRecorded: boolean;
};
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "Creator verified inputs and discovery",
  () => {
    let owner: User, player: User, outsider: User;
    const ids: string[] = [];
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
    async function create(
      level = starterLevel(),
      published = true,
      category = "platformer",
    ) {
      const creation = (await call(owner, "creations", "POST", {
        title: `Verified ${randomUUID()}`,
        description: "Server checked level",
        tags: ["logic"],
        category,
        level,
      })) as Creation;
      if (published)
        await call(owner, `creations/${creation.id}/publish`, "POST", {
          published,
        });
      return creation;
    }
    const start = async (creation: Creation, user = player) =>
      (await call(
        user,
        `creations/${creation.id}/attempts`,
        "POST",
      )) as Attempt;
    const input = async (
      creation: Creation,
      attempt: Attempt,
      ticks = 1,
      user = player,
    ) =>
      (await call(
        user,
        `creations/${creation.id}/attempts/${attempt.attemptId}/input`,
        "POST",
        {
          expectedSequence: attempt.nextSequence,
          frames: [{ keys: [], ticks }],
        },
      )) as Attempt;
    beforeAll(async () => {
      const users: User[] = [];
      for (const name of ["author", "player", "other"]) {
        const id = randomUUID();
        ids.push(id);
        await db`INSERT INTO users(id,username,display_name) VALUES(${id},${`cr_${name}_${id.slice(0, 8)}`},${name})`;
        users.push((await getUser(id))!);
      }
      [owner, player, outsider] = users;
    });
    afterAll(async () => {
      if (ids.length) await db`DELETE FROM users WHERE id=ANY(${ids}::uuid[])`;
    });
    it("accepts inputs only, replays the canonical physics and records each version once", async () => {
      const level: LevelData = { ...starterLevel(), spawn: { x: 880, y: 450 } };
      const creation = await create(level);
      const attempt = await start(creation);
      await expect(
        call(
          player,
          `creations/${creation.id}/attempts/${attempt.attemptId}/input`,
          "POST",
          {
            expectedSequence: 0,
            frames: [{ keys: [], ticks: 1 }],
            state: { won: true },
            score: 1000,
          },
        ),
      ).rejects.toThrow();
      expect(
        (
          await db`SELECT count(*)::int AS n FROM creator_completions WHERE creation_id=${creation.id}`
        )[0].n,
      ).toBe(0);
      const completed = await input(creation, attempt);
      expect(completed).toMatchObject({
        status: "completed",
        completionRecorded: true,
        simulatedTicks: 1,
        state: { won: true },
      });
      expect((await input(creation, attempt)).status).toBe("completed");
      expect(
        (await input(creation, await start(creation))).completionRecorded,
      ).toBe(false);
      expect(
        (
          await db`SELECT count(*)::int AS n FROM creator_completions WHERE creation_id=${creation.id}`
        )[0].n,
      ).toBe(1);
      const updated = (await call(owner, `creations/${creation.id}`, "PATCH", {
        title: "Updated finish",
        description: "",
        tags: [],
        level,
        expectedVersion: 1,
      })) as Creation;
      expect(
        (await input(updated, await start(updated))).completionRecorded,
      ).toBe(true);
    });
    it("checks ownership, publication, stale sequences, elapsed time and atomic competing inputs", async () => {
      const creation = await create();
      const attempt = await start(creation);
      await expect(input(creation, attempt, 1, outsider)).rejects.toMatchObject(
        { status: 404 },
      );
      await expect(input(creation, attempt, 60)).rejects.toMatchObject({
        status: 409,
      });
      const outcomes = await Promise.allSettled([
        input(creation, attempt),
        input(creation, attempt),
      ]);
      expect(
        outcomes.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        outcomes.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      await expect(input(creation, attempt)).rejects.toMatchObject({
        status: 409,
      });
      await call(owner, `creations/${creation.id}/publish`, "POST", {
        published: false,
      });
      await expect(
        call(player, `creations/${creation.id}/attempts/${attempt.attemptId}`),
      ).rejects.toMatchObject({ status: 404 });
      await expect(start(creation, owner)).rejects.toMatchObject({
        status: 400,
      });
    });
    it("keeps private levels out of discovery and deduplicates visits and favorites", async () => {
      const published = await create(starterLevel(), true, "puzzle");
      const privateLevel = await create(starterLevel(), false, "puzzle");
      await call(player, `creations/${published.id}/favorite`, "POST", {
        favorited: true,
      });
      const [first, second] = (await Promise.all([
        call(player, `creations/${published.id}/play`, "POST"),
        call(player, `creations/${published.id}/play`, "POST"),
      ])) as { registered: boolean }[];
      expect(Number(first.registered) + Number(second.registered)).toBe(1);
      const discovery = (await call(
        player,
        `creations?category=puzzle&creator=${owner.id}&favorites=true&sort=completed`,
      )) as { total: number; community: Record<string, unknown>[] };
      expect(discovery.total).toBe(1);
      expect(discovery.community[0]).toMatchObject({
        id: published.id,
        plays: 1,
        category: "puzzle",
        favorited: true,
      });
      expect(discovery.community[0]).not.toHaveProperty("level");
      expect(
        discovery.community.some((row) => row.id === privateLevel.id),
      ).toBe(false);
      await expect(call(player, "creations?offset=-1")).rejects.toMatchObject({
        status: 400,
      });
    });
    it("enforces comment limits atomically and caps drafts without deleting existing levels", async () => {
      const creation = await create();
      const submitted = await Promise.allSettled(
        Array.from({ length: 12 }, (_, index) =>
          call(player, `creations/${creation.id}/comments`, "POST", {
            body: `Message ${index}`,
          }),
        ),
      );
      expect(
        submitted.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(10);
      expect(
        submitted.filter((result) => result.status === "rejected"),
      ).toHaveLength(2);
      const level = starterLevel();
      await db`INSERT INTO creations(owner_id,title,level) SELECT ${outsider.id},'Limit fixture',${db.json(level)} FROM generate_series(1,200)`;
      await expect(
        call(outsider, "creations", "POST", { title: "Another draft", level }),
      ).rejects.toMatchObject({ status: 429 });
      expect(
        (
          await db`SELECT count(*)::int AS n FROM creations WHERE owner_id=${outsider.id}`
        )[0].n,
      ).toBe(200);
    });
  },
);
