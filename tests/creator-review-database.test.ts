import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import { handleClasses } from "../packages/platform/src/classes";
import {
  starterLevel,
  type LevelData,
} from "../packages/creator-runtime/src/schema";

type Creation = { id: string; version: number; level: LevelData };
type Attempt = {
  attemptId: string;
  creationVersion: number;
  level?: LevelData;
  nextSequence: number;
  status: string;
  state: { won: boolean; logicHalted: boolean };
  completionRecorded: boolean;
};

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "independent Creator authority and legacy integration",
  () => {
    let users: User[] = [];
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
    const create = async (level = starterLevel(), published = true) => {
      const creation = (await call(users[0], "creations", "POST", {
        title: "Creator review fixture",
        level,
      })) as Creation;
      if (published)
        await call(users[0], `creations/${creation.id}/publish`, "POST", {
          published: true,
        });
      return creation;
    };
    const start = async (creation: Creation) =>
      (await call(
        users[1],
        `creations/${creation.id}/attempts`,
        "POST",
      )) as Attempt;
    const input = async (
      creation: Creation,
      attempt: Attempt,
      extra: Record<string, unknown> = {},
    ) =>
      (await call(
        users[1],
        `creations/${creation.id}/attempts/${attempt.attemptId}/input`,
        "POST",
        {
          expectedSequence: attempt.nextSequence,
          frames: [{ keys: [], ticks: 1 }],
          ...extra,
        },
      )) as Attempt;
    beforeEach(async () => {
      for (let i = 0; i < 2; i++) {
        const id = randomUUID();
        await db`INSERT INTO users(id,username,display_name) VALUES(${id},${`creator_review_${id.slice(0, 8)}`},'Creator review')`;
        users.push((await getUser(id))!);
      }
    });
    afterEach(async () => {
      for (const user of users) await db`DELETE FROM users WHERE id=${user.id}`;
      users = [];
    });
    it("normalizes old authored geometry only in the pinned attempt and preserves saved schema 1", async () => {
      const legacy = { ...starterLevel(), spawn: { x: 880, y: 450 } };
      const before = JSON.stringify(legacy);
      const creation = await create(legacy);
      const attempt = await start(creation);
      const [stored] =
        await db`SELECT level,state FROM creator_play_attempts WHERE id=${attempt.attemptId}`;
      expect(stored.level).toMatchObject({
        schemaVersion: 2,
        variables: [],
        logic: [],
        objects: legacy.objects,
      });
      expect(
        ((await call(users[0], `creations/${creation.id}`)) as Creation).level,
      ).toEqual(legacy);
      expect(JSON.stringify(legacy)).toBe(before);
      expect(await input(creation, attempt)).toMatchObject({
        status: "completed",
        completionRecorded: true,
      });
      const [completion] =
        await db`SELECT creation_version,ticks FROM creator_completions WHERE attempt_id=${attempt.attemptId}`;
      expect(completion).toMatchObject({ creation_version: 1, ticks: 1 });
    });
    it("pins an existing attempt to its old version when the published author changes the win rules", async () => {
      const creation = await create();
      const oldAttempt = await start(creation);
      const changed: LevelData = {
        ...starterLevel(),
        schemaVersion: 2,
        logic: [
          {
            id: randomUUID(),
            label: "New rules",
            event: { type: "level-start" },
            actions: [{ type: "complete" }],
          },
        ],
      };
      const updated = (await call(
        users[0],
        `creations/${creation.id}`,
        "PATCH",
        {
          title: "Edited rules",
          level: changed,
          expectedVersion: 1,
        },
      )) as Creation;
      const recovered = (await call(
        users[1],
        `creations/${creation.id}/attempts/${oldAttempt.attemptId}`,
      )) as Attempt;
      expect(oldAttempt.level).toMatchObject({
        schemaVersion: 2,
        logic: [],
        objects: starterLevel().objects,
      });
      expect(recovered.level).toEqual(oldAttempt.level);
      expect(await input(creation, oldAttempt)).toMatchObject({
        creationVersion: 1,
        status: "playing",
        state: { won: false },
      });
      const newAttempt = await start(updated);
      expect(newAttempt.level?.logic).toEqual(changed.logic);
      expect(await input(updated, newAttempt)).toMatchObject({
        creationVersion: 2,
        status: "completed",
      });
      const rows =
        await db`SELECT creation_version FROM creator_completions WHERE creation_id=${creation.id}`;
      expect(rows).toEqual([{ creation_version: 2 }]);
    });
    it("denies every unpublished reader, version and community action before exposing a level", async () => {
      const creation = await create(starterLevel(), false);
      const routes: [string, string, Record<string, unknown>][] = [
        ["", "GET", {}],
        ["/versions", "GET", {}],
        ["/restore-version", "POST", { version: 1 }],
        ["/play", "POST", {}],
        ["/attempts", "POST", {}],
        ["/like", "POST", { liked: true }],
        ["/favorite", "POST", { favorited: true }],
        ["/comments", "POST", { body: "Private" }],
      ];
      for (const [suffix, method, payload] of routes)
        await expect(
          call(users[1], `creations/${creation.id}${suffix}`, method, payload),
        ).rejects.toMatchObject({ status: 404 });
      expect(
        await db`SELECT id FROM creator_play_attempts WHERE creation_id=${creation.id}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT user_id FROM creation_likes WHERE creation_id=${creation.id}`,
      ).toHaveLength(0);
    });
    it("rejects injected state and oversized input batches, and treats a halted logic cycle as failed", async () => {
      const level: LevelData = {
        ...starterLevel(),
        schemaVersion: 2,
        logic: [
          {
            id: randomUUID(),
            label: "Begin",
            event: { type: "level-start" },
            actions: [{ type: "trigger", event: "loop" }],
          },
          {
            id: randomUUID(),
            label: "Loop",
            event: { type: "custom", name: "loop" },
            actions: [{ type: "trigger", event: "loop" }],
          },
        ],
      };
      const creation = await create(level);
      const attempt = await start(creation);
      for (const extra of [
        { state: { won: true } },
        { score: 1000000 },
        { frames: Array.from({ length: 6 }, () => ({ keys: [], ticks: 60 })) },
        { frames: [{ keys: ["eval"], ticks: 1 }] },
      ])
        await expect(input(creation, attempt, extra)).rejects.toThrow();
      expect(await input(creation, attempt)).toMatchObject({
        status: "failed",
        state: { won: false, logicHalted: true },
      });
      expect(
        await db`SELECT id FROM creator_completions WHERE creation_id=${creation.id}`,
      ).toHaveLength(0);
    });
  },
);
