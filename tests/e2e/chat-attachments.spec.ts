import { test, expect, type BrowserContext } from "@playwright/test";

// Exercise the real MediaRecorder with Chromium's synthetic audio device.
// Production still requests browser permission only after the user clicks Record.
test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox", "--use-fake-device-for-media-stream"],
  },
});

async function login(
  context: BrowserContext,
  username: string,
  origin: string,
) {
  const response = await context.request.post("/api/auth/dev", {
    data: { username },
    headers: { Origin: origin },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: { id: string; username: string } })
    .data;
}

test("private chat files upload, discard, bind and download with room permissions", async ({
  browser,
  baseURL,
}) => {
  const origin = new URL(baseURL || "http://localhost:3000").origin,
    headers = { Origin: origin };
  const suffix = Date.now().toString(36);
  const author = await browser.newContext({ baseURL }),
    recipient = await browser.newContext({ baseURL }),
    outsider = await browser.newContext({ baseURL });
  let messageId: string | undefined, attachmentId: string | undefined;
  try {
    await login(author, `file_a_${suffix}`, origin);
    const target = await login(recipient, `file_b_${suffix}`, origin);
    await login(outsider, `file_c_${suffix}`, origin);
    const roomResponse = await author.request.post("/api/chat/rooms", {
      data: { userIds: [target.id] },
      headers,
    });
    expect(roomResponse.ok()).toBe(true);
    const room = ((await roomResponse.json()) as { data: { id: string } }).data;
    const a = await author.newPage(),
      b = await recipient.newPage();
    await Promise.all([
      a.goto(`/chat?room=${room.id}`),
      b.goto(`/chat?room=${room.id}`),
    ]);
    await expect(
      a
        .locator(".chat-room-heading")
        .getByRole("heading", { name: target.username, exact: true }),
    ).toBeVisible();
    await expect(
      b.locator(".chat-room-heading").getByText(/· Live/),
    ).toBeVisible();
    const file = {
      name: `private-${suffix}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from("Only the authorized room can read this file."),
    };
    let uploaded = a.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/chat/${room.id}/files`),
    );
    await a.getByLabel("Choose chat attachments").setInputFiles(file);
    const unused = ((await (await uploaded).json()) as { data: { id: string } })
      .data;
    await expect(
      a.getByRole("status").filter({ hasText: "Ready to send" }),
    ).toBeVisible();
    expect(
      (await recipient.request.get(`/api/chat/files/${unused.id}`)).status(),
    ).toBe(404);
    await a
      .getByRole("button", {
        name: `Remove attachment ${file.name}`,
        exact: true,
      })
      .click();
    await expect(a.getByLabel("Pending attachments")).not.toBeVisible();
    expect(
      (await author.request.get(`/api/chat/files/${unused.id}`)).status(),
    ).toBe(404);

    uploaded = a.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/chat/${room.id}/files`),
    );
    await a.getByLabel("Choose chat attachments").setInputFiles(file);
    attachmentId = ((await (await uploaded).json()) as { data: { id: string } })
      .data.id;
    await expect(
      a.getByRole("status").filter({ hasText: "Ready to send" }),
    ).toBeVisible();
    await a.getByRole("button", { name: "Send message", exact: true }).click();
    const download = b.getByRole("link", {
      name: new RegExp(file.name.replaceAll(".", "\\.")),
    });
    await expect(download).toBeVisible();
    const href = await download.getAttribute("href");
    const received = await recipient.request.get(href!);
    expect(received.ok()).toBe(true);
    expect(await received.text()).toBe(file.buffer.toString());
    expect([403, 404]).toContain((await outsider.request.get(href!)).status());
    expect(
      (await author.request.delete(href!, { data: {}, headers })).status(),
    ).toBe(409);
    const history = await author.request.get(`/api/chat/${room.id}/messages`);
    messageId = (
      (await history.json()) as {
        data: { messages: { id: string; attachments: { id: string }[] }[] };
      }
    ).data.messages.find((message) =>
      message.attachments.some((attachment) => attachment.id === attachmentId),
    )?.id;
    expect(messageId).toBeDefined();
    expect(
      (
        await author.request.delete(`/api/chat/messages/${messageId}`, {
          data: {},
          headers,
        })
      ).ok(),
    ).toBe(true);
    expect((await recipient.request.get(href!)).status()).toBe(404);

    // Changes from another participant also refresh live poll and pin state.
    const pollResponse = await author.request.post(
      `/api/chat/${room.id}/messages`,
      {
        data: {
          content: `Poll ${suffix}`,
          poll: {
            question: `Choose ${suffix}`,
            options: ["Option one", "Option two"],
          },
        },
        headers,
      },
    );
    expect(pollResponse.ok()).toBe(true);
    const pollMessageId = (
      (await pollResponse.json()) as { data: { id: string } }
    ).data.id;
    const polls = await author.request.get(`/api/chat/${room.id}/messages`);
    const poll = (
      (await polls.json()) as {
        data: {
          messages: {
            id: string;
            poll?: { id: string; options: { id: string }[] };
          }[];
        };
      }
    ).data.messages.find((message) => message.id === pollMessageId)?.poll;
    expect(poll).toBeDefined();
    expect(
      (
        await recipient.request.post(`/api/chat/polls/${poll!.id}/vote`, {
          data: { optionIds: [poll!.options[0].id] },
          headers,
        })
      ).ok(),
    ).toBe(true);
    await expect(
      a
        .locator(`#message-${pollMessageId}`)
        .getByRole("button", { name: /Option one\s+1 votes/ }),
    ).toBeVisible();
    expect(
      (
        await author.request.post(`/api/chat/messages/${pollMessageId}/pin`, {
          data: {},
          headers,
        })
      ).ok(),
    ).toBe(true);
    await expect(
      b.locator(`#message-${pollMessageId} .message-byline .lucide-pin`),
    ).toBeVisible();
    expect(
      (
        await author.request.delete(`/api/chat/messages/${pollMessageId}/pin`, {
          data: {},
          headers,
        })
      ).ok(),
    ).toBe(true);
    await expect(
      b.locator(`#message-${pollMessageId} .message-byline .lucide-pin`),
    ).not.toBeVisible();
    await author.request.delete(`/api/chat/messages/${pollMessageId}`, {
      data: {},
      headers,
    });
  } finally {
    if (messageId)
      await author.request
        .delete(`/api/chat/messages/${messageId}`, { data: {}, headers })
        .catch(() => {});
    if (attachmentId && !messageId)
      await author.request
        .delete(`/api/chat/files/${attachmentId}`, { data: {}, headers })
        .catch(() => {});
    await Promise.all([author.close(), recipient.close(), outsider.close()]);
  }
});

test("voice recording produces an authorized audio attachment through MediaRecorder", async ({
  browser,
  baseURL,
}) => {
  const origin = new URL(baseURL || "http://localhost:3000").origin,
    headers = { Origin: origin };
  const suffix = Date.now().toString(36);
  const author = await browser.newContext({
      baseURL,
      permissions: ["microphone"],
    }),
    recipient = await browser.newContext({ baseURL });
  let messageId: string | undefined, attachmentId: string | undefined;
  try {
    await login(author, `voice_a_${suffix}`, origin);
    const target = await login(recipient, `voice_b_${suffix}`, origin);
    const roomResponse = await author.request.post("/api/chat/rooms", {
      data: { userIds: [target.id] },
      headers,
    });
    expect(roomResponse.ok()).toBe(true);
    const room = ((await roomResponse.json()) as { data: { id: string } }).data;
    const page = await author.newPage();
    await page.goto(`/chat?room=${room.id}`);
    await expect(
      page
        .locator(".chat-room-heading")
        .getByRole("heading", { name: target.username, exact: true }),
    ).toBeVisible();
    const record = page.getByRole("button", {
      name: "Start voice recording",
      exact: true,
    });
    await expect(record).toBeEnabled();
    await record.click();
    await expect(
      page.getByRole("status").filter({ hasText: "Recording 0:01" }),
    ).toBeVisible();
    const uploaded = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/chat/${room.id}/files`),
    );
    await page
      .getByRole("button", { name: "Stop voice recording", exact: true })
      .click();
    const response = await uploaded;
    expect(response.ok()).toBe(true);
    const attachment = (
      (await response.json()) as {
        data: { id: string; filename: string; mime: string; bytes: number };
      }
    ).data;
    attachmentId = attachment.id;
    expect(attachment.mime).toBe("audio/webm");
    expect(attachment.bytes).toBeGreaterThan(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Ready to send" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.getByLabel(`Play ${attachment.filename}`)).toBeVisible();
    const audio = await recipient.request.get(
      `/api/chat/files/${attachment.id}`,
    );
    expect(audio.ok()).toBe(true);
    expect((await audio.body()).byteLength).toBe(attachment.bytes);
    const history = await author.request.get(`/api/chat/${room.id}/messages`);
    messageId = (
      (await history.json()) as {
        data: { messages: { id: string; attachments: { id: string }[] }[] };
      }
    ).data.messages.find((message) =>
      message.attachments.some((entry) => entry.id === attachment.id),
    )?.id;
    expect(messageId).toBeDefined();
  } finally {
    if (messageId)
      await author.request
        .delete(`/api/chat/messages/${messageId}`, { data: {}, headers })
        .catch(() => {});
    if (attachmentId && !messageId)
      await author.request
        .delete(`/api/chat/files/${attachmentId}`, { data: {}, headers })
        .catch(() => {});
    await Promise.all([author.close(), recipient.close()]);
  }
});
