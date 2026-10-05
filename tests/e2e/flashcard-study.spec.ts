import { test, expect } from "@playwright/test";
test("scheduled flashcard review persists privately and hides rating controls until answer reveal", async ({
  page,
}) => {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const username = `studyui_${Date.now().toString(36)}`;
  const login = await page.request.post("/api/auth/dev", {
    headers: { Origin: origin },
    data: { username },
  });
  expect(login.ok()).toBe(true);
  try {
    const created = await page.request.post("/api/classes", {
      headers: { Origin: origin },
      data: { name: "Scheduled study fixture" },
    });
    expect(created.ok()).toBe(true);
    const classId = (await created.json()).data.id;
    const deckResponse = await page.request.post(
      `/api/classes/${classId}/resources`,
      {
        headers: { Origin: origin },
        data: {
          kind: "flashcards",
          title: "Private review deck",
          data: {
            cards: [{ front: "Scheduled prompt", back: "Scheduled answer" }],
          },
        },
      },
    );
    expect(deckResponse.ok()).toBe(true);
    const deckId = (await deckResponse.json()).data.id;
    await page.goto("/classes");
    await expect(
      page.getByRole("heading", { name: "Private review deck", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .getByRole("button", { name: "Study due cards", exact: true })
      .click();
    await expect(
      page.getByText("1 due · 1 cards", { exact: true }),
    ).toBeVisible();
    const good = page.getByRole("button", { name: "Good", exact: true });
    await expect(good).toBeDisabled();
    await page
      .getByRole("button", { name: /Question.*Scheduled prompt.*Tap to flip/ })
      .click();
    await expect(
      page.getByText("Scheduled answer", { exact: true }),
    ).toBeVisible();
    await expect(good).toBeEnabled();
    await good.click();
    await expect(
      page.getByText("No cards due right now.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: /Review saved/ }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .getByRole("button", { name: "Study due cards", exact: true })
      .click();
    await expect(
      page.getByText("No cards due right now.", { exact: true }),
    ).toBeVisible();
    const queue = await page.request.get(
      `/api/classes/resources/${deckId}/study`,
    );
    expect(queue.ok()).toBe(true);
    expect((await queue.json()).data).toMatchObject({
      dueCount: 0,
      totalCards: 1,
      cards: [],
    });
    await page
      .getByRole("button", { name: "Study all cards", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: /Question.*Scheduled prompt.*Tap to flip/,
      }),
    ).toBeVisible();
  } finally {
    await page.request.post("/api/account/delete", {
      headers: { Origin: origin },
      data: { confirmation: `DELETE ${username}` },
    });
  }
});
