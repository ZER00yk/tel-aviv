import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, getUser } from "../packages/database/src/index";
import { authorizeRoom, handleSocial } from "../packages/platform/src/social";
import { handleThreadOrganization } from "../packages/platform/src/chatOrganization";
import type { User } from "../packages/shared/src/index";

interface Message {
  id: string;
}
interface Thread {
  id: string;
  name: string;
  following: boolean;
  unread: number;
  archivedAt: string | null;
  canManage: boolean;
}
interface ThreadPage {
  threads: Thread[];
  nextCursor: string | null;
}
describe.runIf(["true", "1"].includes(process.env.RUN_DB_TESTS ?? ""))(
  "thread subscriptions and group ownership",
  () => {
    const accounts: string[] = [],
      rooms: string[] = [];
    async function fixture() {
      const users: User[] = [];
      for (let i = 0; i < 4; i++) {
        const id = randomUUID();
        accounts.push(id);
        await db`INSERT INTO users(id,username,display_name) VALUES(${id},${"org_" + id.slice(0, 8)},${"Organization " + i})`;
        users.push((await getUser(id))!);
      }
      async function call<T = Record<string, unknown>>(
        who: number,
        path: string,
        method = "GET",
        input: Record<string, unknown> = {},
      ): Promise<T> {
        return (await handleSocial(
          path.split("?")[0].split("/"),
          method,
          {
            user: users[who],
            request: new Request("http://localhost:3000/api/" + path, {
              method,
            }),
          },
          input,
        )) as T;
      }
      const room = await call<{ id: string }>(0, "chat/rooms", "POST", {
        userIds: [users[1].id, users[2].id],
        name: "Organization group",
      });
      rooms.push(room.id);
      const root = await call<Message>(0, `chat/${room.id}/messages`, "POST", {
        content: "Organized conversation",
      });
      return { users, call, room: room.id, root };
    }
    afterAll(async () => {
      for (const room of rooms)
        await db`DELETE FROM chat_rooms WHERE id=${room}`;
      for (const uid of accounts) {
        await db`DELETE FROM notifications WHERE actor_id=${uid}`;
        await db`DELETE FROM chat_messages WHERE author_id=${uid}`;
        await db`DELETE FROM users WHERE id=${uid}`;
      }
    });
    it("names an empty thread, restricts moderation, and serializes archived writes", async () => {
      const { call, room, root } = await fixture();
      const first = await call<{ thread: Thread }>(
        0,
        `chat/${room}/threads/${root.id}`,
      );
      expect(first.thread.canManage).toBe(true);
      const named = await call<Thread>(
        0,
        `chat/${room}/threads/${root.id}`,
        "PATCH",
        { name: "Release planning" },
      );
      expect(named.name).toBe("Release planning");
      await expect(
        call(1, `chat/${room}/threads/${root.id}`, "PATCH", { archived: true }),
      ).rejects.toMatchObject({ status: 403 });
      await call(0, `chat/${room}/threads/${root.id}`, "PATCH", {
        archived: true,
      });
      await expect(
        call(1, `chat/${room}/messages`, "POST", {
          content: "Cannot write archived",
          threadId: root.id,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (await call<ThreadPage>(0, `chat/${room}/threads?page=true`)).threads,
      ).toHaveLength(0);
      expect(
        (
          await call<ThreadPage>(
            0,
            `chat/${room}/threads?page=true&archived=true&q=Release`,
          )
        ).threads,
      ).toMatchObject([{ id: root.id, name: "Release planning" }]);
      await call(0, `chat/${room}/threads/${root.id}`, "PATCH", {
        archived: false,
      });
      await call(1, `chat/${room}/messages`, "POST", {
        content: "Open again",
        threadId: root.id,
      });
      await expect(
        call(3, `chat/${room}/threads/${root.id}/follow`, "POST", {
          following: true,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("tracks private unread replies, sends subscriptions, and preserves explicit unfollow", async () => {
      const { call, users, room, root } = await fixture();
      await call(1, `chat/${room}/threads/${root.id}/follow`, "POST", {
        following: true,
      });
      const reply = await call<Message>(2, `chat/${room}/messages`, "POST", {
        content: "Subscribed update",
        threadId: root.id,
      });
      const details = await call<{ thread: Thread }>(
        1,
        `chat/${room}/threads/${root.id}`,
      );
      expect(details.thread).toMatchObject({ following: true, unread: 1 });
      const notes =
        await db`SELECT id,link FROM notifications WHERE user_id=${users[1].id} AND kind='thread'`;
      expect(notes).toHaveLength(1);
      expect(notes[0].link).toContain(`thread=${root.id}`);
      await call(1, `chat/${room}/threads/${root.id}/read`, "POST", {
        messageId: reply.id,
      });
      expect(
        (await call<{ thread: Thread }>(1, `chat/${room}/threads/${root.id}`))
          .thread.unread,
      ).toBe(0);
      await expect(
        call(1, `chat/${room}/threads/${root.id}/read`, "POST", {
          messageId: root.id,
        }),
      ).rejects.toMatchObject({ status: 400 });
      await call(1, `chat/${room}/threads/${root.id}/follow`, "POST", {
        following: false,
      });
      await call(1, `chat/${room}/messages`, "POST", {
        content: "Reply without resubscribing",
        threadId: root.id,
      });
      await call(2, `chat/${room}/messages`, "POST", {
        content: "No notification after unfollow",
        threadId: root.id,
      });
      expect(
        (await call<{ thread: Thread }>(1, `chat/${room}/threads/${root.id}`))
          .thread.following,
      ).toBe(false);
      expect(
        await db`SELECT id FROM notifications WHERE user_id=${users[1].id} AND kind='thread'`,
      ).toHaveLength(1);
      await call(0, `chat/${room}/members/${users[1].id}`, "DELETE");
      await call(2, `chat/${room}/messages`, "POST", {
        content: "Removed subscribers cannot receive this",
        threadId: root.id,
      });
      expect(
        await db`SELECT id FROM notifications WHERE user_id=${users[1].id} AND kind='thread'`,
      ).toHaveLength(1);
      await expect(
        call(1, `chat/${room}/threads/${root.id}`),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("does not recreate a thread subscription when membership is revoked after initial authorization", async () => {
      const { call, users, room, root } = await fixture();
      await call(0, `chat/${room}/threads/${root.id}`, "PATCH", {
        name: "Removal race",
      });
      await expect(
        handleThreadOrganization(
          ["chat", room, "threads", root.id, "follow"],
          "POST",
          users[1],
          { following: true },
          {
            authorizeRoom: async (userId, roomId, permission) => {
              const current = await authorizeRoom(userId, roomId, permission);
              return {
                id: String(current.id),
                kind: String(current.kind),
                owner_id: current.owner_id,
                server_id: current.server_id,
              };
            },
            threadAccess: async () => {
              // The owner removes this member while an already-authorized request
              // is still resolving its thread. Its eventual write must be denied.
              await call(0, `chat/${room}/members/${users[1].id}`, "DELETE");
              return { id: root.id, rootId: root.id };
            },
            requireServerPermission: async () => undefined,
            notify: async () => undefined,
          },
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await db`SELECT user_id FROM chat_thread_members WHERE thread_id=${root.id} AND user_id=${users[1].id}`,
      ).toHaveLength(0);
    });
    it("paginates more than fifty threads without losing microsecond activity ordering", async () => {
      const { call, users, room } = await fixture();
      const expected: string[] = [];
      await db.begin(async (tx) => {
        for (let index = 0; index < 55; index++) {
          const id = randomUUID();
          expected.push(id);
          await tx`INSERT INTO chat_messages(id,room_id,author_id,content,created_at) VALUES(${id},${room},${users[0].id},${"Topic " + index},date_trunc('millisecond',now())+${index}*interval '0.00001 seconds')`;
          await tx`INSERT INTO chat_threads(id,room_id,root_message_id,created_by,created_at,updated_at) SELECT id,room_id,id,author_id,created_at,created_at FROM chat_messages WHERE id=${id}`;
        }
      });
      const found: string[] = [];
      let cursor: string | null = null;
      do {
        const page: ThreadPage = await call<ThreadPage>(
          0,
          `chat/${room}/threads?page=true&limit=17${cursor ? "&before=" + cursor : ""}`,
        );
        found.push(...page.threads.map((thread) => thread.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(found).toEqual(expected.reverse());
      expect(new Set(found).size).toBe(55);
      await expect(
        call(0, `chat/${room}/threads?page=true&before=${randomUUID()}`),
      ).rejects.toMatchObject({ status: 400 });
    });
    it("keeps group changes owner-only, removes access immediately, and transfers on leave", async () => {
      const { call, users, room } = await fixture();
      await expect(
        call(1, `chat/${room}`, "PATCH", { name: "Member takeover" }),
      ).rejects.toMatchObject({ status: 403 });
      await call(0, `chat/${room}`, "PATCH", {
        name: "Study circle",
        icon: "https://example.com/group.png",
      });
      const group = await call<{ name: string; icon: string; ownerId: string }>(
        1,
        `chat/${room}/members`,
      );
      expect(group).toMatchObject({
        name: "Study circle",
        icon: "https://example.com/group.png",
        ownerId: users[0].id,
      });
      await expect(
        call(0, `chat/${room}`, "PATCH", { icon: "http://localhost/x" }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        call(1, `chat/${room}/members/${users[2].id}`, "DELETE"),
      ).rejects.toMatchObject({ status: 403 });
      await call(0, `chat/${room}/members/${users[2].id}`, "DELETE");
      await expect(call(2, `chat/${room}/messages`)).rejects.toMatchObject({
        status: 403,
      });
      await call(0, `chat/${room}/leave`, "POST");
      expect(
        (await call<{ ownerId: string }>(1, `chat/${room}/members`)).ownerId,
      ).toBe(users[1].id);
      await expect(
        call(0, `chat/${room}/members`, "POST", { userId: users[3].id }),
      ).rejects.toMatchObject({ status: 403 });
      await call(1, `chat/${room}/members`, "POST", { userId: users[3].id });
      await call(1, `chat/${room}`, "PATCH", { name: "New owner circle" });
      await call(3, `chat/${room}/leave`, "POST");
      await call(1, `chat/${room}/leave`, "POST");
      expect(await db`SELECT id FROM chat_rooms WHERE id=${room}`).toHaveLength(
        0,
      );
    });
    it("rejects member additions that conflict with any member block or target DM policy", async () => {
      const { call, users, room } = await fixture();
      await call(2, `friends/${users[3].id}/block`, "POST");
      await expect(
        call(0, `chat/${room}/members`, "POST", { userId: users[3].id }),
      ).rejects.toMatchObject({ status: 403 });
      await call(2, `friends/${users[3].id}/block`, "DELETE");
      await db`UPDATE users SET settings=${db.json({ privacy: { allowDMs: "none" } })} WHERE id=${users[3].id}`;
      await expect(
        call(0, `chat/${room}/members`, "POST", { userId: users[3].id }),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await db`SELECT user_id FROM chat_members WHERE room_id=${room} AND user_id=${users[3].id}`,
      ).toHaveLength(0);
    });
  },
);
