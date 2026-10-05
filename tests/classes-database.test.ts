import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db, getUser } from "@tell-aviv/database";
import { handleClasses } from "../packages/platform/src/classes";
import { starterLevel } from "../packages/platform/src/classes/models";
import type { User } from "@tell-aviv/shared";
type Resource = { id: string; version: number; data: Record<string, unknown> };
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "private school and creator persistence",
  () => {
    let owner: User;
    let viewer: User;
    let classId: string;
    let folder: Resource;
    let note: Resource;
    function call(
      user: User,
      path: string,
      method = "GET",
      input: Record<string, unknown> = {},
    ) {
      return handleClasses(
        path.split("?")[0].split("/"),
        method,
        { user, request: new Request(`http://localhost:3000/api/${path}`) },
        input,
      );
    }
    beforeAll(async () => {
      const suffix = randomUUID().slice(0, 8);
      const a = randomUUID(),
        b = randomUUID();
      await db`insert into users(id,username,display_name) values(${a},${`schoola_${suffix}`},'School owner'),(${b},${`schoolb_${suffix}`},'School viewer')`;
      owner = (await getUser(a))!;
      viewer = (await getUser(b))!;
      const cls = (await call(owner, "classes", "POST", {
        name: "Private science",
      })) as { id: string };
      classId = cls.id;
      folder = (await call(owner, `classes/${classId}/resources`, "POST", {
        kind: "folder",
        title: "Experiments",
      })) as Resource;
      note = (await call(owner, `classes/${classId}/resources`, "POST", {
        kind: "note",
        title: "Private result",
        parentId: folder.id,
        data: { markdown: "Initial result" },
      })) as Resource;
    });
    afterAll(async () => {
      if (owner && viewer)
        await db`delete from users where id in (${owner.id},${viewer.id})`;
    });
    it("hides private resources and grants only explicitly shared folder content", async () => {
      await expect(
        call(viewer, `classes/resources/${note.id}`),
      ).rejects.toMatchObject({ status: 404 });
      await call(owner, `classes/resources/${folder.id}/share`, "POST", {
        username: viewer.username,
        permission: "view",
      });
      expect(
        ((await call(viewer, `classes/resources/${note.id}`)) as Resource).data
          .markdown,
      ).toBe("Initial result");
      await expect(
        call(viewer, `classes/resources/${note.id}`, "PATCH", {
          expectedVersion: 1,
          data: { markdown: "Forbidden" },
        }),
      ).rejects.toMatchObject({ status: 404 });
      const search = (await call(
        viewer,
        "classes/search?q=Private",
      )) as Resource[];
      expect(search.map((row) => row.id)).toContain(note.id);
    });
    it("allows edit grants but denies trash, restore, purge and reshare to recipients", async () => {
      await call(owner, `classes/resources/${folder.id}/share`, "POST", {
        username: viewer.username,
        permission: "edit",
      });
      note = (await call(viewer, `classes/resources/${note.id}`, "PATCH", {
        expectedVersion: 1,
        data: { markdown: "Shared edit" },
      })) as Resource;
      expect(note.version).toBe(2);
      for (const [suffix, method] of [
        ["", "DELETE"],
        ["/restore", "POST"],
        ["/permanent", "DELETE"],
        ["/share", "POST"],
      ])
        await expect(
          call(viewer, `classes/resources/${note.id}${suffix}`, method, {}),
        ).rejects.toMatchObject({ status: expect.any(Number) });
      await call(owner, `classes/resources/${folder.id}`, "DELETE");
      await expect(
        call(viewer, `classes/resources/${note.id}`),
      ).rejects.toMatchObject({ status: 404 });
      expect(await call(viewer, "classes/search?q=Private")).toEqual([]);
      await call(owner, `classes/resources/${folder.id}/restore`, "POST");
    });
    it("preserves revision restore and detects competing saves without lost updates", async () => {
      const revisions = (await call(
        owner,
        `classes/resources/${note.id}/revisions`,
      )) as { id: string; version: number }[];
      expect(revisions).toHaveLength(2);
      note = (await call(
        owner,
        `classes/resources/${note.id}/restore-revision`,
        "POST",
        { revisionId: revisions.find((row) => row.version === 1)!.id },
      )) as Resource;
      expect(note.version).toBe(3);
      expect(note.data.markdown).toBe("Initial result");
      const outcomes = await Promise.allSettled([
        call(owner, `classes/resources/${note.id}`, "PATCH", {
          expectedVersion: 3,
          data: { markdown: "First writer" },
        }),
        call(viewer, `classes/resources/${note.id}`, "PATCH", {
          expectedVersion: 3,
          data: { markdown: "Second writer" },
        }),
      ]);
      expect(
        outcomes.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        outcomes.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      expect(
        await call(owner, `classes/resources/${note.id}/revisions`),
      ).toHaveLength(4);
    });
    it("prevents folder cycles when two moves race", async () => {
      const second = (await call(
        owner,
        `classes/${classId}/resources`,
        "POST",
        { kind: "folder", title: "Second folder" },
      )) as Resource;
      const outcomes = await Promise.allSettled([
        call(owner, `classes/resources/${folder.id}`, "PATCH", {
          expectedVersion: 1,
          parentId: second.id,
        }),
        call(owner, `classes/resources/${second.id}`, "PATCH", {
          expectedVersion: 1,
          parentId: folder.id,
        }),
      ]);
      expect(
        outcomes.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        outcomes.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
    });
    it("keeps drafts private and publishing cannot give others edit rights", async () => {
      const creation = (await call(owner, "creations", "POST", {
        title: "Safe draft",
        level: starterLevel(),
      })) as Resource;
      await expect(
        call(viewer, `creations/${creation.id}`),
      ).rejects.toMatchObject({ status: 404 });
      await call(owner, `creations/${creation.id}/publish`, "POST", {
        published: true,
      });
      expect(
        ((await call(viewer, `creations/${creation.id}`)) as Resource).id,
      ).toBe(creation.id);
      await expect(
        call(viewer, `creations/${creation.id}`, "PATCH", {
          title: "Hijack",
          level: starterLevel(),
          expectedVersion: 1,
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        call(viewer, `creations/${creation.id}/publish`, "POST", {
          published: false,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
  },
);
