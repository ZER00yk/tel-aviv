import { test, expect } from "./fixtures";
test("leaving a note during autosave keeps the resource list open and preserves edit access", async ({
  page,
  accounts,
  baseURL,
}) => {
  await accounts.signIn();
  const headers = {
    Origin: new URL(baseURL || "http://localhost:3000").origin,
  };
  const classResponse = await page.request.post("/api/classes", {
    data: { name: "Autosave race fixture" },
    headers,
  });
  expect(classResponse.ok()).toBe(true);
  const { data: schoolClass } = (await classResponse.json()) as {
    data: { id: string };
  };
  const noteResponse = await page.request.post(
    `/api/classes/${schoolClass.id}/resources`,
    {
      data: {
        kind: "note",
        title: "Delayed note",
        data: { markdown: "Initial note" },
      },
      headers,
    },
  );
  expect(noteResponse.ok()).toBe(true);
  const { data: note } = (await noteResponse.json()) as {
    data: { id: string };
  };
  await page.goto("/classes");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByLabel("Markdown note")).toHaveValue("Initial note");
  let release = () => {};
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived = () => {};
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route(`**/api/classes/resources/${note.id}`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    arrived();
    await delayed;
    await route.fulfill({ response });
  });
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/classes/resources/${note.id}`) &&
      response.request().method() === "PATCH",
  );
  await page.getByLabel("Markdown note").fill("Saved after leaving the editor");
  await page
    .getByRole("button", { name: "← Back to resources", exact: true })
    .click();
  await received;
  await expect(
    page.getByRole("heading", { name: "Autosave race fixture", exact: true }),
  ).toBeVisible();
  release();
  expect((await completed).ok()).toBe(true);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByLabel("Markdown note")).toHaveValue(
    "Saved after leaving the editor",
  );
  await expect(
    page.getByRole("button", { name: "Save now", exact: true }),
  ).toBeVisible();
});

test("private notes autosave, flashcards study, quiz grading and file downloads work", async ({
  page,
  accounts,
}) => {
  await accounts.signIn(page, "school");
  await page.goto("/classes");
  await page.getByLabel("New class").fill("Physics workspace");
  await page.getByRole("button", { name: "Create class", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Physics workspace", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "+ New resource", exact: true })
    .click();
  await page.getByLabel("New resource title").fill("Motion notes");
  await page.getByRole("button", { name: "Create note", exact: true }).click();
  const savedNote = page.waitForResponse(
    (response) =>
      response.url().includes("/api/classes/resources/") &&
      response.request().method() === "PATCH",
  );
  await page
    .getByLabel("Markdown note")
    .fill("# Motion\n\n**Force** = mass × acceleration");
  expect((await savedNote).ok()).toBe(true);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← Back to resources" }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByLabel("Markdown note")).toHaveValue(
    "# Motion\n\n**Force** = mass × acceleration",
  );
  await page.getByRole("button", { name: "← Back to resources" }).click();
  await page
    .getByRole("button", { name: "+ New resource", exact: true })
    .click();
  await page.getByLabel("Resource type").selectOption("flashcards");
  await page.getByLabel("New resource title").fill("Mechanics deck");
  await page
    .getByRole("button", { name: "Create flashcards", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit deck", exact: true }).click();
  await page
    .getByLabel("Flashcard deck")
    .fill("Force | mass times acceleration | mechanics");
  await page.getByRole("button", { name: "Save deck", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Question Force Tap to flip/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Question Force Tap to flip/ })
    .click();
  await expect(
    page.getByText("mass times acceleration", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← Back to resources" }).click();
  await page
    .getByRole("button", { name: "+ New resource", exact: true })
    .click();
  await page.getByLabel("Resource type").selectOption("quiz");
  await page.getByLabel("New resource title").fill("Knowledge check");
  await page.getByRole("button", { name: "Create quiz", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit questions", exact: true })
    .click();
  await page.getByLabel("Question", { exact: true }).fill("Objects have mass?");
  await page.getByLabel("Question type").selectOption("true-false");
  await page.getByLabel("Correct answer").fill("true");
  await page.getByRole("button", { name: "Save quiz", exact: true }).click();
  await page.getByRole("button", { name: "true", exact: true }).click();
  await page
    .getByRole("button", { name: "Submit answers", exact: true })
    .click();
  await expect(page.getByText("Score: 1 / 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "← Back to resources" }).click();
  await page.getByLabel("Upload file").setInputFiles({
    name: "worksheet.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Private worksheet"),
  });
  await expect(
    page.getByRole("heading", { name: "worksheet.txt", exact: true }),
  ).toBeVisible();
  const card = page
    .locator("div")
    .filter({
      has: page.getByRole("heading", { name: "worksheet.txt", exact: true }),
    })
    .filter({ has: page.getByRole("button", { name: "Open", exact: true }) })
    .last();
  await card.getByRole("button", { name: "Open", exact: true }).click();
  const href = await page
    .getByRole("link", { name: "Download file", exact: true })
    .getAttribute("href");
  const response = await page.request.get(href!);
  expect(response.ok()).toBe(true);
  expect(await response.text()).toBe("Private worksheet");
});
test("creator starter level saves, edits, publishes and reloads", async ({
  page,
  accounts,
}) => {
  await accounts.signIn(page, "school");
  await page.goto("/create");
  await page.getByRole("button", { name: "+ New level", exact: true }).click();
  await page.getByLabel("Level title").fill("Browser-built world");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save level", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unpublish", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Playtest", exact: true }).click();
  await expect(page.getByLabel("Level playtest")).toBeVisible();
  await page
    .getByRole("button", { name: "Back to editor", exact: true })
    .click();
  await page
    .getByRole("button", { name: "← My creations & community", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Browser-built world", exact: true }),
  ).toHaveCount(2);
});
