import { randomUUID, createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import Redis from "ioredis";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db, getUser } from "../packages/database/src/index";
import { handleSocial } from "../packages/platform/src/social";
import type { User } from "../packages/shared/src/index";
import type { LinkPreviewResult } from "../packages/platform/src/linkPreview";

const dns = vi.hoisted(() => vi.fn());
const https = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: dns }));
vi.mock("node:https", () => ({ request: https }));

describe.runIf(["1", "true"].includes(process.env.RUN_DB_TESTS ?? ""))(
  "authorized stored-message link previews",
  () => {
    const accounts: string[] = [],
      rooms: string[] = [],
      servers: string[] = [];
    let redis: Redis;
    beforeAll(() => {
      redis = new Redis(process.env.REDIS_URL!);
      redis.on("error", () => undefined);
    });
    beforeEach(() => {
      dns.mockReset();
      https.mockReset();
      dns.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      https.mockImplementation((_url, _options, callback) => {
        const request = new EventEmitter() as EventEmitter & {
          end: () => void;
          destroy: (error: Error) => void;
        };
        request.destroy = (error) => request.emit("error", error);
        request.end = () =>
          queueMicrotask(() => {
            const response = new PassThrough() as PassThrough & {
              headers: Record<string, string>;
              statusCode: number;
              complete: boolean;
            };
            response.headers = { "content-type": "text/html; charset=utf-8" };
            response.statusCode = 200;
            response.complete = true;
            callback(response);
            response.end(
              "<title>Verified public metadata</title><meta name='description' content='A bounded preview'>",
            );
          });
        return request;
      });
    });
    async function fixture(channel = false) {
      const users: User[] = [];
      for (let i = 0; i < 3; i++) {
        const id = randomUUID();
        accounts.push(id);
        await db`INSERT INTO users(id,username,display_name) VALUES(${id},${"preview_" + id.slice(0, 8)},${"Preview " + i})`;
        users.push((await getUser(id))!);
      }
      let roomId: string, serverId: string | undefined;
      if (channel) {
        const [server] =
          await db`INSERT INTO servers(owner_id,name) VALUES(${users[0].id},'Private previews') RETURNING id`;
        serverId = server.id;
        servers.push(server.id);
        await db`INSERT INTO server_members(server_id,user_id) VALUES(${server.id},${users[0].id}),(${server.id},${users[1].id})`;
        await db`INSERT INTO server_roles(server_id,name,permissions,is_default) VALUES(${server.id},'Members',${["view_channel", "embed_links"]},true)`;
        const [room] =
          await db`INSERT INTO chat_rooms(kind,name,server_id,owner_id) VALUES('channel','links',${server.id},${users[0].id}) RETURNING id`;
        roomId = room.id;
      } else {
        const [room] =
          await db`INSERT INTO chat_rooms(kind,name,owner_id) VALUES('group','Private previews',${users[0].id}) RETURNING id`;
        roomId = room.id;
        await db`INSERT INTO chat_members(room_id,user_id) VALUES(${room.id},${users[0].id}),(${room.id},${users[1].id})`;
      }
      rooms.push(roomId);
      const [message] =
        await db`INSERT INTO chat_messages(room_id,author_id,content) VALUES(${roomId},${users[0].id},'Read https://public.org/article') RETURNING id`;
      async function preview(
        who = 1,
        input: Record<string, unknown> = { roomId, messageId: message.id },
      ): Promise<LinkPreviewResult> {
        return (await handleSocial(
          ["chat", "link-preview"],
          "POST",
          {
            user: users[who],
            request: new Request(
              "http://localhost:3000/api/chat/link-preview",
              { method: "POST" },
            ),
          },
          input,
        )) as LinkPreviewResult;
      }
      return {
        users,
        roomId,
        serverId,
        messageId: message.id as string,
        preview,
      };
    }
    afterAll(async () => {
      for (const server of servers)
        await db`DELETE FROM servers WHERE id=${server}`;
      for (const room of rooms)
        await db`DELETE FROM chat_rooms WHERE id=${room}`;
      for (const id of accounts) {
        await redis.del(
          `tell-aviv:preview-rate:${createHash("sha256").update(id).digest("hex")}`,
        );
        await db`DELETE FROM users WHERE id=${id}`;
      }
      await redis.quit();
    });
    it("rejects outsiders before DNS, checks cached membership again, and forbids caller-supplied URLs", async () => {
      const { users, roomId, messageId, preview } = await fixture();
      await expect(preview(2)).rejects.toMatchObject({ status: 403 });
      await expect(
        preview(1, { roomId, messageId, url: "https://caller.org/private" }),
      ).rejects.toMatchObject({ status: 400 });
      expect(dns).not.toHaveBeenCalled();
      expect(https).not.toHaveBeenCalled();
      const first = await preview();
      expect(first.preview?.title).toBe("Verified public metadata");
      expect(Object.keys(first.preview!)).toEqual([
        "url",
        "site",
        "title",
        "description",
      ]);
      await preview();
      expect(dns).toHaveBeenCalledTimes(1);
      expect(https).toHaveBeenCalledTimes(1);
      await db`DELETE FROM chat_members WHERE room_id=${roomId} AND user_id=${users[1].id}`;
      await expect(preview()).rejects.toMatchObject({ status: 403 });
      expect(dns).toHaveBeenCalledTimes(1);
    });
    it("requires both ViewChannel and EmbedLinks in the actual channel before network access", async () => {
      const { serverId, preview } = await fixture(true);
      await db`UPDATE server_roles SET permissions=${["view_channel"]} WHERE server_id=${serverId!} AND is_default`;
      await expect(preview()).rejects.toMatchObject({ status: 403 });
      expect(dns).not.toHaveBeenCalled();
      await db`UPDATE server_roles SET permissions=${["embed_links"]} WHERE server_id=${serverId!} AND is_default`;
      await expect(preview()).rejects.toMatchObject({ status: 403 });
      expect(dns).not.toHaveBeenCalled();
      await db`UPDATE server_roles SET permissions=${["view_channel", "embed_links"]} WHERE server_id=${serverId!} AND is_default`;
      expect((await preview()).preview?.title).toBe("Verified public metadata");
      expect(dns).toHaveBeenCalledTimes(1);
    });
    it("rechecks role removal and message edits after fetching and hides the result", async () => {
      const { serverId, preview } = await fixture(true);
      dns.mockImplementationOnce(async () => {
        await db`UPDATE server_roles SET permissions=${["view_channel"]} WHERE server_id=${serverId!} AND is_default`;
        return [{ address: "93.184.216.34", family: 4 }];
      });
      await expect(preview()).rejects.toMatchObject({ status: 403 });
      expect(https).toHaveBeenCalledTimes(1);
      const second = await fixture();
      dns.mockImplementationOnce(async () => {
        await db`UPDATE chat_messages SET content='Edited https://public.org/new' WHERE id=${second.messageId}`;
        return [{ address: "93.184.216.34", family: 4 }];
      });
      await expect(second.preview()).rejects.toMatchObject({ status: 409 });
    });
    it("hides blocked or deleted messages, prevents mismatched room IDs, and fails closed on account disable", async () => {
      const { users, roomId, messageId, preview } = await fixture();
      await db`INSERT INTO user_blocks(user_id,blocked_id) VALUES(${users[1].id},${users[0].id})`;
      await expect(preview()).rejects.toMatchObject({ status: 403 });
      await db`DELETE FROM user_blocks WHERE user_id=${users[1].id}`;
      const [other] =
        await db`INSERT INTO chat_rooms(kind,name,owner_id) VALUES('group','Other',${users[1].id}) RETURNING id`;
      rooms.push(other.id);
      await db`INSERT INTO chat_members(room_id,user_id) VALUES(${other.id},${users[1].id})`;
      await expect(
        preview(1, { roomId: other.id, messageId }),
      ).rejects.toMatchObject({ status: 404 });
      await db`UPDATE chat_messages SET deleted_at=now() WHERE id=${messageId}`;
      await expect(preview()).rejects.toMatchObject({ status: 404 });
      await db`UPDATE chat_messages SET deleted_at=NULL WHERE id=${messageId}`;
      await db`UPDATE users SET disabled=true WHERE id=${users[1].id}`;
      await expect(preview()).rejects.toMatchObject({ status: 401 });
      expect(dns).not.toHaveBeenCalled();
      expect(https).not.toHaveBeenCalled();
      expect(roomId).toBeTruthy();
    });
    it("suppresses literal and mixed private DNS targets and enforces the real Redis per-user limit", async () => {
      const { messageId, preview } = await fixture();
      await db`UPDATE chat_messages SET content='https://169.254.169.254/latest/meta-data' WHERE id=${messageId}`;
      expect((await preview()).preview).toBeNull();
      expect(dns).not.toHaveBeenCalled();
      await db`UPDATE chat_messages SET content='https://public.org/article' WHERE id=${messageId}`;
      dns.mockResolvedValueOnce([
        { address: "93.184.216.34", family: 4 },
        { address: "fd00::7", family: 6 },
      ]);
      expect((await preview()).preview).toBeNull();
      expect(https).not.toHaveBeenCalled();
      for (let i = 0; i < 8; i++)
        expect((await preview()).preview?.title).toBe(
          "Verified public metadata",
        );
      await expect(preview()).rejects.toMatchObject({ status: 429 });
      expect(https).toHaveBeenCalledTimes(1);
    });
  },
);
