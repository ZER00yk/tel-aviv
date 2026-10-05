import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { test, expect, captureBrowserErrors } from "./fixtures";

test("confirmed administrator quota and currency controls produce an audit trail", async ({
  page,
  accounts,
}) => {
  const errors = captureBrowserErrors(page);
  const owner = await accounts.signIn(page, "admowner");
  const targetContext = await page.context().browser()!.newContext();
  const targetPage = await targetContext.newPage();
  const target = await accounts.signIn(targetPage, "admtarget");
  const sql = postgres(
    process.env.DATABASE_URL ||
      "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
    { max: 1 },
  );
  try {
    // Only this test-owned account gets the role needed to verify the admin UI.
    await sql`UPDATE users SET role='owner' WHERE id=${owner.id}`;
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Platform administration." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Accounts", exact: true }).click();
    await page
      .getByLabel("Search administrator accounts")
      .fill(target.username);
    await page
      .getByRole("button", { name: "Search accounts", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Storage & currency", exact: true })
      .click();
    const controls = page.getByRole("region", {
      name: `Controls for ${target.username}`,
    });
    await controls.getByLabel("Quota in GiB").fill("3");
    const storage = controls
      .locator("fieldset")
      .filter({ has: page.getByText("Storage quota", { exact: true }) });
    await storage
      .getByLabel("Reason", { exact: true })
      .fill("Browser quota validation");
    await storage
      .getByLabel(`Type QUOTA ${target.username}`, { exact: true })
      .fill(`QUOTA ${target.username}`);
    await storage
      .getByRole("button", { name: "Save storage quota", exact: true })
      .click();
    await expect(controls.getByText(/of 3.00 GiB/)).toBeVisible();

    const currency = controls
      .locator("fieldset")
      .filter({ has: page.getByText("Fictional currency", { exact: true }) });
    await currency.getByLabel("Amount", { exact: true }).fill("100");
    await currency
      .getByLabel("Reason", { exact: true })
      .fill("Browser grant validation");
    await currency
      .getByLabel(`Type GRANT casino-credits ${target.username}`, {
        exact: true,
      })
      .fill(`GRANT casino-credits ${target.username}`);
    await currency
      .getByRole("button", { name: "Grant currency", exact: true })
      .click();
    await expect(controls.getByText(/casino-credits:\s*1,100/)).toBeVisible();
    await currency
      .getByRole("combobox", { name: "Operation", exact: true })
      .selectOption("reset");
    await currency
      .getByLabel("Reason", { exact: true })
      .fill("Browser reset validation");
    await currency
      .getByLabel(`Type RESET casino-credits ${target.username}`, {
        exact: true,
      })
      .fill(`RESET casino-credits ${target.username}`);
    await currency
      .getByRole("button", { name: "Reset balance to zero", exact: true })
      .click();
    await expect(controls.getByText(/administrator reset/)).toBeVisible();
    await page.getByRole("button", { name: "Audit", exact: true }).click();
    await expect(
      page.getByText("currency.reset", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("storage.quota", { exact: true }).first(),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await sql.end();
    await targetContext.close();
  }
});

test("confirmed save recovery, scoped score reset and emergency removals work in the browser", async ({
  page,
  accounts,
  baseURL,
}) => {
  const errors = captureBrowserErrors(page);
  const owner = await accounts.signIn(page, "recowner");
  const targetContext = await page.context().browser()!.newContext();
  const targetPage = await targetContext.newPage();
  const targetErrors = captureBrowserErrors(targetPage);
  const target = await accounts.signIn(targetPage, "rectarget");
  const sql = postgres(
    process.env.DATABASE_URL ||
      "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
    { max: 1 },
  );
  const headers = {
    Origin: new URL(baseURL || "http://localhost:3000").origin,
  };
  let roomId: string | undefined;
  try {
    await sql`UPDATE users SET role='owner' WHERE id=${owner.id}`;
    const saved = await targetPage.request.post("/api/games/ego-trip/save", {
      headers,
      data: {
        schemaVersion: 1,
        expectedRevision: 0,
        data: { version: 1, unlocked: ["first"] },
      },
    });
    expect(saved.ok()).toBe(true);
    await page.goto("/admin");
    await page.getByRole("button", { name: "Accounts", exact: true }).click();
    await page
      .getByLabel("Search administrator accounts")
      .fill(target.username);
    await page
      .getByRole("button", { name: "Search accounts", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Storage & currency", exact: true })
      .click();
    const controls = page.getByRole("region", {
      name: `Controls for ${target.username}`,
    });
    const reset = controls.getByRole("group", {
      name: "Reset casual cloud save",
      exact: true,
    });
    await reset
      .getByRole("combobox", { name: "Saved game", exact: true })
      .selectOption("ego-trip");
    await reset
      .getByLabel("Reason", { exact: true })
      .fill("Browser cloud save recovery");
    await reset
      .getByLabel(`Type RESET SAVE ego-trip ${target.username}`, {
        exact: true,
      })
      .fill(`RESET SAVE ego-trip ${target.username}`);
    await reset
      .getByRole("button", { name: "Reset selected cloud save", exact: true })
      .click();
    await expect(
      controls.getByText(/ego-trip · schema 1 · revision 2/),
    ).toBeVisible();
    const { data: cleared } = (await (
      await targetPage.request.get("/api/games/ego-trip/save")
    ).json()) as { data: { data: unknown; revision: number } };
    expect(cleared.data).toBeNull();
    expect(cleared.revision).toBe(2);

    const periodKey = "2002-01-07";
    expect(
      await sql`SELECT user_id FROM leaderboard_entries WHERE game_id='incremental' AND category='production' AND period='daily' AND period_key=${periodKey}`,
    ).toHaveLength(0);
    await sql`INSERT INTO leaderboard_entries(user_id,game_id,category,period,period_key,score) VALUES(${target.id},'incremental','production','daily',${periodKey},10)`;
    await page.getByRole("button", { name: "Recovery", exact: true }).click();
    const leaderboard = page.getByRole("group", {
      name: "Reset a leaderboard scope",
      exact: true,
    });
    await leaderboard
      .getByRole("combobox", { name: "Score category", exact: true })
      .selectOption("production");
    await leaderboard
      .getByRole("combobox", { name: "Score period", exact: true })
      .selectOption("daily");
    await leaderboard
      .getByLabel("UTC period key", { exact: true })
      .fill(periodKey);
    await expect(leaderboard.getByText(/1 stored entries/)).toBeVisible();
    await leaderboard
      .getByLabel("Reason", { exact: true })
      .fill("Browser scoped score recovery");
    await leaderboard
      .getByLabel(
        `Type RESET LEADERBOARD incremental production daily ${periodKey}`,
        { exact: true },
      )
      .fill(`RESET LEADERBOARD incremental production daily ${periodKey}`);
    await leaderboard
      .getByRole("button", { name: "Reset leaderboard scope", exact: true })
      .click();
    await expect(leaderboard.getByText(/0 stored entries/)).toBeVisible();

    const roomResponse = await targetPage.request.post("/api/chat/rooms", {
      headers,
      data: { userIds: [owner.id] },
    });
    expect(roomResponse.ok()).toBe(true);
    const { data: room } = (await roomResponse.json()) as {
      data: { id: string };
    };
    roomId = room.id;
    const messageResponse = await targetPage.request.post(
      `/api/chat/${room.id}/messages`,
      { headers, data: { content: "Emergency removal browser fixture" } },
    );
    expect(messageResponse.ok()).toBe(true);
    const { data: message } = (await messageResponse.json()) as {
      data: { id: string };
    };
    await targetPage.goto(`/chat?room=${room.id}`);
    await expect(
      targetPage
        .getByRole("article")
        .getByText("Emergency removal browser fixture", {
          exact: true,
        }),
    ).toBeVisible();
    await expect(targetPage.locator(".chat-room-heading small")).toContainText(
      " · Live",
    );
    const removal = page.getByRole("group", {
      name: "Remove identified content",
      exact: true,
    });
    await removal.getByLabel("Content UUID", { exact: true }).fill(message.id);
    await removal
      .getByLabel("Reason", { exact: true })
      .fill("Browser emergency message removal");
    await removal
      .getByLabel(`Type REMOVE MESSAGE ${message.id}`, { exact: true })
      .fill(`REMOVE MESSAGE ${message.id}`);
    await removal
      .getByRole("button", { name: "Remove identified content", exact: true })
      .click();
    await expect(
      targetPage.getByText("This message was deleted.", { exact: true }),
    ).toBeVisible();

    const level = {
      schemaVersion: 1,
      width: 960,
      height: 540,
      spawn: { x: 32, y: 420 },
      objects: [
        {
          id: randomUUID(),
          type: "finish",
          x: 880,
          y: 440,
          width: 40,
          height: 60,
          rotation: 0,
          layer: 0,
        },
      ],
    };
    const creationResponse = await targetPage.request.post("/api/creations", {
      headers,
      data: { title: "Emergency public removal fixture", level },
    });
    expect(creationResponse.ok()).toBe(true);
    const { data: creation } = (await creationResponse.json()) as {
      data: { id: string };
    };
    expect(
      (
        await targetPage.request.post(`/api/creations/${creation.id}/publish`, {
          headers,
          data: { published: true },
        })
      ).ok(),
    ).toBe(true);
    await removal
      .getByRole("combobox", { name: "Content kind", exact: true })
      .selectOption("public-creation");
    await removal.getByLabel("Content UUID", { exact: true }).fill(creation.id);
    await removal
      .getByLabel("Reason", { exact: true })
      .fill("Browser emergency creation removal");
    await removal
      .getByLabel(`Type REMOVE CREATION ${creation.id}`, { exact: true })
      .fill(`REMOVE CREATION ${creation.id}`);
    await removal
      .getByRole("button", { name: "Remove identified content", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved successfully." }),
    ).toBeVisible();
    expect(
      (await targetPage.request.get(`/api/creations/${creation.id}`)).status(),
    ).toBe(404);
    await page.getByRole("button", { name: "Audit", exact: true }).click();
    await expect(
      page.getByText("save.reset", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("leaderboard.reset", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("content.remove.chat-message", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("content.remove.public-creation", { exact: true }).first(),
    ).toBeVisible();
    expect(errors).toEqual([]);
    expect(targetErrors).toEqual([]);
  } finally {
    if (roomId) await sql`DELETE FROM chat_rooms WHERE id=${roomId}`;
    await sql.end();
    await targetContext.close();
  }
});
