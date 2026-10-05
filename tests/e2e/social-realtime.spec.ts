import { test, expect, type WebSocketRoute } from "@playwright/test";

test("chat receives typing, edits, reactions and missed messages after reconnecting", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const origin = new URL(baseURL || "http://localhost:3000").origin;
  const suffix = Date.now().toString(36);
  const first = await browser.newContext({ baseURL });
  const second = await browser.newContext({ baseURL });
  const headers = { Origin: origin };
  const ids: string[] = [];
  const errors: string[] = [];
  let connection: WebSocketRoute | undefined;
  let pauseReconnect = false;
  try {
    for (const [context, username] of [
      [first, `live_a_${suffix}`],
      [second, `live_b_${suffix}`],
    ] as const) {
      const login = await context.request.post("/api/auth/dev", {
        data: { username },
        headers,
      });
      expect(login.ok()).toBe(true);
    }
    const a = await first.newPage(),
      b = await second.newPage();
    a.on("pageerror", (error) => errors.push(error.message));
    b.on("pageerror", (error) => errors.push(error.message));
    await a.routeWebSocket(/\/socket\.io\//, (route) => {
      connection = route;
      if (pauseReconnect) void route.close();
      else route.connectToServer();
    });
    await Promise.all([a.goto("/chat"), b.goto("/chat")]);
    await expect(
      a.locator(".chat-room-heading").getByText(/· Live/),
    ).toBeVisible();
    await expect(
      b.locator(".chat-room-heading").getByText(/· Live/),
    ).toBeVisible();
    const original = `Live message ${suffix}`;
    await b.getByLabel("Message", { exact: true }).fill(original);
    await expect(
      a.getByRole("status").filter({ hasText: `live_b_${suffix} is typing` }),
    ).toBeVisible();
    await b.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(a.getByText(original, { exact: true })).toBeVisible();
    const sent = await second.request.get("/api/chat/global/messages");
    const message = (
      (await sent.json()) as {
        data: { messages: { id: string; content: string }[] };
      }
    ).data.messages.find((entry) => entry.content === original);
    expect(message).toBeDefined();
    ids.push(message!.id);
    const edited = `Edited message ${suffix}`;
    expect(
      (
        await second.request.patch(`/api/chat/messages/${message!.id}`, {
          data: { content: edited },
          headers,
        })
      ).ok(),
    ).toBe(true);
    await expect(a.getByText(edited, { exact: true })).toBeVisible();
    expect(
      (
        await second.request.post(
          `/api/chat/messages/${message!.id}/reactions`,
          { data: { emoji: "✨" }, headers },
        )
      ).ok(),
    ).toBe(true);
    await expect(
      a
        .locator(`#message-${message!.id}`)
        .getByRole("button", { name: "✨ 1", exact: true }),
    ).toBeVisible();

    // Close the real transport while retaining both authenticated browser sessions.
    // A durable message sent during the outage must appear when the room rejoins.
    expect(connection).toBeDefined();
    pauseReconnect = true;
    await connection!.close({ code: 1001, reason: "Browser test reconnect" });
    await expect(
      a.locator(".chat-room-heading").getByText(/Connecting/),
    ).toBeVisible();
    const missed = `During reconnect ${suffix}`;
    const response = await second.request.post("/api/chat/global/messages", {
      data: { content: missed },
      headers,
    });
    expect(response.ok()).toBe(true);
    ids.push(((await response.json()) as { data: { id: string } }).data.id);
    pauseReconnect = false;
    await expect(
      a.locator(".chat-room-heading").getByText(/· Live/),
    ).toBeVisible({ timeout: 15_000 });
    await expect(a.getByText(missed, { exact: true })).toBeVisible();
    expect(
      (
        await second.request.delete(`/api/chat/messages/${message!.id}`, {
          headers,
          data: {},
        })
      ).ok(),
    ).toBe(true);
    await expect(
      a
        .locator(`#message-${message!.id}`)
        .getByText("This message was deleted.", { exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    for (const id of ids)
      await second.request
        .delete(`/api/chat/messages/${id}`, { headers, data: {} })
        .catch(() => {});
    await Promise.all([first.close(), second.close()]);
  }
});

test("friend requests arrive live and presence respects invisible status", async ({
  browser,
  baseURL,
}) => {
  const headers = {
    Origin: new URL(baseURL || "http://localhost:3000").origin,
  };
  const suffix = Date.now().toString(36);
  const username = `presence_b_${suffix}`;
  const first = await browser.newContext({ baseURL }),
    second = await browser.newContext({ baseURL });
  let friendId: string | undefined;
  let secondClosed = false;
  try {
    const aLogin = await first.request.post("/api/auth/dev", {
      data: { username: `presence_a_${suffix}` },
      headers,
    });
    const bLogin = await second.request.post("/api/auth/dev", {
      data: { username },
      headers,
    });
    expect(aLogin.ok()).toBe(true);
    expect(bLogin.ok()).toBe(true);
    const ownId = ((await aLogin.json()) as { data: { id: string } }).data.id;
    friendId = ((await bLogin.json()) as { data: { id: string } }).data.id;
    const a = await first.newPage(),
      b = await second.newPage();
    await Promise.all([a.goto("/friends"), b.goto("/chat")]);
    await expect(
      b.locator(".chat-room-heading").getByText(/· Live/),
    ).toBeVisible();
    expect(
      (
        await second.request.post("/api/profile", {
          data: { settings: { presence: "invisible" } },
          headers,
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await second.request.post("/api/friends/request", {
          data: { userId: ownId },
          headers,
        })
      ).ok(),
    ).toBe(true);
    await a.getByRole("button", { name: /Incoming/ }).click();
    await expect(
      a.getByRole("heading", { name: username, exact: true }),
    ).toBeVisible();
    await a.getByRole("button", { name: "Accept", exact: true }).click();
    await a.getByRole("button", { name: "Friends", exact: true }).click();
    await expect(a.getByLabel(`Presence of ${username}`)).toHaveText("Offline");
    expect(
      (
        await second.request.post("/api/profile", {
          data: { settings: { presence: "online" } },
          headers,
        })
      ).ok(),
    ).toBe(true);
    await a.reload();
    await expect(a.getByLabel(`Presence of ${username}`)).toHaveText("Online");
    await second.close();
    secondClosed = true;
    await expect(a.getByLabel(`Presence of ${username}`)).toHaveText("Offline");
  } finally {
    if (friendId)
      await first.request
        .post(`/api/friends/${friendId}/remove`, { data: {}, headers })
        .catch(() => {});
    await first.close();
    if (!secondClosed) await second.close();
  }
});
