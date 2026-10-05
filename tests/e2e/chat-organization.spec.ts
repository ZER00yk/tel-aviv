import { test, expect, captureBrowserErrors } from "./fixtures";
import postgres from "postgres";

test("threads can be named, followed, archived and rediscovered while group owners manage membership", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const headers = {
    Origin: new URL(baseURL || "http://localhost:3000").origin,
  };
  const contexts = [
    await browser.newContext({ baseURL }),
    await browser.newContext({ baseURL }),
    await browser.newContext({ baseURL }),
  ];
  let roomId: string | undefined;
  try {
    const owner = await accounts.signIn(page, "ownerchat");
    const memberPage = await contexts[0].newPage(),
      removedPage = await contexts[1].newPage(),
      addedPage = await contexts[2].newPage();
    const member = await accounts.signIn(memberPage, "memberchat"),
      removed = await accounts.signIn(removedPage, "removedchat"),
      added = await accounts.signIn(addedPage, "addedchat");
    const errors = captureBrowserErrors(page);
    captureBrowserErrors(memberPage);
    const request = await page.request.post("/api/friends/request", {
      data: { userId: added.id },
      headers,
    });
    expect(request.ok()).toBe(true);
    expect(
      (
        await addedPage.request.post(`/api/friends/${owner.id}/accept`, {
          data: {},
          headers,
        })
      ).ok(),
    ).toBe(true);
    const created = await page.request.post("/api/chat/rooms", {
      data: { userIds: [member.id, removed.id], name: "Initial circle" },
      headers,
    });
    expect(created.ok()).toBe(true);
    roomId = ((await created.json()) as { data: { id: string } }).data.id;
    const rootResponse = await page.request.post(
      `/api/chat/${roomId}/messages`,
      { data: { content: "Organize the project" }, headers },
    );
    expect(rootResponse.ok()).toBe(true);
    const rootId = ((await rootResponse.json()) as { data: { id: string } })
      .data.id;
    await Promise.all([
      page.goto(`/chat?room=${roomId}`),
      memberPage.goto(`/chat?room=${roomId}`),
      removedPage.goto(`/chat?room=${roomId}`),
      addedPage.goto("/chat"),
    ]);
    await page
      .getByRole("button", { name: "Group settings", exact: true })
      .click();
    await page
      .getByLabel("Rename group", { exact: true })
      .fill("Design circle");
    await page
      .getByLabel("Group avatar URL", { exact: true })
      .fill("https://example.com/circle.png");
    await page
      .getByRole("button", { name: "Save group settings", exact: true })
      .click();
    await expect(
      memberPage.getByRole("heading", { name: "Design circle", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Add group member", { exact: true })
      .selectOption(added.id);
    await page.getByRole("button", { name: "Add member", exact: true }).click();
    await expect(
      addedPage.getByRole("button", { name: /Design circle/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Hide group settings", exact: true })
      .click();
    const ownerRoom = page.getByRole("region", {
      name: "Chat conversation",
      exact: true,
    });
    await ownerRoom
      .locator(`#message-${rootId}`)
      .getByRole("button", { name: "Start thread", exact: true })
      .click();
    const ownerThread = page.getByRole("region", {
      name: "Chat thread",
      exact: true,
    });
    await ownerThread
      .getByRole("button", { name: "Rename thread", exact: true })
      .click();
    await ownerThread
      .getByLabel("Thread name", { exact: true })
      .fill("Launch checklist");
    await ownerThread
      .getByRole("button", { name: "Save thread name", exact: true })
      .click();
    await expect(
      ownerThread.getByRole("heading", {
        name: "Launch checklist",
        exact: true,
      }),
    ).toBeVisible();
    await memberPage
      .getByRole("button", { name: "Browse threads", exact: true })
      .click();
    await memberPage.getByRole("button", { name: /Launch checklist/ }).click();
    const memberThread = memberPage.getByRole("region", {
      name: "Chat thread",
      exact: true,
    });
    await memberThread
      .getByRole("button", { name: "Follow thread", exact: true })
      .click();
    await expect(
      memberThread.getByRole("button", {
        name: "Unfollow thread",
        exact: true,
      }),
    ).toBeVisible();
    await ownerThread
      .getByLabel("Thread message", { exact: true })
      .fill("Checklist item one");
    await ownerThread
      .getByRole("button", { name: "Send thread reply", exact: true })
      .click();
    await expect(
      memberThread.getByText("Checklist item one", { exact: true }),
    ).toBeVisible();
    await ownerThread
      .getByRole("button", { name: "Archive thread", exact: true })
      .click();
    await expect(
      memberThread.getByLabel("Thread message", { exact: true }),
    ).toBeDisabled();
    await memberThread
      .getByRole("button", { name: "Close thread", exact: true })
      .click();
    await memberPage
      .getByRole("checkbox", { name: "Archived threads", exact: true })
      .check();
    await memberPage
      .getByRole("checkbox", { name: "Following only", exact: true })
      .check();
    await memberPage
      .getByLabel("Search threads", { exact: true })
      .fill("Launch");
    await memberPage
      .getByRole("button", { name: "Search threads", exact: true })
      .click();
    await memberPage.getByRole("button", { name: /Launch checklist/ }).click();
    await ownerThread
      .getByRole("button", { name: "Unarchive thread", exact: true })
      .click();
    await expect(
      memberThread.getByLabel("Thread message", { exact: true }),
    ).toBeEnabled();
    await memberThread
      .getByRole("button", { name: "Unfollow thread", exact: true })
      .click();
    await expect(
      memberThread.getByRole("button", { name: "Follow thread", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Group settings", exact: true })
      .click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page
      .getByRole("button", {
        name: `Remove ${removed.username} from group`,
        exact: true,
      })
      .click();
    await expect(
      removedPage.getByRole("heading", { name: "Global chat", exact: true }),
    ).toBeVisible();
    expect(
      (await removedPage.request.get(`/api/chat/${roomId}/messages`)).status(),
    ).toBe(403);
    page.once("dialog", (dialog) => void dialog.accept());
    await page
      .getByRole("button", { name: "Leave group", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Global chat", exact: true }),
    ).toBeVisible();
    expect(
      (await page.request.get(`/api/chat/${roomId}/messages`)).status(),
    ).toBe(403);
    const final = await memberPage.request.get(`/api/chat/${roomId}/members`);
    expect(final.ok()).toBe(true);
    expect(
      ((await final.json()) as { data: { ownerId: string } }).data.ownerId,
    ).toBe(member.id);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    if (roomId) {
      const sql = postgres(
        process.env.DATABASE_URL ||
          "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
        { max: 1 },
      );
      try {
        await sql`DELETE FROM chat_rooms WHERE id=${roomId}`;
      } finally {
        await sql.end();
      }
    }
  }
});
