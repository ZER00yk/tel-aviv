import { test, expect, captureBrowserErrors } from "./fixtures";
import postgres from "postgres";

test("link previews require an explicit click and never fetch a private target", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL });
  const headers = {
    Origin: new URL(baseURL || "http://localhost:3000").origin,
  };
  const sql = postgres(
    process.env.DATABASE_URL ||
      "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
    { max: 1 },
  );
  let roomId: string | undefined;
  try {
    await accounts.signIn(page, "preview");
    const friendPage = await context.newPage();
    const friend = await accounts.signIn(friendPage, "prevfriend");
    const errors = captureBrowserErrors(page);
    const created = await page.request.post("/api/chat/rooms", {
      data: { userIds: [friend.id] },
      headers,
    });
    expect(created.ok()).toBe(true);
    roomId = ((await created.json()) as { data: { id: string } }).data.id;
    const sent = await page.request.post(`/api/chat/${roomId}/messages`, {
      data: {
        content:
          "A local address must never be fetched: https://127.0.0.1/private",
      },
      headers,
    });
    expect(sent.ok()).toBe(true);
    const messageId = ((await sent.json()) as { data: { id: string } }).data.id;
    let previewRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/chat/link-preview")
        previewRequests++;
    });
    await page.goto(`/chat?room=${roomId}`);
    const message = page.locator(`#message-${messageId}`);
    const load = message.getByRole("button", {
      name: "Load link preview",
      exact: true,
    });
    await expect(load).toBeVisible();
    expect(previewRequests).toBe(0);
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/chat/link-preview",
      ),
      load.click(),
    ]);
    expect(response.ok()).toBe(true);
    expect((await response.json()).data).toMatchObject({
      preview: null,
      message: "This link has no available preview.",
    });
    await expect(message.getByRole("status")).toHaveText(
      /This link has no available preview/,
    );
    expect(previewRequests).toBe(1);
    await message.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      message.getByText("This message was deleted.", { exact: true }),
    ).toBeVisible();
    await expect(
      message.getByRole("button", { name: "Load link preview", exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    if (roomId) await sql`DELETE FROM chat_rooms WHERE id=${roomId}`;
    await sql.end();
    await context.close();
  }
});
