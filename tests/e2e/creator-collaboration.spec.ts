import { randomUUID } from "node:crypto";
import { test, expect, captureBrowserErrors } from "./fixtures";
import { starterLevel } from "../../packages/creator-runtime/src/index";
test("two accounts share a private Creator draft, recover a save conflict, revoke access and use public community controls", async ({
  page,
  browser,
  accounts,
}) => {
  test.setTimeout(90000);
  const owner = await accounts.signIn(page, "cowner");
  const context = await browser.newContext();
  const editor = await context.newPage();
  try {
    const collaborator = await accounts.signIn(editor, "ceditor");
    const errors = captureBrowserErrors(page);
    const editorErrors = captureBrowserErrors(editor);
    const title = `Shared project ${randomUUID().slice(0, 8)}`;
    const headers = { Origin: "http://localhost:3000" };
    const response = await page.request.post("/api/creations", {
      headers,
      data: { title, level: starterLevel() },
    });
    expect(response.ok()).toBe(true);
    const c = (await response.json()).data as { id: string };
    await page.goto("/create");
    await page
      .getByRole("button")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
      .click();
    await page.getByLabel("Collaborator username").fill(collaborator.username);
    await page
      .getByRole("button", { name: "Add collaborator", exact: true })
      .click();
    await expect(
      page.getByText("Collaborator access saved", { exact: true }),
    ).toBeVisible();
    await editor.goto("/create");
    await expect(
      editor.getByRole("heading", { name: "Shared projects", exact: true }),
    ).toBeVisible();
    await editor
      .getByRole("button")
      .filter({
        has: editor.getByRole("heading", { name: title, exact: true }),
      })
      .click();
    await expect(
      editor.getByRole("button", { name: "Publish", exact: true }),
    ).toBeDisabled();
    await editor
      .getByLabel("Level title", { exact: true })
      .fill("Editor unsaved draft");
    expect(
      (
        await page.request.patch(`/api/creations/${c.id}`, {
          headers,
          data: {
            title: "Owner newer revision",
            level: starterLevel(),
            expectedVersion: 1,
          },
        })
      ).ok(),
    ).toBe(true);
    await editor
      .getByRole("button", { name: "Save level", exact: true })
      .click();
    await expect(
      editor.getByText("Error: This level changed. Reload before saving.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(editor.getByLabel("Level title", { exact: true })).toHaveValue(
      "Editor unsaved draft",
    );
    await editor
      .getByRole("button", { name: "Reload latest revision", exact: true })
      .click();
    await expect(editor.getByLabel("Level title", { exact: true })).toHaveValue(
      "Owner newer revision",
    );
    await editor
      .getByLabel("Level title", { exact: true })
      .fill("Editor committed revision");
    await editor
      .getByRole("button", { name: "Save level", exact: true })
      .click();
    await expect(
      editor.getByText("Level saved", { exact: true }),
    ).toBeVisible();
    const saved = (
      await (await page.request.get(`/api/creations/${c.id}`)).json()
    ).data as { title: string; version: number };
    expect(saved).toMatchObject({
      title: "Editor committed revision",
      version: 3,
    });
    await page
      .getByRole("button", {
        name: `Remove ${collaborator.username}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Collaborator removed", { exact: true }),
    ).toBeVisible();
    await editor
      .getByLabel("Level title", { exact: true })
      .fill("Revoked unsaved edit");
    await editor
      .getByRole("button", { name: "Save level", exact: true })
      .click();
    await expect(
      editor.getByText("Error: Creation not found", { exact: true }),
    ).toBeVisible();
    await expect(editor.getByLabel("Level title", { exact: true })).toHaveValue(
      "Revoked unsaved edit",
    );
    expect(
      (
        await page.request.post(`/api/creations/${c.id}/publish`, {
          headers,
          data: { published: true },
        })
      ).ok(),
    ).toBe(true);
    await editor.goto("/create");
    await editor.getByLabel("Search creations").fill(saved.title);
    await editor.getByRole("button", { name: "Search", exact: true }).click();
    await editor
      .getByRole("button")
      .filter({
        has: editor.getByRole("heading", { name: saved.title, exact: true }),
      })
      .click();
    await editor
      .getByRole("button", { name: "Follow creator", exact: true })
      .click();
    await expect(
      editor.getByRole("button", { name: "Unfollow creator", exact: true }),
    ).toBeVisible();
    await editor
      .getByLabel("Level difficulty", { exact: true })
      .selectOption("4");
    await editor
      .getByRole("button", { name: "Rate difficulty", exact: true })
      .click();
    await expect(
      editor.getByText("Difficulty rating saved", { exact: true }),
    ).toBeVisible();
    await editor.getByText("Report this level", { exact: true }).click();
    await editor
      .getByLabel("Report details", { exact: true })
      .fill("Browser fixture report");
    await editor
      .getByRole("button", { name: "Submit report", exact: true })
      .click();
    await expect(
      editor.getByText("Report received for administrator review", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await (
          await editor.request.get(`/api/creations/creators/${owner.id}`)
        ).json()
      ).data.followed,
    ).toBe(true);
    expect([...errors, ...editorErrors]).toEqual([]);
  } finally {
    await context.close();
  }
});
