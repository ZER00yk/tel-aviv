import { randomUUID } from "node:crypto";
import { test, expect, captureBrowserErrors } from "./fixtures";
test("a first Creator draft save keeps the editor, fields and visible save confirmation", async ({
  page,
  accounts,
}) => {
  await accounts.signIn(page, "draft");
  const errors = captureBrowserErrors(page);
  await page.goto("/create");
  await page.getByRole("button", { name: "+ New level", exact: true }).click();
  const title = `First save ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Level title", { exact: true }).fill(title);
  await page
    .getByLabel("Description", { exact: true })
    .fill("Keep this editor after receiving its server ID.");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/creations") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("Level saved", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save level", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publish", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Level title", { exact: true })).toHaveValue(
    title,
  );
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    "Keep this editor after receiving its server ID.",
  );
  await page
    .getByRole("button", { name: "← My creations & community", exact: true })
    .click();
  await page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .click();
  await expect(page.getByLabel("Level title", { exact: true })).toHaveValue(
    title,
  );
  expect(errors).toEqual([]);
});
