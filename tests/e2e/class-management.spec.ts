import { test, expect } from "@playwright/test";
test("class rename and typed permanent deletion manage only the signed-in workspace", async ({
  page,
}) => {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const username = `classui_${Date.now().toString(36)}`;
  const login = await page.request.post("/api/auth/dev", {
    data: { username },
    headers: { Origin: origin },
  });
  expect(login.ok()).toBe(true);
  try {
    await page.goto("/classes");
    await page
      .getByLabel("New class", { exact: true })
      .fill("Class lifecycle fixture");
    await page
      .getByRole("button", { name: "Create class", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Class lifecycle fixture",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Manage class", exact: true })
      .click();
    await page
      .getByLabel("Class name", { exact: true })
      .fill("Renamed fixture");
    await page
      .getByRole("button", { name: "Save class changes", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Renamed fixture", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Delete class…", exact: true })
      .click();
    const remove = page.getByRole("button", {
      name: "Permanently delete class",
      exact: true,
    });
    await expect(remove).toBeDisabled();
    await page
      .getByLabel("Class deletion confirmation", { exact: true })
      .fill("DELETE Class lifecycle fixture");
    await expect(remove).toBeDisabled();
    await page
      .getByLabel("Class deletion confirmation", { exact: true })
      .fill("DELETE Renamed fixture");
    await expect(remove).toBeEnabled();
    await remove.click();
    await expect(
      page.getByText("Create a class to start your private workspace.", {
        exact: true,
      }),
    ).toBeVisible();
    const response = await page.request.get("/api/classes");
    expect(response.ok()).toBe(true);
    expect((await response.json()).data.classes).toEqual([]);
  } finally {
    await page.request.post("/api/account/delete", {
      data: { confirmation: `DELETE ${username}` },
      headers: { Origin: origin },
    });
  }
});
