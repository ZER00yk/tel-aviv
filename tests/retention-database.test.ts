import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import { handleSocial } from "../packages/platform/src/social";
import {
  deleteAccount,
  processStorageCleanup,
} from "../packages/platform/src/account";
import { handleClassFile } from "../packages/platform/src/classes";
import { storageUsage } from "../packages/platform/src/storageQuota";
import { deleteFile, readFile, storeFile } from "../packages/storage/src/index";
import * as storage from "../packages/storage/src/index";

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "private chat file retention",
  () => {
    let user: User;
    const keys: string[] = [];
    const servers: string[] = [];
    const parties: string[] = [];
    const rooms: string[] = [];
    const extraUsers: string[] = [];
    const call = (path: string[], method: string, actor = user) =>
      handleSocial(
        path,
        method,
        {
          user: actor,
          request: new Request(`http://localhost:3000/api/${path.join("/")}`),
        },
        {},
      );
    beforeEach(async () => {
      const id = randomUUID();
      await db`INSERT INTO users(id,username,display_name) VALUES(${id},${`retain_${id.slice(0, 8)}`},'Retention fixture')`;
      user = (await getUser(id))!;
    });
    afterEach(async () => {
      for (const id of servers.splice(0))
        await db`DELETE FROM servers WHERE id=${id}`;
      for (const id of parties.splice(0))
        await db`DELETE FROM parties WHERE id=${id}`;
      for (const id of rooms.splice(0))
        await db`DELETE FROM chat_rooms WHERE id=${id}`;
      if (user) await db`DELETE FROM users WHERE id=${user.id}`;
      for (const id of extraUsers.splice(0))
        await db`DELETE FROM users WHERE id=${id}`;
      for (const key of keys.splice(0)) {
        await deleteFile(key);
        await db`DELETE FROM storage_cleanup_jobs WHERE storage_key=${key}`;
      }
    });
    async function serverChannel() {
      const [server] =
        await db`INSERT INTO servers(owner_id,name) VALUES(${user.id},'Retention server') RETURNING id`;
      servers.push(String(server.id));
      await db`INSERT INTO server_members(server_id,user_id) VALUES(${server.id},${user.id})`;
      const [room] =
        await db`INSERT INTO chat_rooms(kind,name,server_id,owner_id) VALUES('channel','Retention channel',${server.id},${user.id}) RETURNING id`;
      return { serverId: String(server.id), roomId: String(room.id) };
    }
    async function extraUser() {
      const id = randomUUID();
      extraUsers.push(id);
      await db`INSERT INTO users(id,username,display_name) VALUES(${id},${`retain_${id.slice(0, 8)}`},'Former member fixture')`;
      return (await getUser(id))!;
    }
    async function attachment(roomId: string, published = true, author = user) {
      const bytes = Buffer.from("Private retained file");
      const key = await storeFile(bytes);
      keys.push(key);
      const [message] =
        await db`INSERT INTO chat_messages(room_id,author_id,content) VALUES(${roomId},${author.id},'Message with private file') RETURNING id`;
      const [file] =
        await db`INSERT INTO chat_attachments(room_id,owner_id,message_id,storage_key,filename,mime,bytes) VALUES(${roomId},${author.id},${published ? message.id : null},${key},'retention.txt','text/plain',${bytes.byteLength}) RETURNING id`;
      return { key, messageId: String(message.id), fileId: String(file.id) };
    }
    async function expectRetired(key: string, fileId: string) {
      expect(
        await db`SELECT 1 FROM chat_attachments WHERE id=${fileId}`,
      ).toHaveLength(0);
      const queued =
        (await db`SELECT 1 FROM storage_cleanup_jobs WHERE storage_key=${key}`)
          .length > 0;
      let missing = false;
      try {
        await readFile(key);
      } catch (error) {
        if ((error as { status?: number }).status === 404) missing = true;
        else throw error;
      }
      expect(
        queued || missing,
        "private bytes are deleted or their key survives in the durable cleanup queue",
      ).toBe(true);
      expect((await storageUsage(db, user.id)).usageBytes).toBe(0);
    }

    it("deleting a message releases attachment quota while preserving an idempotent edit tombstone", async () => {
      const { roomId } = await serverChannel();
      const file = await attachment(roomId);
      expect((await storageUsage(db, user.id)).usageBytes).toBeGreaterThan(0);
      await call(["chat", "messages", file.messageId], "DELETE");
      await expectRetired(file.key, file.fileId);
      const [message] =
        await db`SELECT content,deleted_at FROM chat_messages WHERE id=${file.messageId}`;
      expect(message.content).toBe("");
      expect(message.deleted_at).not.toBeNull();
      const firstDeletedAt = new Date(message.deleted_at).getTime();
      await call(["chat", "messages", file.messageId], "DELETE");
      expect(
        new Date(
          (
            await db`SELECT deleted_at FROM chat_messages WHERE id=${file.messageId}`
          )[0].deleted_at,
        ).getTime(),
      ).toBe(firstDeletedAt);
      await expect(
        handleSocial(
          ["chat", "messages", file.messageId],
          "PATCH",
          {
            user,
            request: new Request("http://localhost:3000/api/chat/messages"),
          },
          { content: "Resurrected text" },
        ),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("server deletion records bound and unattached upload keys before cascading metadata", async () => {
      const { serverId, roomId } = await serverChannel();
      const bound = await attachment(roomId);
      const pending = await attachment(roomId, false);
      await call(["servers", serverId], "DELETE");
      await expectRetired(bound.key, bound.fileId);
      await expectRetired(pending.key, pending.fileId);
    });

    it("channel deletion retires private files without deleting its server", async () => {
      const { serverId, roomId } = await serverChannel();
      const file = await attachment(roomId);
      await call(["servers", serverId, "channels", roomId], "DELETE");
      expect(await db`SELECT 1 FROM servers WHERE id=${serverId}`).toHaveLength(
        1,
      );
      await expectRetired(file.key, file.fileId);
    });

    it("the final group member leaving retires files before the room is cascaded", async () => {
      const [room] =
        await db`INSERT INTO chat_rooms(kind,name,owner_id) VALUES('group','Last group',${user.id}) RETURNING id`;
      rooms.push(String(room.id));
      await db`INSERT INTO chat_members(room_id,user_id) VALUES(${room.id},${user.id})`;
      const file = await attachment(String(room.id));
      await call(["chat", String(room.id), "leave"], "POST");
      await expectRetired(file.key, file.fileId);
    });

    it("the final party member leaving retires files before the party room is cascaded", async () => {
      const [party] =
        await db`INSERT INTO parties(leader_id) VALUES(${user.id}) RETURNING id`;
      parties.push(String(party.id));
      await db`INSERT INTO party_members(party_id,user_id) VALUES(${party.id},${user.id})`;
      const [room] =
        await db`INSERT INTO chat_rooms(kind,name,owner_id,party_id) VALUES('party','Last party',${user.id},${party.id}) RETURNING id`;
      const file = await attachment(String(room.id));
      await call(["parties", String(party.id), "leave"], "POST");
      await expectRetired(file.key, file.fileId);
    });

    it("a non-member cannot delete a message or server or retire its private bytes", async () => {
      const { serverId, roomId } = await serverChannel();
      const file = await attachment(roomId);
      const stranger = await extraUser();
      await expect(
        call(["chat", "messages", file.messageId], "DELETE", stranger),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        call(["servers", serverId], "DELETE", stranger),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await db`SELECT 1 FROM chat_attachments WHERE id=${file.fileId}`,
      ).toHaveLength(1);
      expect(new TextDecoder().decode(await readFile(file.key))).toBe(
        "Private retained file",
      );
      expect(
        await db`SELECT 1 FROM storage_cleanup_jobs WHERE storage_key=${file.key}`,
      ).toHaveLength(0);
    });

    it("storage failure preserves a durable retry key while releasing message quota", async () => {
      const { roomId } = await serverChannel();
      const file = await attachment(roomId);
      vi.spyOn(storage, "deleteFile").mockRejectedValue(
        new Error("Isolated storage outage"),
      );
      try {
        await expect(
          call(["chat", "messages", file.messageId], "DELETE"),
        ).resolves.toEqual({ ok: true });
        await processStorageCleanup(50, [file.key]);
        expect(
          await db`SELECT 1 FROM storage_cleanup_jobs WHERE storage_key=${file.key}`,
        ).toHaveLength(1);
        expect(new TextDecoder().decode(await readFile(file.key))).toBe(
          "Private retained file",
        );
        expect((await storageUsage(db, user.id)).usageBytes).toBe(0);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("account deletion queues former members' files from its empty owned server", async () => {
      const { serverId, roomId } = await serverChannel();
      const formerMember = await extraUser();
      await db`INSERT INTO server_members(server_id,user_id) VALUES(${serverId},${formerMember.id})`;
      const file = await attachment(roomId, true, formerMember);
      await db`DELETE FROM server_members WHERE server_id=${serverId} AND user_id=${formerMember.id}`;
      await deleteAccount(user.id, `DELETE ${user.username}`);
      await expectRetired(file.key, file.fileId);
      expect((await storageUsage(db, formerMember.id)).usageBytes).toBe(0);
      expect(await getUser(formerMember.id)).not.toBeNull();
    });

    it("account deletion queues former members' files from its empty led party", async () => {
      const formerMember = await extraUser();
      const [party] =
        await db`INSERT INTO parties(leader_id) VALUES(${user.id}) RETURNING id`;
      parties.push(String(party.id));
      await db`INSERT INTO party_members(party_id,user_id) VALUES(${party.id},${user.id}),(${party.id},${formerMember.id})`;
      const [room] =
        await db`INSERT INTO chat_rooms(kind,name,owner_id,party_id) VALUES('party','Account party',${user.id},${party.id}) RETURNING id`;
      const file = await attachment(String(room.id), true, formerMember);
      await call(["parties", String(party.id), "leave"], "POST", formerMember);
      await deleteAccount(user.id, `DELETE ${user.username}`);
      await expectRetired(file.key, file.fileId);
      expect((await storageUsage(db, formerMember.id)).usageBytes).toBe(0);
      expect(await getUser(formerMember.id)).not.toBeNull();
    });

    it("account deletion removes an empty owned group and queues former members' files", async () => {
      const formerMember = await extraUser();
      const [room] =
        await db`INSERT INTO chat_rooms(kind,name,owner_id) VALUES('group','Account group',${user.id}) RETURNING id`;
      rooms.push(String(room.id));
      await db`INSERT INTO chat_members(room_id,user_id) VALUES(${room.id},${user.id}),(${room.id},${formerMember.id})`;
      const file = await attachment(String(room.id), true, formerMember);
      await call(["chat", String(room.id), "leave"], "POST", formerMember);
      expect(
        await db`SELECT 1 FROM chat_attachments WHERE id=${file.fileId}`,
      ).toHaveLength(1);
      await deleteAccount(user.id, `DELETE ${user.username}`);
      expect(
        await db`SELECT 1 FROM chat_rooms WHERE id=${room.id}`,
      ).toHaveLength(0);
      await expectRetired(file.key, file.fileId);
      expect((await storageUsage(db, formerMember.id)).usageBytes).toBe(0);
      expect(await getUser(formerMember.id)).not.toBeNull();
    });

    it("account deletion transfers an occupied group and preserves a surviving member's files", async () => {
      const survivor = await extraUser();
      const [room] =
        await db`INSERT INTO chat_rooms(kind,name,owner_id) VALUES('group','Surviving group',${user.id}) RETURNING id`;
      rooms.push(String(room.id));
      await db`INSERT INTO chat_members(room_id,user_id) VALUES(${room.id},${user.id}),(${room.id},${survivor.id})`;
      const file = await attachment(String(room.id), true, survivor);
      await deleteAccount(user.id, `DELETE ${user.username}`);
      expect(
        await db`SELECT owner_id FROM chat_rooms WHERE id=${room.id}`,
      ).toMatchObject([{ owner_id: survivor.id }]);
      expect(
        await db`SELECT 1 FROM chat_attachments WHERE id=${file.fileId}`,
      ).toHaveLength(1);
      expect(
        await db`SELECT 1 FROM storage_cleanup_jobs WHERE storage_key=${file.key}`,
      ).toHaveLength(0);
      expect(new TextDecoder().decode(await readFile(file.key))).toBe(
        "Private retained file",
      );
      expect((await storageUsage(db, survivor.id)).usageBytes).toBeGreaterThan(
        0,
      );
    });

    it("a repeatedly failing old file does not starve a newer retry job", async () => {
      const failedKey = await storeFile(
        new TextEncoder().encode("Old private file"),
      );
      const freshKey = await storeFile(
        new TextEncoder().encode("New private file"),
      );
      keys.push(failedKey, freshKey);
      await db`INSERT INTO storage_cleanup_jobs(storage_key,created_at) VALUES(${failedKey},now()-interval '1 day'),(${freshKey},now())`;
      const realDelete = storage.deleteFile;
      vi.spyOn(storage, "deleteFile").mockImplementation(async (key) => {
        if (key === failedKey) throw new Error("One failing storage key");
        return realDelete(key);
      });
      try {
        const first = await processStorageCleanup(1, [failedKey, freshKey]);
        expect(first.removed).toBe(0);
        const second = await processStorageCleanup(1, [failedKey, freshKey]);
        expect(second.removed).toBe(1);
        expect(
          await db`SELECT attempts FROM storage_cleanup_jobs WHERE storage_key=${failedKey}`,
        ).toMatchObject([{ attempts: 1 }]);
        expect(
          await db`SELECT 1 FROM storage_cleanup_jobs WHERE storage_key=${freshKey}`,
        ).toHaveLength(0);
        await expect(readFile(freshKey)).rejects.toMatchObject({ status: 404 });
      } finally {
        vi.restoreAllMocks();
      }
    });

    for (const target of ["chat", "classes"] as const) {
      it(`a failed ${target} upload preserves its retry key if physical rollback fails`, async () => {
        const originalQuota = process.env.STORAGE_QUOTA_BYTES;
        const realStore = storage.storeFile;
        let uploadedKey = "";
        vi.spyOn(storage, "storeFile").mockImplementation(async (bytes) => {
          uploadedKey = await realStore(bytes);
          keys.push(uploadedKey);
          return uploadedKey;
        });
        vi.spyOn(storage, "deleteFile").mockRejectedValue(
          new Error("Isolated storage outage"),
        );
        process.env.STORAGE_QUOTA_BYTES = "1";
        try {
          const form = new FormData();
          form.set(
            "file",
            new File(["Private retained file"], "retention.txt", {
              type: "text/plain",
            }),
          );
          let upload: Promise<unknown>;
          if (target === "chat") {
            const { roomId } = await serverChannel();
            const request = new Request(
              `http://localhost:3000/api/chat/${roomId}/files`,
              { method: "POST", body: form },
            );
            upload = handleSocial(
              ["chat", roomId, "files"],
              "POST",
              { user, request },
              {},
            );
          } else {
            const [schoolClass] =
              await db`INSERT INTO school_classes(owner_id,name) VALUES(${user.id},'Failed upload fixture') RETURNING id`;
            form.set("classId", String(schoolClass.id));
            const request = new Request(
              "http://localhost:3000/api/files/upload",
              {
                method: "POST",
                headers: {
                  Origin: "http://localhost:3000",
                  "Content-Length": "4096",
                },
                body: form,
              },
            );
            upload = handleClassFile(request, user, "upload");
          }
          await expect(upload).rejects.toMatchObject({ status: 413 });
          expect(uploadedKey).not.toBe("");
          expect(
            await db`SELECT 1 FROM storage_cleanup_jobs WHERE storage_key=${uploadedKey}`,
          ).toHaveLength(1);
          expect(new TextDecoder().decode(await readFile(uploadedKey))).toBe(
            "Private retained file",
          );
          expect((await storageUsage(db, user.id)).usageBytes).toBe(0);
        } finally {
          vi.restoreAllMocks();
          if (originalQuota === undefined)
            delete process.env.STORAGE_QUOTA_BYTES;
          else process.env.STORAGE_QUOTA_BYTES = originalQuota;
        }
      });
    }
  },
);
