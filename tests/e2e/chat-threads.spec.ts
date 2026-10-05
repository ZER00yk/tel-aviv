import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { unlink } from "node:fs/promises";
import { join } from "node:path";

test("private threads keep live replies and attachments separate and preserve replies after root-account removal", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const headers = {
    Origin: new URL(baseURL || "http://localhost:3000").origin,
  };
  const first = await browser.newContext({ baseURL }),
    second = await browser.newContext({ baseURL }),
    outsider = await browser.newContext({ baseURL });
  const accounts: { id: string; username: string }[] = [];
  const rooms: string[] = [];
  const errors: string[] = [];
  try {
    for (const context of [first, second, outsider]) {
      const username = `thread_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const login = await context.request.post("/api/auth/dev", {
        data: { username },
        headers,
      });
      expect(login.ok()).toBe(true);
      accounts.push(
        ((await login.json()) as { data: { id: string; username: string } })
          .data,
      );
    }
    const created = await first.request.post("/api/chat/rooms", {
      data: { userIds: [accounts[1].id] },
      headers,
    });
    expect(created.ok()).toBe(true);
    const roomId = ((await created.json()) as { data: { id: string } }).data.id;
    rooms.push(roomId);
    const a = await first.newPage(),
      b = await second.newPage();
    for (const page of [a, b])
      page.on("pageerror", (error) => errors.push(error.message));
    await Promise.all([
      a.goto(`/chat?room=${roomId}`),
      b.goto(`/chat?room=${roomId}`),
    ]);
    const aRoom = a.getByRole("region", {
      name: "Chat conversation",
      exact: true,
    });
    const bRoom = b.getByRole("region", {
      name: "Chat conversation",
      exact: true,
    });
    // Route hydration/session loading can overlap a dev-server recompilation.
    // Establish readiness separately from the live subscription deadline.
    await Promise.all([
      expect(aRoom).toBeVisible({ timeout: 15_000 }),
      expect(bRoom).toBeVisible({ timeout: 15_000 }),
    ]);
    await expect(aRoom.getByText(/· Live/)).toBeVisible();
    await expect(bRoom.getByText(/· Live/)).toBeVisible();
    const rootText = `A dedicated discussion ${randomUUID().slice(0, 8)}`;
    await aRoom.getByLabel("Message", { exact: true }).fill(rootText);
    await aRoom
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(bRoom.getByText(rootText, { exact: true })).toBeVisible();
    const history = (
      (await (
        await first.request.get(`/api/chat/${roomId}/messages`)
      ).json()) as { data: { messages: { id: string; content: string }[] } }
    ).data;
    const rootId = history.messages.find(
      (message) => message.content === rootText,
    )!.id;
    await aRoom
      .locator(`#message-${rootId}`)
      .getByRole("button", { name: "Start thread", exact: true })
      .click();
    const aThread = a.getByRole("region", { name: "Chat thread", exact: true });
    await expect(aThread.getByText(rootText, { exact: true })).toBeVisible();
    const replyText = "First reply belongs only to the thread";
    await aThread.getByLabel("Thread message", { exact: true }).fill(replyText);
    await aThread
      .getByRole("button", { name: "Send thread reply", exact: true })
      .click();
    await expect(aThread.getByText(replyText, { exact: true })).toBeVisible();
    await expect(
      bRoom.getByRole("button", { name: "1 thread reply", exact: true }),
    ).toBeVisible();
    await expect(bRoom.getByText(replyText, { exact: true })).toHaveCount(0);
    await bRoom
      .getByRole("button", { name: "1 thread reply", exact: true })
      .click();
    const bThread = b.getByRole("region", { name: "Chat thread", exact: true });
    await expect(bThread.getByText(replyText, { exact: true })).toBeVisible();
    const preserved = "A reply written by the other account";
    await bThread.getByLabel("Thread message", { exact: true }).fill(preserved);
    await bThread
      .getByRole("button", { name: "Send thread reply", exact: true })
      .click();
    await expect(aThread.getByText(preserved, { exact: true })).toBeVisible();
    expect(
      (
        await outsider.request.get(`/api/chat/${roomId}/threads/${rootId}`)
      ).status(),
    ).toBe(403);
    expect(
      (
        await outsider.request.post(`/api/chat/${roomId}/messages`, {
          data: { content: "Intrusion", threadId: rootId },
          headers,
        })
      ).status(),
    ).toBe(403);

    const filename = `thread-${randomUUID().slice(0, 8)}.txt`;
    await aThread.getByLabel("Choose chat attachments").setInputFiles({
      name: filename,
      mimeType: "text/plain",
      buffer: Buffer.from("A protected thread attachment."),
    });
    await expect(
      aThread.getByRole("status").filter({ hasText: "Ready to send" }),
    ).toBeVisible();
    await aThread
      .getByRole("button", { name: "Send thread reply", exact: true })
      .click();
    await expect(
      bThread.getByRole("link", {
        name: new RegExp(filename.replaceAll(".", "\\.")),
      }),
    ).toBeVisible();
    const downloadUrl = await bThread
      .getByRole("link", { name: new RegExp(filename.replaceAll(".", "\\.")) })
      .getAttribute("href");
    expect(downloadUrl).toBeTruthy();
    expect((await second.request.get(downloadUrl!)).ok()).toBe(true);
    expect((await outsider.request.get(downloadUrl!)).status()).toBe(403);

    const deletion = await first.request.post("/api/account/delete", {
      data: { confirmation: `DELETE ${accounts[0].username}` },
      headers,
    });
    expect(deletion.ok()).toBe(true);
    await b.reload();
    await b
      .getByRole("button", { name: "Browse threads", exact: true })
      .click();
    await b.getByRole("button", { name: /Original message removed/ }).click();
    const recovered = b.getByRole("region", {
      name: "Chat thread",
      exact: true,
    });
    await expect(
      recovered.getByText(
        "The original message was removed. This thread’s replies are preserved.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(recovered.getByText(preserved, { exact: true })).toBeVisible();
    await expect(recovered.getByText(replyText, { exact: true })).toHaveCount(
      0,
    );
    await recovered
      .getByLabel("Thread message", { exact: true })
      .fill("The thread continues after account removal");
    await recovered
      .getByRole("button", { name: "Send thread reply", exact: true })
      .click();
    await expect(
      recovered.getByText("The thread continues after account removal", {
        exact: true,
      }),
    ).toBeVisible();
    await recovered
      .getByRole("button", { name: "Close thread", exact: true })
      .click();
    await expect(
      b
        .getByRole("region", { name: "Chat conversation", exact: true })
        .getByText(preserved, { exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([first.close(), second.close(), outsider.close()]);
    const sql = postgres(
      process.env.DATABASE_URL ||
        "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
      { max: 1 },
    );
    try {
      const ids = accounts.map((account) => account.id);
      if (ids.length) {
        const uploads = await sql<
          { key: string }[]
        >`SELECT storage_key::text AS key FROM chat_attachments WHERE owner_id IN ${sql(ids)}`;
        for (const room of rooms)
          await sql`DELETE FROM chat_rooms WHERE id=${room}`;
        await sql`DELETE FROM notifications WHERE actor_id IN ${sql(ids)}`;
        await sql`DELETE FROM users WHERE id IN ${sql(ids)}`;
        if ((process.env.STORAGE_PROVIDER || "local") === "local")
          for (const upload of uploads)
            await unlink(
              join(
                process.env.STORAGE_LOCAL_PATH ||
                  "/workspace/tell-aviv-data/uploads",
                upload.key,
              ),
            ).catch((error) => {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            });
      }
    } finally {
      await sql.end();
    }
  }
});
