import { test, expect, captureBrowserErrors } from "./fixtures";
import type { EgoRankedView } from "../../packages/platform/src/egoRanked";

async function rankedSnapshot(page: import("@playwright/test").Page) {
  return (await (await page.request.get("/api/games/ego-trip/ranked")).json())
    .data as EgoRankedView;
}
test("simulated standard gamepad moves a ranked player and pauses only on a new button press", async ({
  page,
  accounts,
}) => {
  await page.addInitScript(() => {
    const state = {
      axes: [0, 0],
      buttons: Array.from({ length: 12 }, () => ({
        pressed: false,
        value: 0,
        touched: false,
      })),
    };
    Object.assign(window, { __controller: state });
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [
        {
          ...state,
          connected: true,
          index: 0,
          mapping: "standard",
          id: "Test controller",
          timestamp: performance.now(),
        },
      ],
    });
  });
  await accounts.signIn(page, "pad");
  const errors = captureBrowserErrors(page);
  await page.goto("/games/ego-trip/play");
  await page.getByRole("button", { name: "Ranked solo", exact: true }).click();
  await page
    .getByRole("button", { name: "Start ranked run", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Abandon ranked run", exact: true }),
  ).toBeVisible();
  const initial = await rankedSnapshot(page);
  await page.evaluate(() => {
    (
      window as unknown as { __controller: { axes: number[] } }
    ).__controller.axes[0] = 0.8;
  });
  await expect
    .poll(async () => (await rankedSnapshot(page)).run!.world.player.x)
    .toBeGreaterThan(initial.run!.world.player.x + 20);
  await page.evaluate(() => {
    const pad = (
      window as unknown as {
        __controller: { axes: number[]; buttons: { pressed: boolean }[] };
      }
    ).__controller;
    pad.axes[0] = 0;
    pad.buttons[9].pressed = true;
  });
  const resume = page
    .locator(".game-toolbar")
    .getByRole("button", { name: "Resume", exact: true });
  await expect(resume).toBeVisible();
  await expect
    .poll(async () => {
      const state = await rankedSnapshot(page);
      return state.run!.statistics.dashes ?? 0;
    })
    .toBe(0);
  await expect(resume).toBeVisible();
  await page.evaluate(() => {
    (
      window as unknown as { __controller: { buttons: { pressed: boolean }[] } }
    ).__controller.buttons[9].pressed = false;
  });
  await resume.click();
  await expect(
    page
      .locator(".game-toolbar")
      .getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe("mobile touch and accessibility", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("touch controls move the actual server actor with contrast, larger text and reduced motion enabled", async ({
    page,
    accounts,
    baseURL,
  }) => {
    await accounts.signIn(page, "touch");
    const response = await page.request.post("/api/profile", {
      headers: { Origin: baseURL! },
      data: {
        settings: {
          accessibility: {
            reducedMotion: true,
            highContrast: true,
            fontScale: 1.25,
          },
        },
      },
    });
    expect(response.ok()).toBe(true);
    const errors = captureBrowserErrors(page);
    await page.goto("/games/ego-trip/play");
    await expect(page.locator("html")).toHaveAttribute("data-contrast", "true");
    await expect(page.locator("html")).toHaveAttribute(
      "data-reduced-motion",
      "true",
    );
    expect(
      await page
        .locator("html")
        .evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe("20px");
    await page
      .getByRole("button", { name: "Ranked solo", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Start ranked run", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Abandon ranked run", exact: true }),
    ).toBeVisible();
    const initial = await rankedSnapshot(page);
    const right = page
      .getByLabel("Ranked touch controls")
      .getByRole("button", { name: "Ranked →", exact: true });
    await right.scrollIntoViewIfNeeded();
    const box = (await right.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 },
        ],
      });
      await expect
        .poll(async () => (await rankedSnapshot(page)).run!.world.player.x)
        .toBeGreaterThan(initial.run!.world.player.x + 20);
    } finally {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();
    }
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      overflow: [...document.querySelectorAll("*")]
        .map((element) => ({
          tag: element.tagName,
          class: String(element.className),
          right: element.getBoundingClientRect().right,
          width: element.getBoundingClientRect().width,
        }))
        .filter((item) => item.right > innerWidth + 1)
        .slice(0, 20),
    }));
    expect(layout.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(
      layout.width + 1,
    );
    expect(errors).toEqual([]);
  });
});
