import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import { handleAdmin } from "../packages/platform/src/admin";
import { processStorageCleanup } from "../packages/platform/src/account";
import { handleGames } from "../packages/platform/src/games";
import { starterLevel } from "../packages/platform/src/classes/models";
import { deleteFile, readFile, storeFile } from "../packages/storage/src/index";
import { eventChannel, type DomainEvent } from "../apps/realtime/src/events";

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "confirmed administrative recovery",
  () => {
    const suffix = randomUUID().slice(0, 8),
      ids: string[] = [],
      keys: string[] = [];
    let owner: User, ordinary: User;
    const context = (user: User) => ({
      user,
      request: new Request("http://localhost:3000/api/admin"),
    });
    async function fixture(label: string, role: User["role"] = "user") {
      const id = randomUUID();
      ids.push(id);
      await db`INSERT INTO users(id,username,display_name,role) VALUES(${id},${`rec_${label}_${suffix}`},${label},${role})`;
      return (await getUser(id))!;
    }
    const command = (
      path: string[],
      body: Record<string, unknown>,
      actor = owner,
    ) => handleAdmin(path, "POST", context(actor), body);
    const save = (target: User, revision: number, data: unknown) =>
      handleGames(["games", "ego-trip", "save"], "POST", context(target), {
        expectedRevision: revision,
        schemaVersion: 1,
        data,
      });
    const resetBody = (
      target: User,
      operationId = randomUUID(),
      gameId = "ego-trip",
    ) => ({
      operationId,
      gameId,
      reason: "Isolated save reset test",
      confirmation: `RESET SAVE ${gameId} ${target.username}`,
    });
    const removeBody = (
      id: string,
      kind: "chat-message" | "public-creation",
      operationId = randomUUID(),
    ) => ({
      operationId,
      id,
      kind,
      reason: "Isolated emergency removal test",
      confirmation: `REMOVE ${kind === "chat-message" ? "MESSAGE" : "CREATION"} ${id}`,
    });
    beforeAll(async () => {
      owner = await fixture("owner", "owner");
      ordinary = await fixture("user");
    });
    afterAll(async () => {
      for (const key of keys) {
        await deleteFile(key).catch(() => undefined);
        await db`DELETE FROM storage_cleanup_jobs WHERE storage_key=${key}`;
      }
      for (const id of ids)
        await db`DELETE FROM chat_rooms WHERE owner_id=${id}`;
      for (const id of ids) await db`DELETE FROM users WHERE id=${id}`;
    });
    it("rejects forged roles and unsupported/private content operations before mutation", async () => {
      const actor = { ...ordinary, role: "owner" as const };
      await expect(
        command(["admin", "leaderboards", "reset"], {}, actor),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        command(
          ["admin", "users", ordinary.id, "save-reset"],
          resetBody(ordinary),
          actor,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        command(
          ["admin", "content", "remove"],
          removeBody(randomUUID(), "chat-message"),
          actor,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        command(["admin", "content", "remove"], {
          ...removeBody(randomUUID(), "chat-message"),
          kind: "school-file",
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
    it("validates leaderboard game, category, UTC dates and exact confirmation", async () => {
      const scope = {
        gameId: "incremental",
        category: "default",
        period: "daily",
        periodKey: "2001-01-01",
      };
      const base = {
        ...scope,
        operationId: randomUUID(),
        reason: "Scope validation fixture",
        confirmation: "RESET LEADERBOARD incremental default daily 2001-01-01",
      };
      for (const change of [
        { gameId: "unknown" },
        { gameId: "ego-trip" },
        { category: "unknown" },
        { periodKey: "2001-02-30" },
        { period: "weekly", periodKey: "2001-01-02" },
        { period: "all", periodKey: "2001-01-01" },
        { confirmation: "yes" },
      ]) {
        await expect(
          command(["admin", "leaderboards", "reset"], { ...base, ...change }),
        ).rejects.toMatchObject({ status: 400 });
      }
      expect(
        await db`SELECT id FROM admin_audit_log WHERE id=${base.operationId}`,
      ).toHaveLength(0);
    });
    it("resets exactly one leaderboard scope and retries cannot erase later scores", async () => {
      const target = await fixture("scores");
      const periodKey = "2001-01-01";
      // The historical fixture scope must not contain someone else's data.
      expect(
        await db`SELECT user_id FROM leaderboard_entries WHERE game_id='incremental' AND category='default' AND period='daily' AND period_key=${periodKey}`,
      ).toHaveLength(0);
      for (const [game, category, period] of [
        ["incremental", "default", "daily"],
        ["incremental", "production", "daily"],
        ["incremental", "default", "weekly"],
        ["tower-defense", "default", "daily"],
      ]) {
        await db`INSERT INTO leaderboard_entries(user_id,game_id,category,period,period_key,score) VALUES(${target.id},${game},${category},${period},${periodKey},100)`;
      }
      const operationId = randomUUID();
      const body = {
        operationId,
        gameId: "incremental",
        category: "default",
        period: "daily",
        periodKey,
        reason: "Historical fixture score cleanup",
        confirmation: `RESET LEADERBOARD incremental default daily ${periodKey}`,
      };
      const results = await Promise.all([
        command(["admin", "leaderboards", "reset"], body),
        command(["admin", "leaderboards", "reset"], body),
      ]);
      expect(
        results.filter((result) => (result as { replayed?: boolean }).replayed),
      ).toHaveLength(1);
      expect(
        await db`SELECT user_id FROM leaderboard_entries WHERE user_id=${target.id}`,
      ).toHaveLength(3);
      await db`INSERT INTO leaderboard_entries(user_id,game_id,category,period,period_key,score) VALUES(${target.id},'incremental','default','daily',${periodKey},200)`;
      await command(["admin", "leaderboards", "reset"], body);
      expect(
        await db`SELECT user_id FROM leaderboard_entries WHERE user_id=${target.id}`,
      ).toHaveLength(4);
      expect(
        await db`SELECT id FROM admin_audit_log WHERE id=${operationId}`,
      ).toHaveLength(1);
      await expect(
        command(["admin", "leaderboards", "reset"], {
          ...body,
          reason: "Different requested operation",
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("keeps a revision tombstone, rejects stale saves and preserves newly saved data on retry", async () => {
      const target = await fixture("save");
      await save(target, 0, { version: 1, unlocked: ["first"] });
      await handleGames(
        ["games", "ego-trip", "ranked", "start"],
        "POST",
        context(target),
        {},
      );
      const [rankedBefore] =
        await db`SELECT id,state,status FROM ego_ranked_runs WHERE user_id=${target.id}`;
      const operationId = randomUUID(),
        body = resetBody(target, operationId),
        path = ["admin", "users", target.id, "save-reset"];
      const results = await Promise.all([
        command(path, body),
        command(path, body),
      ]);
      expect(
        results.filter((result) => (result as { replayed?: boolean }).replayed),
      ).toHaveLength(1);
      const [row] =
        await db`SELECT data,revision FROM game_saves WHERE user_id=${target.id} AND game_id='ego-trip'`;
      expect(row.data).toBeNull();
      expect(row.revision).toBe(2);
      await expect(save(target, 1, { stale: true })).rejects.toMatchObject({
        status: 409,
      });
      await save(target, 2, { newProgress: true });
      await command(path, body);
      const [latest] =
        await db`SELECT data,revision FROM game_saves WHERE user_id=${target.id} AND game_id='ego-trip'`;
      expect(latest.data).toEqual({ newProgress: true });
      expect(latest.revision).toBe(3);
      const [rankedAfter] =
        await db`SELECT id,state,status FROM ego_ranked_runs WHERE user_id=${target.id}`;
      expect(rankedAfter).toEqual(rankedBefore);
      expect(
        await db`SELECT id FROM admin_audit_log WHERE id=${operationId}`,
      ).toHaveLength(1);
    });
    it("requires save confirmation and excludes every authoritative economy game", async () => {
      const target = await fixture("protected");
      await save(target, 0, { preserved: true });
      await expect(
        command(["admin", "users", target.id, "save-reset"], {
          ...resetBody(target),
          confirmation: "yes",
        }),
      ).rejects.toMatchObject({ status: 400 });
      for (const gameId of [
        "casino",
        "incremental",
        "tower-defense",
        "tycoon",
        "deck-roguelike",
        "social-deduction",
        "unknown",
      ]) {
        await expect(
          command(
            ["admin", "users", target.id, "save-reset"],
            resetBody(target, randomUUID(), gameId),
          ),
        ).rejects.toMatchObject({ status: 400 });
      }
      const [row] =
        await db`SELECT data FROM game_saves WHERE user_id=${target.id} AND game_id='ego-trip'`;
      expect(row.data).toEqual({ preserved: true });
      expect(
        await db`SELECT id FROM admin_audit_log WHERE target_id=${target.id}`,
      ).toHaveLength(0);
    });
    it("removes a known chat message atomically with polls, attachments, pins and immutable evidence", async () => {
      const author = await fixture("message"),
        messageId = randomUUID(),
        fileId = randomUUID();
      const [room] =
        await db`INSERT INTO chat_rooms(kind,name,owner_id) VALUES('group','Private removal fixture',${author.id}) RETURNING id`;
      await db`INSERT INTO chat_messages(id,room_id,author_id,content) VALUES(${messageId},${room.id},${author.id},'Private fixture text')`;
      await db`INSERT INTO chat_pins(message_id,pinned_by) VALUES(${messageId},${author.id})`;
      await db`INSERT INTO chat_reactions(message_id,user_id,emoji) VALUES(${messageId},${author.id},'test')`;
      const [poll] =
        await db`INSERT INTO chat_polls(message_id,question) VALUES(${messageId},'Private fixture poll') RETURNING id`;
      await db`INSERT INTO chat_poll_options(poll_id,label,position) VALUES(${poll.id},'Private answer',0)`;
      const key = await storeFile(
        new TextEncoder().encode("Private fixture attachment"),
      );
      keys.push(key);
      await db`INSERT INTO chat_attachments(id,room_id,owner_id,message_id,storage_key,filename,mime,bytes) VALUES(${fileId},${room.id},${author.id},${messageId},${key},'fixture.txt','text/plain',26)`;
      const operationId = randomUUID(),
        body = removeBody(messageId, "chat-message", operationId),
        path = ["admin", "content", "remove"];
      await expect(
        command(path, { ...body, confirmation: "yes" }),
      ).rejects.toMatchObject({ status: 400 });
      const results = await Promise.all([
        command(path, body),
        command(path, body),
      ]);
      expect(
        results.filter((result) => (result as { replayed?: boolean }).replayed),
      ).toHaveLength(1);
      const [message] =
        await db`SELECT content,deleted_at FROM chat_messages WHERE id=${messageId}`;
      expect(message.content).toBe("");
      expect(message.deleted_at).not.toBeNull();
      expect(
        await db`SELECT id FROM chat_polls WHERE message_id=${messageId}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT message_id FROM chat_pins WHERE message_id=${messageId}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT message_id FROM chat_reactions WHERE message_id=${messageId}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT id FROM chat_attachments WHERE id=${fileId}`,
      ).toHaveLength(0);
      await processStorageCleanup(50, [key]);
      await expect(readFile(key)).rejects.toMatchObject({ status: 404 });
      const [audit] =
        await db`SELECT details FROM admin_audit_log WHERE id=${operationId}`;
      expect(audit.details.attachmentCount).toBe(1);
      expect(JSON.stringify(audit.details)).not.toContain("Private fixture");
      await expect(
        db`UPDATE admin_audit_log SET details='{}'::jsonb WHERE id=${operationId}`,
      ).rejects.toThrow("append-only");
    });
    it("cannot remove private creation drafts and public removal retries survive deletion", async () => {
      const author = await fixture("creation");
      const [creation] =
        await db`INSERT INTO creations(owner_id,title,level) VALUES(${author.id},'Removal fixture',${db.json(starterLevel())}) RETURNING id`;
      const path = ["admin", "content", "remove"];
      await expect(
        command(path, removeBody(creation.id, "public-creation")),
      ).rejects.toMatchObject({ status: 404 });
      await db`UPDATE creations SET published=true WHERE id=${creation.id}`;
      await db`INSERT INTO creation_versions(creation_id,version,level) VALUES(${creation.id},1,${db.json(starterLevel())})`;
      await db`INSERT INTO creation_likes(creation_id,user_id) VALUES(${creation.id},${author.id})`;
      await db`INSERT INTO creation_comments(creation_id,user_id,body) VALUES(${creation.id},${author.id},'Removal comment')`;
      const operationId = randomUUID(),
        body = removeBody(creation.id, "public-creation", operationId);
      const results = await Promise.all([
        command(path, body),
        command(path, body),
      ]);
      expect(
        results.filter((result) => (result as { replayed?: boolean }).replayed),
      ).toHaveLength(1);
      expect(
        await db`SELECT id FROM creations WHERE id=${creation.id}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT creation_id FROM creation_versions WHERE creation_id=${creation.id}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT id FROM creation_comments WHERE creation_id=${creation.id}`,
      ).toHaveLength(0);
      await command(path, body);
      expect(
        await db`SELECT id FROM admin_audit_log WHERE id=${operationId}`,
      ).toHaveLength(1);
    });
    it.runIf(process.env.RUN_INTEGRATION === "1")(
      "publishes committed chat removal to the realtime event channel",
      async () => {
        const author = await fixture("event");
        const [room] =
          await db`INSERT INTO chat_rooms(kind,name,owner_id) VALUES('group','Event fixture',${author.id}) RETURNING id`;
        const [message] =
          await db`INSERT INTO chat_messages(room_id,author_id,content) VALUES(${room.id},${author.id},'Event removal fixture') RETURNING id`;
        const subscriber = new Redis(
          process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
          { maxRetriesPerRequest: 1 },
        );
        try {
          await subscriber.subscribe(eventChannel);
          const delivered = new Promise<DomainEvent>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Removal event was not delivered")),
              3000,
            );
            subscriber.on("message", (_channel, raw) => {
              const event = JSON.parse(raw) as DomainEvent;
              if (
                event.type === "chat:message:delete" &&
                (event.payload as { id?: string }).id === message.id
              ) {
                clearTimeout(timer);
                resolve(event);
              }
            });
          });
          await command(
            ["admin", "content", "remove"],
            removeBody(message.id, "chat-message"),
          );
          const event = await delivered;
          expect(event.roomId).toBe(room.id);
          expect(event.payload).toEqual({
            id: message.id,
            authorId: author.id,
          });
          const [row] =
            await db`SELECT deleted_at FROM chat_messages WHERE id=${message.id}`;
          expect(row.deleted_at).not.toBeNull();
        } finally {
          subscriber.disconnect();
        }
      },
    );
  },
);
