import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, getUser } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import {
  authorizeResource,
  handleClasses,
} from "../packages/platform/src/classes";
import {
  deleteSchoolClass,
  purgeExpiredSchoolTrash,
  trashCutoff,
} from "../packages/platform/src/classes/lifecycle";

describe("school retention boundaries", () => {
  it("uses an exact 30-day cutoff and rejects invalid dates", () => {
    expect(trashCutoff(new Date("2030-10-01T00:00:00Z")).toISOString()).toBe(
      "2030-09-01T00:00:00.000Z",
    );
    expect(() => trashCutoff(new Date("invalid"))).toThrow(
      "Invalid retention date",
    );
  });
});
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "class management and scoped trash transactions",
  () => {
    let owner: User;
    let other: User;
    const keys: string[] = [];
    const classIds: string[] = [];
    const now = new Date("2030-10-01T00:00:00Z");
    function call(
      user: User,
      path: string,
      method = "GET",
      input: Record<string, unknown> = {},
    ) {
      return handleClasses(
        path.split("/"),
        method,
        { user, request: new Request(`http://localhost:3000/api/${path}`) },
        input,
      );
    }
    async function makeClass(user = owner, name = "Retention fixture") {
      const result = (await call(user, "classes", "POST", { name })) as {
        id: string;
      };
      classIds.push(result.id);
      return result.id;
    }
    async function resource(
      classId: string,
      user: User,
      kind = "note",
      parentId: string | null = null,
      deletedAt: string | null = null,
    ) {
      const key = randomUUID();
      const data =
        kind === "file"
          ? { key, name: "private.txt", mime: "text/plain", size: 12 }
          : kind === "note"
            ? { markdown: "Fixture only" }
            : {};
      if (kind === "file") keys.push(key);
      const [row] =
        await db`insert into school_resources(class_id,owner_id,parent_id,kind,title,data,deleted_at) values(${classId},${user.id},${parentId},${kind},'Fixture',${db.json(data)},${deletedAt}) returning id`;
      return { id: row.id as string, key };
    }
    beforeAll(async () => {
      const suffix = randomUUID().slice(0, 8),
        a = randomUUID(),
        b = randomUUID();
      await db`insert into users(id,username,display_name) values(${a},${`retentiona_${suffix}`},'Fixture A'),(${b},${`retentionb_${suffix}`},'Fixture B')`;
      owner = (await getUser(a))!;
      other = (await getUser(b))!;
    });
    afterAll(async () => {
      if (keys.length)
        await db`delete from storage_cleanup_jobs where storage_key in ${db(keys)}`;
      if (classIds.length)
        await db`delete from school_classes where id in ${db(classIds)}`;
      if (owner && other)
        await db`delete from users where id in (${owner.id},${other.id})`;
    });
    it("renames only owned classes and rejects wrong typed confirmation without changing data", async () => {
      const classId = await makeClass(owner, "Physics fixture");
      await expect(
        call(other, `classes/${classId}`, "PATCH", { name: "Taken over" }),
      ).rejects.toMatchObject({ status: 404 });
      const renamed = (await call(owner, `classes/${classId}`, "PATCH", {
        name: "Science fixture",
        color: "#123456",
      })) as { name: string; color: string };
      expect(renamed).toMatchObject({
        name: "Science fixture",
        color: "#123456",
      });
      const file = await resource(classId, owner, "file");
      await expect(
        deleteSchoolClass(classId, owner.id, "DELETE Physics fixture"),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        deleteSchoolClass(classId, other.id, "DELETE Science fixture"),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        await db`select id from school_resources where id=${file.id}`,
      ).toHaveLength(1);
      expect(
        await db`select storage_key from storage_cleanup_jobs where storage_key=${file.key}`,
      ).toHaveLength(0);
      const deleted = await deleteSchoolClass(
        classId,
        owner.id,
        "DELETE Science fixture",
      );
      expect(deleted.queuedFiles).toBe(1);
      expect(
        await db`select id from school_classes where id=${classId}`,
      ).toHaveLength(0);
      expect(
        await db`select storage_key from storage_cleanup_jobs where storage_key=${file.key}`,
      ).toHaveLength(1);
    });
    it("purges expired folder contents and queues blobs while preserving recent/restored and other-user trash", async () => {
      const classId = await makeClass();
      const folder = await resource(
        classId,
        owner,
        "folder",
        null,
        "2030-08-25T00:00:00Z",
      );
      const childFile = await resource(classId, owner, "file", folder.id);
      const recent = await resource(
        classId,
        owner,
        "note",
        null,
        "2030-09-20T00:00:00Z",
      );
      const restored = await resource(classId, owner, "note");
      const otherClass = await makeClass(other);
      const others = await resource(
        otherClass,
        other,
        "file",
        null,
        "2030-08-20T00:00:00Z",
      );
      const result = await purgeExpiredSchoolTrash({ ownerId: owner.id, now });
      expect(result.purgedRoots).toBe(1);
      expect(result.queuedFiles).toBe(1);
      expect(
        await db`select id from school_resources where id in (${folder.id},${childFile.id})`,
      ).toHaveLength(0);
      expect(
        await db`select id from school_resources where id in (${recent.id},${restored.id},${others.id})`,
      ).toHaveLength(3);
      expect(
        await db`select storage_key from storage_cleanup_jobs where storage_key=${childFile.key}`,
      ).toHaveLength(1);
      expect(
        await db`select storage_key from storage_cleanup_jobs where storage_key=${others.key}`,
      ).toHaveLength(0);
      expect(
        (await purgeExpiredSchoolTrash({ ownerId: owner.id, now })).purgedRoots,
      ).toBe(0);
    });
    it("validates flashcard images and deck sharing does not grant file access", async () => {
      const classId = await makeClass();
      const image = await resource(classId, owner, "file");
      await db`update school_resources set data=jsonb_set(data,'{mime}','"image/png"'::jsonb) where id=${image.id}`;
      const deck = (await call(owner, `classes/${classId}/resources`, "POST", {
        kind: "flashcards",
        title: "Illustrated deck",
        data: {
          cards: [
            {
              front: "Plant",
              back: "Photosynthesis",
              imageResourceId: image.id,
            },
          ],
        },
      })) as { id: string; data: { cards: { imageResourceId: string }[] } };
      expect(deck.data.cards[0].imageResourceId).toBe(image.id);
      await call(owner, `classes/resources/${deck.id}/share`, "POST", {
        username: other.username,
        permission: "view",
      });
      expect(
        ((await call(other, `classes/resources/${deck.id}`)) as { id: string })
          .id,
      ).toBe(deck.id);
      await expect(authorizeResource(image.id, other.id)).rejects.toMatchObject(
        { status: 404 },
      );
      const textFile = await resource(classId, owner, "file");
      await expect(
        call(owner, `classes/${classId}/resources`, "POST", {
          kind: "flashcards",
          title: "Invalid image",
          data: {
            cards: [{ front: "Q", back: "A", imageResourceId: textFile.id }],
          },
        }),
      ).rejects.toMatchObject({ status: 400 });
      const otherClass = await makeClass(other);
      const foreignImage = await resource(otherClass, other, "file");
      await expect(
        call(owner, `classes/${classId}/resources`, "POST", {
          kind: "flashcards",
          title: "Forbidden image",
          data: {
            cards: [
              { front: "Q", back: "A", imageResourceId: foreignImage.id },
            ],
          },
        }),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("permanent resource deletion queues files durably and rejects an active resource", async () => {
      const classId = await makeClass();
      const active = await resource(classId, owner, "file");
      await expect(
        call(owner, `classes/resources/${active.id}/permanent`, "DELETE"),
      ).rejects.toMatchObject({ status: 400 });
      const folder = await resource(
        classId,
        owner,
        "folder",
        null,
        "2030-09-20T00:00:00Z",
      );
      const file = await resource(classId, owner, "file", folder.id);
      await expect(
        call(other, `classes/resources/${folder.id}/permanent`, "DELETE"),
      ).rejects.toMatchObject({ status: 404 });
      const result = (await call(
        owner,
        `classes/resources/${folder.id}/permanent`,
        "DELETE",
      )) as { queuedFiles: number };
      expect(result.queuedFiles).toBe(1);
      expect(
        await db`select storage_key from storage_cleanup_jobs where storage_key=${file.key}`,
      ).toHaveLength(1);
      expect(
        await db`select id from school_resources where id=${active.id}`,
      ).toHaveLength(1);
    });
    it("serializes a restore against retention so a successful restore is never discarded", async () => {
      const classId = await makeClass();
      const row = await resource(
        classId,
        owner,
        "file",
        null,
        "2030-08-20T00:00:00Z",
      );
      const [restore] = await Promise.allSettled([
        call(owner, `classes/resources/${row.id}/restore`, "POST"),
        purgeExpiredSchoolTrash({ ownerId: owner.id, now }),
      ]);
      const remaining =
        await db`select deleted_at from school_resources where id=${row.id}`;
      if (restore.status === "fulfilled") {
        expect(remaining).toHaveLength(1);
        expect(remaining[0].deleted_at).toBeNull();
        expect(
          await db`select storage_key from storage_cleanup_jobs where storage_key=${row.key}`,
        ).toHaveLength(0);
      } else {
        expect(remaining).toHaveLength(0);
        expect(
          await db`select storage_key from storage_cleanup_jobs where storage_key=${row.key}`,
        ).toHaveLength(1);
      }
    });
  },
);
