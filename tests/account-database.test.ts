import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import {
  deleteAccount,
  exportAccount,
  handleAccount,
  processStorageCleanup,
} from "../packages/platform/src/account";
import { storeFile, readFile, deleteFile } from "../packages/storage/src/index";
import type { User } from "@tell-aviv/shared";

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "account data ownership",
  () => {
    let owner: User, member: User, platformOwner: User;
    const keys: string[] = [];
    beforeEach(async () => {
      const suffix = randomUUID().slice(0, 8);
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      await db`INSERT INTO users(id,username,display_name,role,email) VALUES(${ids[0]},${`export_${suffix}`},'Exporter','user','self@example.test'),(${ids[1]},${`private_${suffix}`},'Other person','user','other@example.test'),(${ids[2]},${`owner_${suffix}`},'Platform owner','owner','owner@example.test')`;
      [owner, member, platformOwner] = (await Promise.all(
        ids.map(getUser),
      )) as User[];
    });
    afterEach(async () => {
      const ids = [owner.id, member.id, platformOwner.id];
      await db`DELETE FROM servers WHERE owner_id IN ${db(ids)}`;
      await db`DELETE FROM parties WHERE leader_id IN ${db(ids)}`;
      await db`DELETE FROM chat_rooms WHERE owner_id IN ${db(ids)}`;
      await db`DELETE FROM chat_messages WHERE author_id IN ${db(ids)}`;
      await db`DELETE FROM users WHERE id IN ${db(ids)}`;
      for (const key of keys.splice(0)) {
        await deleteFile(key);
        await db`DELETE FROM storage_cleanup_jobs WHERE storage_key=${key}`;
      }
    });
    it("exports only the current account without token digests, other private notes or storage keys", async () => {
      const key = await storeFile(Buffer.from("account private file"));
      keys.push(key);
      const [cls] =
        await db`INSERT INTO school_classes(owner_id,name) VALUES(${owner.id},'Exported class') RETURNING id`;
      await db`INSERT INTO school_resources(class_id,owner_id,kind,title,data) VALUES(${cls.id},${owner.id},'file','private.txt',${db.json({ key, name: "private.txt", mime: "text/plain", size: 20 })})`;
      await db`INSERT INTO friend_preferences(user_id,friend_id,note) VALUES(${owner.id},${member.id},'my private note'),(${member.id},${owner.id},'other private secret')`;
      await db`INSERT INTO sessions(id,token_hash,user_id,expires_at) VALUES(${randomUUID()},'never export this session digest',${owner.id},now()+interval '1 hour')`;
      await db`INSERT INTO game_states(user_id,game_id,data) VALUES(${owner.id},'casino',${db.json({ hiddenDealer: "never export future cards", mines: [1, 2, 3] })})`;
      const response = await handleAccount(
        ["account", "export"],
        "GET",
        {
          user: owner,
          request: new Request("http://localhost:3000/api/account/export"),
        },
        {},
      );
      expect(response).toBeInstanceOf(Response);
      const content = await (response as Response).text();
      expect(content).toContain("my private note");
      expect(content).toContain("self@example.test");
      for (const secret of [
        key,
        "other private secret",
        "other@example.test",
        "never export this session digest",
        "never export future cards",
      ])
        expect(content).not.toContain(secret);
      expect((await exportAccount(member.id)).resources).toHaveLength(0);
    });
    it("requires exact confirmation and preserves owner access", async () => {
      await expect(
        deleteAccount(owner.id, `DELETE ${member.username}`),
      ).rejects.toMatchObject({ status: 400 });
      expect(await getUser(owner.id)).not.toBeNull();
      await expect(
        deleteAccount(platformOwner.id, `DELETE ${platformOwner.username}`),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("deletes private data and sessions while transferring shared leadership and retrying file cleanup", async () => {
      const key = await storeFile(Buffer.from("erase private bytes"));
      keys.push(key);
      const [cls] =
        await db`INSERT INTO school_classes(owner_id,name) VALUES(${owner.id},'Private class') RETURNING id`;
      const [resource] =
        await db`INSERT INTO school_resources(class_id,owner_id,kind,title,data) VALUES(${cls.id},${owner.id},'file','erase.txt',${db.json({ key, name: "erase.txt", mime: "text/plain", size: 19 })}) RETURNING id`;
      await db`INSERT INTO school_shares(resource_id,user_id,permission) VALUES(${resource.id},${member.id},'view')`;
      const [server] =
        await db`INSERT INTO servers(owner_id,name) VALUES(${owner.id},'Shared neighborhood') RETURNING id`;
      await db`INSERT INTO server_members(server_id,user_id) VALUES(${server.id},${owner.id}),(${server.id},${member.id})`;
      const [party] =
        await db`INSERT INTO parties(leader_id) VALUES(${owner.id}) RETURNING id`;
      await db`INSERT INTO party_members(party_id,user_id) VALUES(${party.id},${owner.id}),(${party.id},${member.id})`;
      const [room] =
        await db`INSERT INTO chat_rooms(kind,name,owner_id) VALUES('group','Shared room',${owner.id}) RETURNING id`;
      await db`INSERT INTO chat_members(room_id,user_id) VALUES(${room.id},${owner.id}),(${room.id},${member.id})`;
      await db`INSERT INTO chat_messages(room_id,author_id,content) VALUES(${room.id},${owner.id},'Remove my message'),(${room.id},${member.id},'Keep other message')`;
      await db`INSERT INTO sessions(id,token_hash,user_id,expires_at) VALUES(${randomUUID()},${randomUUID()},${owner.id},now()+interval '1 day')`;
      await deleteAccount(owner.id, `DELETE ${owner.username}`);
      expect(await getUser(owner.id)).toBeNull();
      expect(
        await db`SELECT 1 FROM sessions WHERE user_id=${owner.id}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT 1 FROM school_resources WHERE id=${resource.id}`,
      ).toHaveLength(0);
      expect(
        (await db`SELECT owner_id FROM servers WHERE id=${server.id}`)[0]
          .owner_id,
      ).toBe(member.id);
      expect(
        (await db`SELECT leader_id FROM parties WHERE id=${party.id}`)[0]
          .leader_id,
      ).toBe(member.id);
      expect(
        (await db`SELECT owner_id FROM chat_rooms WHERE id=${room.id}`)[0]
          .owner_id,
      ).toBe(member.id);
      expect(
        (
          await db`SELECT content FROM chat_messages WHERE room_id=${room.id}`
        ).map((row) => row.content),
      ).toEqual(["Keep other message"]);
      expect(
        await db`SELECT 1 FROM storage_cleanup_jobs WHERE storage_key=${key}`,
      ).toHaveLength(1);
      await processStorageCleanup(50, [key]);
      expect(
        await db`SELECT 1 FROM storage_cleanup_jobs WHERE storage_key=${key}`,
      ).toHaveLength(0);
      await expect(readFile(key)).rejects.toMatchObject({ status: 404 });
    });
  },
);
