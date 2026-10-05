import { test, expect, captureBrowserErrors } from "./fixtures";

test("account game and motion preferences initialize the host controls", async ({
  page,
  accounts,
  baseURL,
}) => {
  await accounts.signIn(page, "preferences");
  const errors = captureBrowserErrors(page);
  const response = await page.request.post("/api/profile", {
    headers: { Origin: new URL(baseURL || "http://localhost:3000").origin },
    data: {
      settings: {
        games: { volume: 0.25, music: false, effects: false },
        accessibility: { reducedMotion: true },
      },
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto("/games/board-games/play");
  await page
    .locator(".game-toolbar")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(page.getByRole("slider", { name: "Game volume" })).toHaveValue(
    "0.25",
  );
  await expect(
    page.getByRole("checkbox", { name: "Music", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Sound effects", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Reduce motion", exact: true }),
  ).toBeChecked();
  await page.getByRole("checkbox", { name: "Music", exact: true }).check();
  await page.getByRole("slider", { name: "Game volume" }).fill("0.5");
  await page.reload();
  await page
    .locator(".game-toolbar")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Music", exact: true }),
  ).not.toBeChecked();
  await expect(page.getByRole("slider", { name: "Game volume" })).toHaveValue(
    "0.25",
  );
  expect(errors).toEqual([]);
});
