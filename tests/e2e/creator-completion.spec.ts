import { randomUUID } from "node:crypto";
import { test, expect, captureBrowserErrors } from "./fixtures";
import { starterLevel } from "../../packages/creator-runtime/src/schema";

test("community play uses actual keys and server verified completion", async ({
  page,
  accounts,
}) => {
  await accounts.signIn(page, "cr_author");
  const title = `Verified play ${randomUUID().slice(0, 8)}`;
  const level = starterLevel();
  level.objects[1].x = 240;
  const saved = await page.request.post("/api/creations", {
    headers: { Origin: "http://localhost:3000" },
    data: {
      title,
      level,
      category: "challenge",
      description: "Move right to finish",
      tags: ["verified"],
    },
  });
  expect(saved.ok()).toBe(true);
  const creation = (await saved.json()).data as { id: string };
  expect(
    (
      await page.request.post(`/api/creations/${creation.id}/publish`, {
        headers: { Origin: "http://localhost:3000" },
        data: { published: true },
      })
    ).ok(),
  ).toBe(true);
  await accounts.signIn(page, "cr_player");
  const errors = captureBrowserErrors(page);
  const starts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith(`/api/creations/${creation.id}/attempts`)
    )
      starts.push(request.url());
  });
  await page.goto("/create");
  await page.getByLabel("Search creations").fill(title);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .click();
  await expect(
    page.getByText("Verified play · inputs synchronized", { exact: true }),
  ).toBeVisible();
  expect(starts).toHaveLength(1);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  const playable = page.getByLabel("Level playtest", { exact: true });
  await playable.focus();
  await page.keyboard.down("ArrowRight");
  await expect(
    page.getByText("Completion verified by server", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await page.keyboard.up("ArrowRight");
  await expect(
    page.getByText("Level complete!", { exact: true }),
  ).toBeVisible();
  expect(starts).toHaveLength(1);
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await expect(
    page.getByText("Verified play · inputs synchronized", { exact: true }),
  ).toBeVisible();
  expect(starts).toHaveLength(2);
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await playable.focus();
  await page.keyboard.down("ArrowRight");
  await expect(
    page.getByText("Completion verified by server", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await page.keyboard.up("ArrowRight");
  expect(starts).toHaveLength(2);
  await page
    .getByRole("button", { name: "← My creations & community" })
    .click();
  const result = page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(result).toContainText("1 completions · Completed");
  expect(errors).toEqual([]);
});
