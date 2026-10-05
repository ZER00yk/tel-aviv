import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, getUser } from "../packages/database/src/index";
import {
  canonicalPair,
  canGrant,
  publicProfile,
  handleSocial,
  authorizeRoom,
} from "../packages/platform/src/social";
import { deleteFile } from "../packages/storage/src/index";
import type { User } from "../packages/shared/src/index";

const sample: User = {
  id: randomUUID(),
  username: "Example",
  displayName: "Example",
  avatar: null,
  banner: null,
  bio: "Hello",
  status: "Working",
  xp: 400,
  role: "user",
  settings: { privacy: { showFriends: false }, secret: "not public" },
};
it("canonical friendship identity is symmetric", () => {
  const a = randomUUID(),
    b = randomUUID();
  expect(canonicalPair(a, b)).toEqual(canonicalPair(b, a));
  expect(canonicalPair(a, b)[0] < canonicalPair(a, b)[1]).toBe(true);
});
it("roles cannot grant permissions beyond their own", () => {
  expect(canGrant(["manage_server"], ["view_channel"], false)).toBe(false);
  expect(
    canGrant(["view_channel"], ["view_channel", "send_messages"], false),
  ).toBe(true);
  expect(canGrant(["manage_server"], [], true)).toBe(true);
});
it("public profiles project only safe explicit fields", () => {
  expect(publicProfile(sample)).not.toHaveProperty("settings");
  expect(publicProfile(sample)).not.toHaveProperty("email");
  expect(publicProfile(sample).level).toBe(3);
});

// Run against a migrated disposable/local database with RUN_DB_TESTS=1.
describe.runIf(["1", "true"].includes(process.env.RUN_DB_TESTS || ""))(
  "persisted social authorization",
  () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const users: User[] = [];
    const rooms: string[] = [];
    const servers: string[] = [];
    const parties: string[] = [];
    async function call(
      who: number,
      path: string,
      method = "GET",
      input: Record<string, unknown> = {},
      request?: Request,
    ) {
      return handleSocial(
        path.split("/"),
        method,
        {
          user: users[who],
          request:
            request ||
            new Request("http://localhost:3000/api/" + path, { method }),
        },
        input,
      );
    }
    beforeAll(async () => {
      for (let i = 0; i < ids.length; i++) {
        const username = "social_" + ids[i].slice(0, 8);
        await db`INSERT INTO users(id,username,display_name) VALUES(${ids[i]},${username},${"Social " + i})`;
        users.push((await getUser(ids[i]))!);
      }
    });
    afterAll(async () => {
      for (const uid of ids) {
        const uploads =
          await db`SELECT storage_key FROM chat_attachments WHERE owner_id=${uid}`;
        for (const upload of uploads) await deleteFile(upload.storage_key);
      }
      for (const server of servers)
        await db`DELETE FROM servers WHERE id=${server}`;
      for (const party of parties)
        await db`DELETE FROM parties WHERE id=${party}`;
      for (const room of rooms)
        await db`DELETE FROM chat_rooms WHERE id=${room}`;
      for (const uid of ids) {
        await db`DELETE FROM notifications WHERE actor_id=${uid}`;
        await db`DELETE FROM chat_messages WHERE author_id=${uid}`;
        await db`DELETE FROM users WHERE id=${uid}`;
      }
    });
    it("rejects authority fields during profile editing and does not expose private settings", async () => {
      await expect(
        call(0, "profile", "POST", { role: "owner", xp: 100000 }),
      ).rejects.toMatchObject({ status: 400 });
      await call(0, "profile", "POST", {
        bio: "A safe bio",
        settings: { privacy: { showFriends: false } },
      });
      const p = (await call(1, `users/${ids[0]}`)) as Record<string, unknown>;
      expect(p.bio).toBe("A safe bio");
      expect(p).not.toHaveProperty("settings");
      expect(p).not.toHaveProperty("email");
    });
    it("makes friend acceptance directional and preferences owner-private", async () => {
      await call(0, "friends/request", "POST", { userId: ids[1] });
      await expect(
        call(2, `friends/${ids[0]}/accept`, "POST"),
      ).rejects.toMatchObject({ status: 404 });
      await call(1, `friends/${ids[0]}/accept`, "POST");
      await call(0, `friends/${ids[1]}/preferences`, "POST", {
        note: "only I see this",
        nickname: "Buddy",
        favorite: true,
      });
      const own = (await call(0, "friends")) as {
        friends: Record<string, unknown>[];
      };
      const other = (await call(1, "friends")) as {
        friends: Record<string, unknown>[];
      };
      expect(own.friends[0].note).toBe("only I see this");
      expect(other.friends[0].note).toBe("");
    });
    it("persists DM replies and rejects a nonmember and cross-room replies", async () => {
      const room = (await call(0, "chat/rooms", "POST", {
        userIds: [ids[1]],
      })) as { id: string };
      rooms.push(room.id);
      const message = (await call(0, `chat/${room.id}/messages`, "POST", {
        content: "Persistent hello",
      })) as { id: string };
      await call(1, `chat/${room.id}/messages`, "POST", {
        content: "Reply",
        replyTo: message.id,
      });
      const history = (await call(1, `chat/${room.id}/messages`)) as {
        messages: Record<string, unknown>[];
      };
      expect(history.messages).toHaveLength(2);
      expect(history.messages[1].replyTo).toBe(message.id);
      await expect(call(2, `chat/${room.id}/messages`)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        call(0, "chat/global/messages", "POST", {
          content: "Bad reply",
          replyTo: message.id,
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        call(1, `chat/messages/${message.id}`, "PATCH", {
          content: "Impersonated edit",
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("blocks existing DM traffic and removes the accepted friendship", async () => {
      const room = (await call(0, "chat/rooms", "POST", {
        userIds: [ids[1]],
      })) as { id: string };
      await call(1, `friends/${ids[0]}/block`, "POST");
      await expect(authorizeRoom(ids[0], room.id)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        call(0, `chat/${room.id}/messages`, "POST", { content: "Blocked" }),
      ).rejects.toMatchObject({ status: 403 });
      const list = (await call(0, "friends")) as { friends: unknown[] };
      expect(list.friends).toHaveLength(0);
      await call(1, `friends/${ids[0]}/unblock`, "POST");
    });
    it("enforces private server membership, invite usage, channel and role permissions", async () => {
      const server = (await call(0, "servers", "POST", {
        name: "Private social test",
      })) as { id: string };
      servers.push(server.id);
      await expect(call(1, `servers/${server.id}`)).rejects.toMatchObject({
        status: 403,
      });
      const invite = (await call(0, `servers/${server.id}/invites`, "POST", {
        maxUses: 1,
      })) as { code: string };
      const attempts = await Promise.allSettled([
        call(1, `invites/${invite.code}/join`, "POST"),
        call(2, `invites/${invite.code}/join`, "POST"),
      ]);
      expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
      const joined = attempts[0].status === "fulfilled" ? 1 : 2;
      await expect(
        call(joined, `servers/${server.id}/roles`, "POST", {
          name: "Escalation",
          permissions: ["manage_server"],
        }),
      ).rejects.toMatchObject({ status: 403 });
      const role = (await call(0, `servers/${server.id}/roles`, "POST", {
        name: "Private access",
        position: 2,
        permissions: ["view_channel"],
      })) as { id: string };
      const channel = (await call(0, `servers/${server.id}/channels`, "POST", {
        name: "secret",
        restrictedRoleId: role.id,
      })) as { id: string };
      await expect(
        authorizeRoom(ids[joined], channel.id),
      ).rejects.toMatchObject({ status: 403 });
      await call(0, `servers/${server.id}/members/${ids[joined]}`, "POST", {
        roleIds: [role.id],
      });
      expect((await authorizeRoom(ids[joined], channel.id)).id).toBe(
        channel.id,
      );
      const announcement = (await call(
        0,
        `servers/${server.id}/channels`,
        "POST",
        { name: "news", type: "announcement" },
      )) as { id: string };
      await expect(
        call(joined, `chat/${announcement.id}/messages`, "POST", {
          content: "Unauthorized announcement",
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("requires party invites and keeps leadership/readiness durable", async () => {
      const party = (await call(0, "parties", "POST")) as { id: string };
      parties.push(party.id);
      await expect(
        call(1, `parties/${party.id}/join`, "POST"),
      ).rejects.toMatchObject({ status: 403 });
      await call(0, `parties/${party.id}/invite`, "POST", { userId: ids[1] });
      await call(1, `parties/${party.id}/join`, "POST");
      await expect(
        call(1, `parties/${party.id}/game`, "POST", { gameId: "party-games" }),
      ).rejects.toMatchObject({ status: 403 });
      await call(0, `parties/${party.id}/game`, "POST", {
        gameId: "party-games",
      });
      await expect(
        call(0, `parties/${party.id}/launch`, "POST"),
      ).rejects.toMatchObject({ status: 409 });
      await call(0, `parties/${party.id}/ready`, "POST", { ready: true });
      await call(1, `parties/${party.id}/ready`, "POST", { ready: true });
      const launch = (await call(0, `parties/${party.id}/launch`, "POST")) as {
        gameId: string;
      };
      expect(launch.gameId).toBe("party-games");
      await call(0, `parties/${party.id}/leave`, "POST");
      const recovered = (await call(1, `parties/${party.id}`)) as {
        leaderId: string;
      };
      expect(recovered.leaderId).toBe(ids[1]);
    });
    it("binds only owned room uploads and revokes download when messages are deleted", async () => {
      const room = (await call(0, "chat/rooms", "POST", {
        userIds: [ids[2]],
      })) as { id: string };
      const form = new FormData();
      form.set(
        "file",
        new File(["a room-private attachment"], "notes.txt", {
          type: "text/plain",
        }),
      );
      const upload = (await call(
        0,
        `chat/${room.id}/files`,
        "POST",
        {},
        new Request(`http://localhost:3000/api/chat/${room.id}/files`, {
          method: "POST",
          body: form,
        }),
      )) as { id: string };
      const discardedForm = new FormData();
      discardedForm.set(
        "file",
        new File(["discard private upload"], "discard.txt", {
          type: "text/plain",
        }),
      );
      const discarded = (await call(
        0,
        `chat/${room.id}/files`,
        "POST",
        {},
        new Request(`http://localhost:3000/api/chat/${room.id}/files`, {
          method: "POST",
          body: discardedForm,
        }),
      )) as { id: string };
      await expect(
        call(2, `chat/files/${discarded.id}`, "DELETE"),
      ).rejects.toMatchObject({ status: 404 });
      await call(0, `chat/files/${discarded.id}`, "DELETE");
      await expect(call(0, `chat/files/${discarded.id}`)).rejects.toMatchObject(
        { status: 404 },
      );
      await expect(call(2, `chat/files/${upload.id}`)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        call(2, `chat/${room.id}/messages`, "POST", {
          attachmentIds: [upload.id],
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        call(0, `chat/${room.id}/messages`, "POST", {
          attachmentIds: [randomUUID()],
        }),
      ).rejects.toMatchObject({ status: 400 });
      const message = (await call(0, `chat/${room.id}/messages`, "POST", {
        attachmentIds: [upload.id],
      })) as { id: string };
      await expect(
        call(0, `chat/files/${upload.id}`, "DELETE"),
      ).rejects.toMatchObject({ status: 409 });
      const download = (await call(2, `chat/files/${upload.id}`)) as Response;
      expect(await download.text()).toBe("a room-private attachment");
      await expect(call(1, `chat/files/${upload.id}`)).rejects.toMatchObject({
        status: 403,
      });
      await call(0, `chat/messages/${message.id}`, "DELETE");
      await expect(call(2, `chat/files/${upload.id}`)).rejects.toMatchObject({
        status: 404,
      });
    });
    it("only votes in the current poll and prevents multiple single-choice votes", async () => {
      const room = (await call(0, "chat/rooms", "POST", {
        userIds: [ids[2]],
        name: "Poll test",
      })) as { id: string };
      rooms.push(room.id);
      await call(0, `chat/${room.id}/messages`, "POST", {
        poll: { question: "Choose?", options: ["A", "B"] },
      });
      const history = (await call(2, `chat/${room.id}/messages`)) as {
        messages: { poll: { id: string; options: { id: string }[] } }[];
      };
      const poll = history.messages.find((m) => m.poll)!.poll;
      await expect(
        call(2, `chat/polls/${poll.id}/vote`, "POST", {
          optionIds: poll.options.map((o) => o.id),
        }),
      ).rejects.toMatchObject({ status: 400 });
      await call(2, `chat/polls/${poll.id}/vote`, "POST", {
        optionIds: [poll.options[0].id],
      });
      await expect(
        call(1, `chat/polls/${poll.id}/vote`, "POST", {
          optionIds: [poll.options[0].id],
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("serializes concurrent chat sends without awarding messaging XP", async () => {
      const room = (await call(0, "chat/rooms", "POST", {
        userIds: [ids[2]],
      })) as { id: string };
      const before = (
        await db`SELECT count(*)::int AS count FROM chat_messages WHERE author_id=${ids[0]} AND created_at>now()-interval '10 seconds'`
      )[0].count as number;
      const sends = await Promise.allSettled(
        Array.from({ length: 12 }, (_, i) =>
          call(0, `chat/${room.id}/messages`, "POST", {
            content: "limit check " + i,
          }),
        ),
      );
      expect(sends.filter((s) => s.status === "fulfilled")).toHaveLength(
        Math.max(0, 10 - before),
      );
      expect(
        sends.some((s) => s.status === "rejected" && s.reason.status === 429),
      ).toBe(true);
      expect((await getUser(ids[0]))!.xp).toBe(0);
    });
  },
);
