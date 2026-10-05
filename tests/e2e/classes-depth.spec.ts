import { test, expect, type Page } from "@playwright/test";
const origin = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000")
  .origin;
async function fixture(page: Page) {
  const username = `depthui_${Date.now().toString(36)}`;
  const login = await page.request.post("/api/auth/dev", {
    headers: { Origin: origin },
    data: { username },
  });
  expect(login.ok()).toBe(true);
  const response = await page.request.post("/api/classes", {
    headers: { Origin: origin },
    data: { name: "Classes depth fixture" },
  });
  expect(response.ok()).toBe(true);
  return { username, classId: (await response.json()).data.id };
}
async function create(
  page: Page,
  classId: string,
  kind: string,
  title: string,
  data: Record<string, unknown>,
) {
  const response = await page.request.post(
    `/api/classes/${classId}/resources`,
    { headers: { Origin: origin }, data: { kind, title, data } },
  );
  expect(response.ok()).toBe(true);
  return (await response.json()).data;
}
async function cleanup(page: Page, username: string) {
  const response = await page.request.post("/api/account/delete", {
    headers: { Origin: origin },
    data: { confirmation: `DELETE ${username}` },
  });
  expect(response.ok()).toBe(true);
}

test("math notes and assignment planner deliver useful editing and completion history", async ({
  page,
}) => {
  const { username, classId } = await fixture(page);
  try {
    const note = await create(page, classId, "note", "Scientific notes", {
      markdown:
        "# Science\nEnergy $E=mc^2$\n$$\n\\frac{1}{\\sqrt{2}}\n$$\n1. Read\n2. Explain",
    });
    await create(page, classId, "assignment", "Overdue laboratory", {
      dueDate: new Date(Date.now() - 86400000).toISOString(),
      priority: "high",
      status: "not-started",
      description: "Measure acceleration",
    });
    await page.goto(`/classes?resource=${note.id}`);
    await expect(
      page.getByRole("textbox", { name: "Markdown note" }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Markdown note" })
      .press("Control+s");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator(".katex")).toHaveCount(2);
    await expect(page.locator("ol li")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Assignment planner", exact: true })
      .click();
    await page.getByLabel("Assignment filter").selectOption("missing");
    await expect(
      page.getByText("Overdue laboratory", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open assignment", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Status", exact: true })
      .selectOption("done");
    await page
      .getByLabel("Assignment notes")
      .fill("Completed measurement and write-up");
    await page
      .getByRole("button", { name: "Save assignment", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Assignment saved" }),
    ).toBeVisible();
    await page.getByText(/Completion and deadline history/).click();
    await expect(page.getByText(/not-started → done/)).toBeVisible();
    await page
      .getByRole("button", { name: "Assignment planner", exact: true })
      .click();
    await page.getByLabel("Assignment filter").selectOption("completed");
    await expect(
      page.getByText("Overdue laboratory", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Check reminders", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Your reminders are up to date." }),
    ).toBeVisible();
  } finally {
    await cleanup(page, username);
  }
});

test("scheduled cards can be corrected during review and private history follows saved grades", async ({
  page,
}) => {
  const { username, classId } = await fixture(page);
  try {
    const deck = await create(
      page,
      classId,
      "flashcards",
      "Review corrections",
      {
        cards: [
          { front: "First prompt", back: "First answer" },
          { front: "Second prompt", back: "Second answer" },
        ],
      },
    );
    await page.goto(`/classes?resource=${deck.id}`);
    await page
      .getByRole("button", { name: "Study due cards", exact: true })
      .click();
    await expect(
      page.getByText("2 due · 2 cards", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Question.*Tap to flip/ }).click();
    await page.getByRole("button", { name: "Good", exact: true }).click();
    await page
      .getByRole("button", { name: "Edit current card", exact: true })
      .click();
    await page.getByLabel("Review card question").fill("Corrected prompt");
    await page.getByLabel("Review card answer").fill("Corrected answer");
    await page
      .getByRole("button", { name: "Save card changes", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: /Question.*Corrected prompt.*Tap to flip/,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Question.*Corrected prompt.*Tap to flip/ })
      .click();
    await page.getByRole("button", { name: "Easy", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Review history and statistics",
        exact: true,
      })
      .click();
    await expect(
      page.getByText(/2 reviews · 100% Good\/Easy responses/),
    ).toBeVisible();
    await expect(page.getByLabel("Card review history")).toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: "Study due cards", exact: true })
      .click();
    await expect(
      page.getByText("No cards due right now.", { exact: true }),
    ).toBeVisible();
  } finally {
    await cleanup(page, username);
  }
});

test("visual multi-select quiz editing grades exact sets and shows owner aggregates and prior answers", async ({
  page,
}) => {
  const { username, classId } = await fixture(page);
  try {
    const quiz = await create(page, classId, "quiz", "Multi-select quiz", {
      questions: [
        {
          prompt: "Question placeholder",
          type: "short-answer",
          answer: "placeholder",
        },
      ],
      randomOrder: false,
    });
    await page.goto(`/classes?resource=${quiz.id}`);
    await page
      .getByRole("button", { name: "Edit questions", exact: true })
      .click();
    await page.getByLabel("Question", { exact: true }).fill("Which are prime?");
    await page.getByLabel("Question type").selectOption("multi-select");
    await page.getByLabel("Choices, one per line").fill("2\n3\n4");
    await page.getByRole("checkbox", { name: "2", exact: true }).check();
    await page.getByRole("checkbox", { name: "3", exact: true }).check();
    await page.getByRole("button", { name: "Save quiz", exact: true }).click();
    await page.getByRole("button", { name: "2", exact: true }).click();
    await page.getByRole("button", { name: "3", exact: true }).click();
    await page
      .getByRole("button", { name: "Submit answers", exact: true })
      .click();
    await expect(page.getByText("Score: 1 / 1", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Results and analytics", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Quiz owner analytics", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Question 1: 1 / 1 correct (100%)", { exact: true }),
    ).toBeVisible();
    await page
      .locator('section[aria-label="Quiz results and analytics"] summary')
      .click();
    await expect(
      page.getByText("Correct · Your answer: 2, 3 · Expected: 2, 3", {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await cleanup(page, username);
  }
});

test("a shared learner without an owned class can follow private review reminder links and loses access after revocation", async ({
  page,
  browser,
}) => {
  const { username, classId } = await fixture(page),
    context = await browser.newContext({ baseURL: origin }),
    learner = await context.newPage(),
    learnerUsername = `learnui_${Date.now().toString(36)}`;
  const login = await learner.request.post("/api/auth/dev", {
    headers: { Origin: origin },
    data: { username: learnerUsername },
  });
  expect(login.ok()).toBe(true);
  try {
    const deck = await create(
      page,
      classId,
      "flashcards",
      "Shared private review",
      { cards: [{ front: "Shared prompt", back: "Shared answer" }] },
    );
    const share = await page.request.post(
      `/api/classes/resources/${deck.id}/share`,
      {
        headers: { Origin: origin },
        data: { username: learnerUsername, permission: "view" },
      },
    );
    expect(share.ok()).toBe(true);
    await learner.goto(`/classes?resource=${deck.id}`);
    await expect(
      learner.getByRole("heading", {
        name: "Shared private review",
        exact: true,
      }),
    ).toBeVisible();
    await learner
      .getByRole("button", { name: "Study due cards", exact: true })
      .click();
    await expect(
      learner.getByText("1 due · 1 cards", { exact: true }),
    ).toBeVisible();
    await learner
      .getByRole("button", { name: "Check reminders", exact: true })
      .click();
    await expect(
      learner
        .getByRole("status")
        .filter({ hasText: "1 private reminders delivered." }),
    ).toBeVisible();
    const notices = await learner.request.get("/api/notifications");
    expect(notices.ok()).toBe(true);
    const notification = (await notices.json()).data.find(
      (item: { kind: string }) => item.kind === "school",
    );
    expect(notification.link).toBe(`/classes?resource=${deck.id}`);
    await learner.goto(notification.link);
    await expect(
      learner.getByRole("heading", {
        name: "Shared private review",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(`/classes?resource=${deck.id}`);
    await page.getByRole("button", { name: "Sharing", exact: true }).click();
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Revoke", exact: true }),
    ).toHaveCount(0);
    await learner.reload();
    await expect(
      learner.getByRole("alert").filter({ hasText: "Resource not found" }),
    ).toBeVisible();
    await expect(
      learner.getByRole("heading", {
        name: "Shared private review",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await cleanup(learner, learnerUsername);
    await context.close();
    await cleanup(page, username);
  }
});
