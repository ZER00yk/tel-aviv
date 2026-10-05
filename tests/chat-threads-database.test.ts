import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, getUser } from "../packages/database/src/index";
import { handleSocial } from "../packages/platform/src/social";
import { deleteFile } from "../packages/storage/src/index";
import type { User } from "../packages/shared/src/index";

interface Message {
  id: string;
  content: string;
  threadId: string | null;
  threadReplyCount: number;
  deletedAt: string | null;
  attachments: { id: string }[];
}
interface History {
  messages: Message[];
  nextCursor: string | null;
  thread?: { id: string; root: Message | null };
}

describe.runIf(["1", "true"].includes(process.env.RUN_DB_TESTS || ""))(
  "dedicated persisted chat threads",
  () => {
    const ids: string[] = [],
      rooms: string[] = [],
      servers: string[] = [];
    async function fixture() {
      const users: User[] = [];
      for (let i = 0; i < 3; i++) {
        const id = randomUUID();
        ids.push(id);
        await db`INSERT INTO users(id,username,display_name) VALUES(${id},${"thread_" + id.slice(0, 8)},${"Thread " + i})`;
        users.push((await getUser(id))!);
      }
      async function call<T = Record<string, unknown>>(
        who: number,
        path: string,
        method = "GET",
        input: Record<string, unknown> = {},
        request?: Request,
      ): Promise<T> {
        return (await handleSocial(
          path.split("?")[0].split("/"),
          method,
          {
            user: users[who],
            request:
              request ||
              new Request("http://localhost:3000/api/" + path, { method }),
          },
          input,
        )) as T;
      }
      const room = await call<{ id: string }>(0, "chat/rooms", "POST", {
        userIds: [users[1].id],
      });
      rooms.push(room.id);
      const root = await call<Message>(0, `chat/${room.id}/messages`, "POST", {
        content: "Thread root",
      });
      return { call, users, room: room.id, root };
    }
    afterAll(async () => {
      for (const uid of ids) {
        const uploads =
          await db`SELECT storage_key FROM chat_attachments WHERE owner_id=${uid}`;
        for (const upload of uploads) await deleteFile(upload.storage_key);
      }
      for (const server of servers)
        await db`DELETE FROM servers WHERE id=${server}`;
      for (const room of rooms)
        await db`DELETE FROM chat_rooms WHERE id=${room}`;
      for (const uid of ids) {
        await db`DELETE FROM notifications WHERE actor_id=${uid}`;
        await db`DELETE FROM chat_messages WHERE author_id=${uid}`;
        await db`DELETE FROM users WHERE id=${uid}`;
      }
    });
    it("keeps thread replies separate, searchable and summarized at the root", async () => {
      const { call, room, root } = await fixture();
      const reply = await call<Message>(1, `chat/${room}/messages`, "POST", {
        content: "Dedicated astronaut discussion",
        threadId: root.id,
      });
      const timeline = await call<History>(0, `chat/${room}/messages`);
      expect(timeline.messages.map((message) => message.id)).toEqual([root.id]);
      expect(timeline.messages[0].threadReplyCount).toBe(1);
      const thread = await call<History>(0, `chat/${room}/threads/${root.id}`);
      expect(thread.thread?.root?.id).toBe(root.id);
      expect(thread.messages.map((message) => message.id)).toEqual([reply.id]);
      expect(thread.messages[0].threadId).toBe(root.id);
      const search = await call<History>(
        0,
        `chat/${room}/messages?q=astronaut`,
      );
      expect(search.messages[0].id).toBe(reply.id);
      expect(search.messages[0].threadId).toBe(root.id);
      const list = await call<{ id: string; replyCount: number }[]>(
        0,
        `chat/${room}/threads`,
      );
      expect(list).toMatchObject([{ id: root.id, replyCount: 1 }]);
    });
    it("inherits private membership, room identity and reply scope", async () => {
      const { call, users, room, root } = await fixture();
      const reply = await call<Message>(1, `chat/${room}/messages`, "POST", {
        content: "Private reply",
        threadId: root.id,
      });
      await expect(
        call(2, `chat/${room}/threads/${root.id}`),
      ).rejects.toMatchObject({ status: 403 });
      await expect(call(2, `chat/${room}/threads`)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        call(2, `chat/${room}/messages`, "POST", {
          content: "Intrusion",
          threadId: root.id,
        }),
      ).rejects.toMatchObject({ status: 403 });
      const other = await call<{ id: string }>(0, "chat/rooms", "POST", {
        userIds: [users[2].id],
      });
      rooms.push(other.id);
      await expect(
        call(0, `chat/${other.id}/threads/${root.id}`),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        call(0, `chat/${other.id}/messages`, "POST", {
          content: "Wrong room",
          threadId: root.id,
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        call(0, `chat/${room}/messages`, "POST", {
          content: "Wrong feed",
          replyTo: reply.id,
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        call(0, `chat/${room}/threads/${reply.id}`),
      ).rejects.toMatchObject({ status: 400 });
      const replyToReply = await call<Message>(
        0,
        `chat/${room}/messages`,
        "POST",
        { content: "Scoped response", replyTo: reply.id, threadId: root.id },
      );
      expect(replyToReply.threadId).toBe(root.id);
    });
    it("keeps thread pagination and cursors within the selected conversation", async () => {
      const { call, room, root } = await fixture();
      const first = await call<Message>(1, `chat/${room}/messages`, "POST", {
        content: "First thread reply",
        threadId: root.id,
      });
      const second = await call<Message>(1, `chat/${room}/messages`, "POST", {
        content: "Second thread reply",
        threadId: root.id,
      });
      // PostgreSQL timestamps carry microseconds. Both messages can share the
      // same JavaScript millisecond without becoming the same history cursor.
      await db`UPDATE chat_messages SET created_at=date_trunc('millisecond',now())+CASE WHEN id=${first.id} THEN interval '0.0001 seconds' ELSE interval '0.0009 seconds' END WHERE id IN (${first.id},${second.id})`;
      const page = await call<History>(
        0,
        `chat/${room}/threads/${root.id}?limit=1`,
      );
      expect(page.messages.map((message) => message.id)).toEqual([second.id]);
      expect(page.nextCursor).toBe(second.id);
      const older = await call<History>(
        0,
        `chat/${room}/threads/${root.id}?limit=1&before=${page.nextCursor}`,
      );
      expect(older.messages.map((message) => message.id)).toEqual([first.id]);
      await expect(
        call(0, `chat/${room}/threads/${root.id}?before=${root.id}`),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        call(0, `chat/${room}/messages?before=${first.id}`),
      ).rejects.toMatchObject({ status: 400 });
    });
    it("preserves other authors' replies when the root is tombstoned or physically removed", async () => {
      const { call, room, root } = await fixture();
      const reply = await call<Message>(1, `chat/${room}/messages`, "POST", {
        content: "Preserved reply",
        threadId: root.id,
      });
      await call(0, `chat/messages/${root.id}`, "DELETE");
      const deleted = await call<History>(1, `chat/${room}/threads/${root.id}`);
      expect(deleted.thread?.root?.content).toBe("");
      expect(deleted.thread?.root?.deletedAt).toBeTruthy();
      await db`DELETE FROM chat_messages WHERE id=${root.id}`;
      const removed = await call<History>(1, `chat/${room}/threads/${root.id}`);
      expect(removed.thread?.root).toBeNull();
      expect(removed.messages[0].id).toBe(reply.id);
      expect(
        (await call<History>(1, `chat/${room}/messages`)).messages,
      ).toEqual([]);
      expect(await call(1, `chat/${room}/threads`)).toMatchObject([
        { id: root.id, rootContent: null },
      ]);
      await call(1, `chat/${room}/messages`, "POST", {
        content: "Conversation continues",
        threadId: root.id,
      });
      expect(
        (await call<History>(1, `chat/${room}/threads/${root.id}`)).messages,
      ).toHaveLength(2);
    });
    it("enforces blocks again when opening or writing a thread", async () => {
      const { call, users, room, root } = await fixture();
      await call(1, `chat/${room}/messages`, "POST", {
        content: "Before block",
        threadId: root.id,
      });
      await call(0, `friends/${users[1].id}/block`, "POST");
      await expect(
        call(1, `chat/${room}/threads/${root.id}`),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        call(1, `chat/${room}/messages`, "POST", {
          content: "After block",
          threadId: root.id,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("filters blocked authors and reply counts in public threads", async () => {
      const { call, users } = await fixture();
      const root = await call<Message>(0, "chat/global/messages", "POST", {
        content: "Public thread fixture",
      });
      await call(1, "chat/global/messages", "POST", {
        content: "Hidden public reply",
        threadId: root.id,
      });
      await call(2, `friends/${users[1].id}/block`, "POST");
      const visible = await call<History>(2, `chat/global/threads/${root.id}`);
      expect(visible.thread?.root?.threadReplyCount).toBe(0);
      expect(visible.messages).toEqual([]);
      expect(
        (await call<{ id: string }[]>(2, "chat/global/threads")).some(
          (thread) => thread.id === root.id,
        ),
      ).toBe(false);
      await call(2, `friends/${users[0].id}/block`, "POST");
      await expect(
        call(2, `chat/global/threads/${root.id}`),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("does not bypass announcement-channel send permissions", async () => {
      const { call, users } = await fixture();
      const server = await call<{ id: string }>(0, "servers", "POST", {
        name: "Threads permissions",
        discoverable: true,
      });
      servers.push(server.id);
      await call(1, `servers/${server.id}/join`, "POST");
      const channel = await call<{ id: string }>(
        0,
        `servers/${server.id}/channels`,
        "POST",
        { name: "announcements", type: "announcement" },
      );
      const root = await call<Message>(
        0,
        `chat/${channel.id}/messages`,
        "POST",
        { content: "Manager announcement" },
      );
      expect(users[1].role).toBe("user");
      await expect(
        call(1, `chat/${channel.id}/messages`, "POST", {
          content: "Thread bypass",
          threadId: root.id,
        }),
      ).rejects.toMatchObject({ status: 403 });
      const thread = await call<History>(
        1,
        `chat/${channel.id}/threads/${root.id}`,
      );
      expect(thread.thread?.root?.content).toBe("Manager announcement");
    });
    it("binds thread attachments atomically and protects their private downloads", async () => {
      const { call, room, root } = await fixture();
      const body = new FormData();
      body.set(
        "file",
        new Blob(["Private thread document"], { type: "text/plain" }),
        "thread.txt",
      );
      const upload = await call<{ id: string }>(
        1,
        `chat/${room}/files`,
        "POST",
        {},
        new Request(`http://localhost:3000/api/chat/${room}/files`, {
          method: "POST",
          body,
        }),
      );
      const reply = await call<Message>(1, `chat/${room}/messages`, "POST", {
        threadId: root.id,
        attachmentIds: [upload.id],
      });
      expect(reply.attachments[0].id).toBe(upload.id);
      expect((await call<Response>(0, `chat/files/${upload.id}`)).status).toBe(
        200,
      );
      await expect(call(2, `chat/files/${upload.id}`)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        call(1, `chat/${room}/messages`, "POST", {
          threadId: root.id,
          attachmentIds: [upload.id],
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
    it("shares the durable room flood limit rather than gaining a thread-specific allowance", async () => {
      const { call, room, root } = await fixture();
      for (let i = 0; i < 9; i++)
        await call(0, `chat/${room}/messages`, "POST", {
          content: `Limited ${i}`,
          ...(i % 2 ? { threadId: root.id } : {}),
        });
      await expect(
        call(0, `chat/${room}/messages`, "POST", {
          content: "Eleventh send",
          threadId: root.id,
        }),
      ).rejects.toMatchObject({ status: 429 });
    });
  },
);
