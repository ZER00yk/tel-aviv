import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, getUser } from "../packages/database/src/index";
import { handleSocial } from "../packages/platform/src/social";
import { storageUsage } from "../packages/platform/src/storageQuota";
import { MAX_EMOJI_BYTES } from "../packages/platform/src/chatMedia";
import type { User } from "../packages/shared/src/index";
import { emojiPng } from "./emoji-fixture";

describe.runIf(["true", "1"].includes(process.env.RUN_DB_TESTS ?? ""))(
  "private server emoji storage",
  () => {
    const accounts: string[] = [],
      servers: string[] = [];
    async function fixture() {
      const users: User[] = [];
      for (let i = 0; i < 3; i++) {
        const id = randomUUID();
        accounts.push(id);
        await db`INSERT INTO users(id,username,display_name) VALUES(${id},${"emoji_" + id.slice(0, 8)},${"Emoji " + i})`;
        users.push((await getUser(id))!);
      }
      async function call<T = Record<string, unknown>>(
        who: number,
        path: string,
        method = "GET",
        input: Record<string, unknown> = {},
        body?: FormData,
      ): Promise<T> {
        return (await handleSocial(
          path.split("/"),
          method,
          {
            user: users[who],
            request: new Request("http://localhost:3000/api/" + path, {
              method,
              ...(body ? { body } : {}),
            }),
          },
          input,
        )) as T;
      }
      const server = (
        await call<{ id: string }>(0, "servers", "POST", {
          name: "Emoji fixture",
        })
      ).id;
      servers.push(server);
      await db`INSERT INTO server_members(server_id,user_id) VALUES(${server},${users[1].id})`;
      const upload = (
        who: number,
        name: string,
        bytes: Buffer = emojiPng,
        type = "image/png",
        filename = "pink.png",
      ) => {
        const form = new FormData();
        form.set("name", name);
        form.set("file", new File([new Uint8Array(bytes)], filename, { type }));
        return call<{ id: string; name: string; bytes: number }>(
          who,
          `servers/${server}/emojis`,
          "POST",
          {},
          form,
        );
      };
      return { users, server, call, upload };
    }
    afterAll(async () => {
      for (const id of servers) await db`DELETE FROM servers WHERE id=${id}`;
      for (const id of accounts) await db`DELETE FROM users WHERE id=${id}`;
    });
    it("allows members to read exact private bytes, restricts writes, and releases uploader quota on delete", async () => {
      const { users, server, call, upload } = await fixture();
      const before = await storageUsage(db, users[0].id);
      const emoji = await upload(0, "pink_pixel");
      expect(
        (await storageUsage(db, users[0].id)).usageBytes - before.usageBytes,
      ).toBe(emojiPng.length);
      const list = await call<Record<string, unknown>[]>(
        1,
        `servers/${server}/emojis`,
      );
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: emoji.id, name: "pink_pixel" });
      expect(list[0]).not.toHaveProperty("data");
      const response = await call<Response>(
        1,
        `servers/${server}/emojis/${emoji.id}/file`,
      );
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(emojiPng);
      await expect(call(2, `servers/${server}/emojis`)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        call(2, `servers/${server}/emojis/${emoji.id}/file`),
      ).rejects.toMatchObject({ status: 403 });
      await expect(upload(1, "ordinary_member")).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        call(1, `servers/${server}/emojis/${emoji.id}`, "DELETE"),
      ).rejects.toMatchObject({ status: 403 });
      await expect(upload(0, "pink_pixel")).rejects.toMatchObject({
        status: 409,
      });
      // Assigned roles are evaluated on the server, independently of the UI.
      const [role] =
        await db`INSERT INTO server_roles(server_id,name,permissions) VALUES(${server},'Emoji manager',${["manage_server"]}) RETURNING id`;
      await db`INSERT INTO server_member_roles(server_id,user_id,role_id) VALUES(${server},${users[1].id},${role.id})`;
      const managed = await upload(1, "manager_pixel");
      expect((await storageUsage(db, users[1].id)).usageBytes).toBe(
        emojiPng.length,
      );
      await call(1, `servers/${server}/emojis/${emoji.id}`, "DELETE");
      expect((await storageUsage(db, users[0].id)).usageBytes).toBe(
        before.usageBytes,
      );
      await expect(
        call(0, `servers/${server}/emojis/${emoji.id}/file`),
      ).rejects.toMatchObject({ status: 404 });
      await call(0, `servers/${server}/emojis/${managed.id}`, "DELETE");
    });
    it("rejects SVG, forged signatures, unsafe names, excessive dimensions and oversized request bodies", async () => {
      const { server, upload, call } = await fixture();
      await expect(
        upload(
          0,
          "vector",
          Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
          "image/svg+xml",
          "vector.svg",
        ),
      ).rejects.toMatchObject({ status: 415 });
      await expect(
        upload(0, "forged", Buffer.from("not an image")),
      ).rejects.toMatchObject({ status: 415 });
      await expect(upload(0, "Bad Name")).rejects.toMatchObject({
        status: 400,
      });
      const huge = Buffer.from(emojiPng);
      huge.writeUInt32BE(100_000, 16);
      await expect(upload(0, "bomb", huge)).rejects.toMatchObject({
        status: 415,
      });
      await expect(
        upload(0, "oversized", Buffer.alloc(MAX_EMOJI_BYTES + 1)),
      ).rejects.toMatchObject({ status: 413 });
      await expect(
        upload(
          0,
          "request_overflow",
          Buffer.alloc(MAX_EMOJI_BYTES + 64 * 1024 + 1),
        ),
      ).rejects.toMatchObject({ status: 413 });
      expect(await call(0, `servers/${server}/emojis`)).toEqual([]);
    });
    it("serializes the server count when two managers race for the last emoji slot", async () => {
      const { server, users, call, upload } = await fixture();
      await db`UPDATE server_roles SET permissions=array_append(permissions,'manage_server') WHERE server_id=${server} AND is_default`;
      await db.begin(async (tx) => {
        for (let i = 0; i < 49; i++)
          await tx`INSERT INTO server_emojis(server_id,owner_id,name,mime,bytes,data) VALUES(${server},${users[0].id},${"seed_" + i},'image/png',${emojiPng.length},${emojiPng})`;
      });
      const results = await Promise.allSettled([
        upload(0, "last_owner"),
        upload(1, "last_manager"),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results
          .filter((result) => result.status === "rejected")
          .map((result) =>
            result.status === "rejected" ? result.reason.status : null,
          ),
      ).toEqual([409]);
      expect(
        await call<Record<string, unknown>[]>(0, `servers/${server}/emojis`),
      ).toHaveLength(50);
    });
    it("reserves shared storage quota under the same user lock and isolates emoji IDs by server", async () => {
      const { server, users, upload, call } = await fixture();
      await db`INSERT INTO user_storage_quotas(user_id,quota_bytes) VALUES(${users[0].id},${1024 ** 2})`;
      const large = Buffer.alloc(MAX_EMOJI_BYTES);
      emojiPng.copy(large);
      await db.begin(async (tx) => {
        for (let i = 0; i < 3; i++)
          await tx`INSERT INTO server_emojis(server_id,owner_id,name,mime,bytes,data) VALUES(${server},${users[0].id},${"quota_" + i},'image/png',${large.length},${large})`;
      });
      const results = await Promise.allSettled([
        upload(0, "quota_last_a", large),
        upload(0, "quota_last_b", large),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results
          .filter((result) => result.status === "rejected")
          .map((result) =>
            result.status === "rejected" ? result.reason.status : null,
          ),
      ).toEqual([413]);
      expect((await storageUsage(db, users[0].id)).usageBytes).toBe(1024 ** 2);
      const emoji = (
        results.find(
          (result) => result.status === "fulfilled",
        ) as PromiseFulfilledResult<{ id: string }>
      ).value;
      const other = (
        await call<{ id: string }>(0, "servers", "POST", {
          name: "Second emoji fixture",
        })
      ).id;
      servers.push(other);
      await expect(
        call(0, `servers/${other}/emojis/${emoji.id}/file`),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        call(0, `servers/${other}/emojis/${emoji.id}`, "DELETE"),
      ).rejects.toMatchObject({ status: 404 });
      await call(0, `servers/${server}/emojis/${emoji.id}`, "DELETE");
      expect((await storageUsage(db, users[0].id)).usageBytes).toBe(
        3 * MAX_EMOJI_BYTES,
      );
    });
  },
);
