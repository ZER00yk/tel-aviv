import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect, captureBrowserErrors } from "./fixtures";

test("Focus Mode persists, prioritizes Classes at home and restores games when exited", async ({
  page,
  accounts,
  baseURL,
}) => {
  await accounts.signIn(page, "focus");
  const errors = captureBrowserErrors(page);
  const origin = new URL(baseURL || "http://localhost:3000").origin;
  const classResponse = await page.request.post("/api/classes", {
    data: { name: "Focus workspace" },
    headers: { Origin: origin },
  });
  expect(classResponse.ok()).toBe(true);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /A world of games/ }),
  ).toBeVisible();
  const persisted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/profile") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Focus mode", exact: true }).click();
  expect((await persisted).ok()).toBe(true);
  await expect(
    page.getByRole("heading", { name: /Room to focus/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your workspace", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Upcoming assignments", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Focus workspace/ }),
  ).toBeVisible();
  await expect(page.locator("article.game-card")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Exit focus mode", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Room to focus/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Open Classes/ }).click();
  await expect(
    page.getByRole("heading", { name: "Classes", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Focus workspace", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Exit focus mode", exact: true }),
  ).toBeVisible();
  const exited = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/profile") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Exit focus mode", exact: true })
    .click();
  expect((await exited).ok()).toBe(true);
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("link", { name: /^Games/ })).toBeVisible();
  await navigation.getByRole("link", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /A world of games/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Focus mode", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /A world of games/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("account export downloads only own private notes and confirmed deletion revokes the old session", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  const account = await accounts.signIn(page, "account");
  const errors = captureBrowserErrors(page);
  const origin = new URL(baseURL || "http://localhost:3000").origin;
  const headers = { Origin: origin };
  const context = await browser.newContext({ baseURL });
  try {
    const other = await context.newPage();
    await accounts.signIn(other, "private");
    const classResponse = await page.request.post("/api/classes", {
      data: { name: "Account export fixture" },
      headers,
    });
    const otherClassResponse = await other.request.post("/api/classes", {
      data: { name: "Other private class" },
      headers,
    });
    expect(classResponse.ok()).toBe(true);
    expect(otherClassResponse.ok()).toBe(true);
    const { data: schoolClass } = (await classResponse.json()) as {
      data: { id: string };
    };
    const { data: otherClass } = (await otherClassResponse.json()) as {
      data: { id: string };
    };
    const ownText = `My private export note ${account.id}`;
    const otherText = `Another account private note ${account.id}`;
    const ownNote = await page.request.post(
      `/api/classes/${schoolClass.id}/resources`,
      {
        data: {
          kind: "note",
          title: "Own export note",
          data: { markdown: ownText },
        },
        headers,
      },
    );
    const otherNote = await other.request.post(
      `/api/classes/${otherClass.id}/resources`,
      {
        data: {
          kind: "note",
          title: "Other private note",
          data: { markdown: otherText },
        },
        headers,
      },
    );
    expect(ownNote.ok()).toBe(true);
    expect(otherNote.ok()).toBe(true);
    const { data: retainedNote } = (await otherNote.json()) as {
      data: { id: string };
    };
    const session = (await page.context().cookies()).find(
      (cookie) => cookie.name === "ta_session",
    );
    expect(Boolean(session)).toBe(true);
    const oldCookie = `ta_session=${session!.value}`;
    const digest = createHash("sha256").update(session!.value).digest("hex");
    await page.goto("/settings");
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Account", exact: true })
      .click();
    const pendingDownload = page.waitForEvent("download");
    await page
      .getByRole("link", { name: "Export account data", exact: true })
      .click();
    const download = await pendingDownload;
    expect(download.suggestedFilename()).toBe("tell-aviv-account.json");
    expect(await download.failure()).toBeNull();
    const path = await download.path();
    expect(Boolean(path)).toBe(true);
    const content = await readFile(path!, "utf8");
    const exported = JSON.parse(content) as {
      profile: { id: string; username: string };
      resources: { data: { markdown?: string } }[];
    };
    expect(exported.profile.id).toBe(account.id);
    expect(exported.profile.username).toBe(account.username);
    expect(
      exported.resources.some((resource) => resource.data.markdown === ownText),
    ).toBe(true);
    expect(content.includes(otherText)).toBe(false);
    expect(content.includes(digest)).toBe(false);
    expect(content).not.toMatch(
      /"token_hash"|"sessions"|"storage_key"|"google_sub"/,
    );
    const confirmation = page.getByLabel(
      `Type DELETE ${account.username} to confirm`,
      { exact: true },
    );
    await confirmation.fill("DELETE wrong_account");
    const rejected = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/account/delete") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Permanently delete account", exact: true })
      .click();
    expect((await rejected).status()).toBe(400);
    await expect(
      page.getByRole("alert").filter({
        hasText: "Type DELETE followed by your username to confirm",
      }),
    ).toBeVisible();
    expect((await page.request.get("/api/me")).ok()).toBe(true);
    await confirmation.fill(`DELETE ${account.username}`);
    const deleted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/account/delete") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Permanently delete account", exact: true })
      .click();
    expect((await deleted).ok()).toBe(true);
    await expect(
      page.getByRole("heading", { name: /Your people are/ }),
    ).toBeVisible();
    expect(
      (
        await page.request.get("/api/me", { headers: { Cookie: oldCookie } })
      ).status(),
    ).toBe(401);
    const retained = await other.request.get(
      `/api/classes/resources/${retainedNote.id}`,
    );
    expect(retained.ok()).toBe(true);
    const { data: resource } = (await retained.json()) as {
      data: { data: { markdown: string } };
    };
    expect(resource.data.markdown).toBe(otherText);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
