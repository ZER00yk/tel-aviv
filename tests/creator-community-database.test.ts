import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import { handleClasses } from "../packages/platform/src/classes";
import { handleCreatorReports } from "../packages/platform/src/creations/community";
import {
  CREATOR_RUNTIME_REVISION,
  starterLevel,
  type LevelData,
} from "../packages/creator-runtime/src/index";
type Creation = {
  id: string;
  version: number;
  level: LevelData;
  can_edit?: boolean;
  title: string;
  statistics: Record<string, number>;
};
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "Creator community authority and collaboration",
  () => {
    let users: User[] = [];
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
    const create = async (published = false, instant = false) => {
      const c = (await call(users[0], "creations", "POST", {
        title: "Shared private project",
        level: instant
          ? { ...starterLevel(), spawn: { x: 880, y: 450 } }
          : starterLevel(),
      })) as Creation;
      if (published)
        await call(users[0], `creations/${c.id}/publish`, "POST", {
          published: true,
        });
      return c;
    };
    const grant = (c: Creation, index = 1, permission = "editor") =>
      call(users[0], `creations/${c.id}/collaborators`, "POST", {
        username: users[index].username,
        permission,
      });
    const edit = (
      c: Creation,
      index = 1,
      expectedVersion = c.version,
      title = "Shared edit",
    ) =>
      call(users[index], `creations/${c.id}`, "PATCH", {
        title,
        level: c.level,
        expectedVersion,
      });
    beforeEach(async () => {
      for (let i = 0; i < 4; i++) {
        const id = randomUUID();
        await db`INSERT INTO users(id,username,display_name,role) VALUES(${id},${`community_${id.slice(0, 8)}`},'Community fixture',${i === 3 ? "admin" : "user"})`;
        users.push((await getUser(id))!);
      }
    });
    afterEach(async () => {
      const ids = users.map((u) => u.id);
      // Immutable audit rows deliberately retain the administrative actor UUID and username as evidence.
      if (ids.length) await db`DELETE FROM users WHERE id=ANY(${ids}::uuid[])`;
      users = [];
    });
    it("keeps private drafts hidden and separates viewer, editor and creator authority", async () => {
      const c = await create();
      await expect(call(users[1], `creations/${c.id}`)).rejects.toMatchObject({
        status: 404,
      });
      await grant(c, 1, "viewer");
      expect(await call(users[1], `creations/${c.id}`)).toMatchObject({
        can_edit: false,
        collaborator_permission: "viewer",
      });
      await expect(edit(c)).rejects.toMatchObject({ status: 403 });
      await expect(
        call(users[1], `creations/${c.id}/versions`),
      ).rejects.toMatchObject({ status: 403 });
      await grant(c);
      expect(await edit(c)).toMatchObject({ version: 2, can_edit: true });
      for (const [suffix, payload] of [
        ["publish", { published: true }],
        ["restore-version", { version: 1 }],
        [
          "collaborators",
          { username: users[2].username, permission: "editor" },
        ],
      ] as const)
        await expect(
          call(users[1], `creations/${c.id}/${suffix}`, "POST", payload),
        ).rejects.toMatchObject({ status: 403 });
      await expect(
        call(users[2], `creations/${c.id}/collaborators`),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("serializes concurrent saves and preserves the losing draft through a version conflict", async () => {
      const c = await create();
      await grant(c);
      const results = await Promise.allSettled([
        edit(c, 0, 1, "Owner concurrent draft"),
        edit(c, 1, 1, "Editor concurrent draft"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failure = results.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      expect(failure.reason).toMatchObject({ status: 409 });
      expect(
        await db`SELECT version FROM creation_versions WHERE creation_id=${c.id} ORDER BY version`,
      ).toEqual([{ version: 1 }, { version: 2 }]);
    });
    it("rechecks revoked grants and hides projects immediately after revocation", async () => {
      const c = await create();
      await grant(c);
      await call(
        users[0],
        `creations/${c.id}/collaborators/${users[1].id}`,
        "DELETE",
      );
      await expect(edit(c)).rejects.toMatchObject({ status: 404 });
      const list = (await call(users[1], "creations")) as {
        collaborations: Creation[];
      };
      expect(list.collaborations).toEqual([]);
      expect(
        await db`SELECT version FROM creation_versions WHERE creation_id=${c.id}`,
      ).toHaveLength(1);
    });
    it("lists only granted shared projects and respects invisible collaborator presence", async () => {
      const c = await create();
      await grant(c);
      const list = (await call(users[1], "creations")) as {
        collaborations: Creation[];
        community: Creation[];
      };
      expect(list.collaborations).toEqual([
        expect.objectContaining({ id: c.id, can_edit: true }),
      ]);
      expect(list.community.some((row) => row.id === c.id)).toBe(false);
      await call(users[1], `creations/${c.id}/collaborators/presence`, "POST");
      expect(await call(users[0], `creations/${c.id}/collaborators`)).toEqual([
        expect.objectContaining({ active: true }),
      ]);
      await db`UPDATE users SET settings=jsonb_set(settings,'{presence}','"invisible"'::jsonb) WHERE id=${users[1].id}`;
      expect(await call(users[0], `creations/${c.id}/collaborators`)).toEqual([
        expect.objectContaining({ active: false }),
      ]);
    });
    it("upserts bounded ratings, forbids self-rating and filters followed public creators", async () => {
      const c = await create(true);
      await expect(
        call(users[0], `creations/${c.id}/rating`, "POST", { rating: 3 }),
      ).rejects.toMatchObject({ status: 400 });
      await call(users[1], `creations/${c.id}/rating`, "POST", { rating: 2 });
      await call(users[1], `creations/${c.id}/rating`, "POST", { rating: 5 });
      await expect(
        call(users[1], `creations/${c.id}/rating`, "POST", { rating: 6 }),
      ).rejects.toThrow();
      await call(users[1], `creations/creators/${users[0].id}/follow`, "POST", {
        followed: true,
      });
      await call(users[1], `creations/creators/${users[0].id}/follow`, "POST", {
        followed: true,
      });
      const list = (await call(
        users[1],
        "creations?followed=true&sort=trending",
      )) as { community: { id: string; difficulty: number }[] };
      expect(list.community).toEqual([
        expect.objectContaining({ id: c.id, difficulty: 5 }),
      ]);
      expect(
        await db`SELECT * FROM creator_follows WHERE follower_id=${users[1].id}`,
      ).toHaveLength(1);
      await call(users[1], `creations/creators/${users[0].id}/follow`, "POST", {
        followed: false,
      });
      expect(
        (
          (await call(users[1], "creations?followed=true")) as {
            community: unknown[];
          }
        ).community,
      ).toEqual([]);
    });
    it("records reports once, permits only administrators to review, and audits once without deleting levels", async () => {
      const c = await create(true);
      const report = (await call(users[1], `creations/${c.id}/report`, "POST", {
        reason: "broken",
        details: "A precise fixture report",
      })) as { id: string };
      expect(
        await call(users[1], `creations/${c.id}/report`, "POST", {
          reason: "other",
          details: "Retry",
        }),
      ).toMatchObject({ id: report.id });
      await expect(
        handleCreatorReports(users[1].id, "GET", undefined, {}),
      ).rejects.toMatchObject({ status: 403 });
      const review = {
        status: "reviewed",
        note: "Verified under fixture conditions",
      };
      const outcomes = await Promise.all([
        handleCreatorReports(users[3].id, "POST", report.id, review),
        handleCreatorReports(users[3].id, "POST", report.id, review),
      ]);
      expect(outcomes).toContainEqual(
        expect.objectContaining({ replayed: true }),
      );
      expect(
        await db`SELECT id FROM admin_audit_log WHERE actor_id=${users[3].id} AND action='creator.report.review'`,
      ).toHaveLength(1);
      await expect(
        handleCreatorReports(users[3].id, "POST", report.id, {
          status: "dismissed",
          note: "Different outcome",
        }),
      ).rejects.toMatchObject({ status: 409 });
      await call(users[0], `creations/${c.id}/publish`, "POST", {
        published: false,
      });
      expect(
        await handleCreatorReports(users[3].id, "GET", undefined, {}),
      ).toContainEqual(expect.objectContaining({ id: report.id, title: null }));
      expect(await db`SELECT id FROM creations WHERE id=${c.id}`).toHaveLength(
        1,
      );
    });
    it("counts one account across revisions and ranks only the current server runtime and revision", async () => {
      let c = await create(true, true);
      async function finish() {
        const attempt = (await call(
          users[1],
          `creations/${c.id}/attempts`,
          "POST",
        )) as { attemptId: string; runtimeRevision: string };
        expect(attempt.runtimeRevision).toBe(CREATOR_RUNTIME_REVISION);
        const result = await call(
          users[1],
          `creations/${c.id}/attempts/${attempt.attemptId}/input`,
          "POST",
          { expectedSequence: 0, frames: [{ keys: [], ticks: 1 }] },
        );
        expect(result).toMatchObject({ status: "completed" });
        return attempt.attemptId;
      }
      await finish();
      await finish();
      c = (await edit(c, 0)) as Creation;
      const current = await finish();
      const detail = (await call(users[0], `creations/${c.id}`)) as Creation;
      expect(detail.statistics).toMatchObject({
        total_attempts: 3,
        total_completions: 3,
        unique_account_completions: 1,
        published_version_completions: 1,
        completion_percentage: 100,
      });
      expect(await call(users[1], `creations/${c.id}/rankings`)).toMatchObject({
        version: 2,
        runtimeRevision: CREATOR_RUNTIME_REVISION,
        entries: [
          expect.objectContaining({ username: users[1].username, ticks: 1 }),
        ],
      });
      await db`UPDATE creator_play_attempts SET runtime_revision='legacy' WHERE id=${current}`;
      expect(await call(users[1], `creations/${c.id}/rankings`)).toMatchObject({
        entries: [],
      });
    });
    it("account deletion removes grants, follows and ratings without orphaned access", async () => {
      const c = await create(true);
      await grant(c);
      await call(users[1], `creations/${c.id}/rating`, "POST", { rating: 4 });
      await call(users[1], `creations/creators/${users[0].id}/follow`, "POST", {
        followed: true,
      });
      await db`DELETE FROM users WHERE id=${users[1].id}`;
      expect(
        await db`SELECT * FROM creation_collaborators WHERE creation_id=${c.id}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT * FROM creation_difficulty_ratings WHERE creation_id=${c.id}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT * FROM creator_follows WHERE creator_id=${users[0].id}`,
      ).toHaveLength(0);
    });
  },
);
