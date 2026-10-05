import Redis from "ioredis";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { test, expect, captureBrowserErrors } from "./fixtures";
import type { Page } from "@playwright/test";
type RecordedWindow = Window & {
  __desktop: { title: string; body: string; tag: string }[];
  __permissionRequests: number;
};
async function desktopMock(page: Page, permission: "default" | "granted") {
  await page.addInitScript((initial) => {
    const target = window as unknown as RecordedWindow;
    window.name ||= crypto.randomUUID();
    const logKey = `test:desktop-alerts:${window.name}`;
    target.__desktop = JSON.parse(localStorage.getItem(logKey) ?? "[]");
    target.__permissionRequests = 0;
    class MockNotification {
      static permission: NotificationPermission = initial;
      static async requestPermission() {
        target.__permissionRequests++;
        MockNotification.permission = "granted";
        return "granted" as NotificationPermission;
      }
      onclick: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor(title: string, options: NotificationOptions = {}) {
        target.__desktop.push({
          title,
          body: options.body ?? "",
          tag: options.tag ?? "",
        });
        localStorage.setItem(logKey, JSON.stringify(target.__desktop));
      }
      close() {
        this.onclose?.();
      }
    }
    Object.defineProperty(window, "Notification", {
      value: MockNotification,
      configurable: true,
    });
    Object.defineProperty(document, "visibilityState", {
      get: () => "hidden",
      configurable: true,
    });
    document.hasFocus = () => false;
  }, permission);
}
const notices = (page: Page) =>
  page.evaluate(() => (window as unknown as RecordedWindow).__desktop);
test("desktop permission is explicitly requested once and persists per-account opt-in", async ({
  page,
  accounts,
}) => {
  await desktopMock(page, "default");
  await accounts.signIn(page, "permission");
  const errors = captureBrowserErrors(page);
  await page.goto("/settings");
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as unknown as RecordedWindow).__permissionRequests,
    ),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Enable browser notifications", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Turn off browser notifications",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as RecordedWindow).__permissionRequests,
    ),
  ).toBe(1);
  const me = await page.request.get("/api/me");
  expect((await me.json()).data.settings.notifications.desktop_enabled).toBe(
    true,
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as unknown as RecordedWindow).__permissionRequests,
    ),
  ).toBe(0);
  await expect(
    page.getByRole("button", {
      name: "Turn off browser notifications",
      exact: true,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("background desktop alerts deduplicate across tabs and honor Focus Mode and DM preferences", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const receiver = await accounts.signIn(page, "desktop");
  const origin = new URL(baseURL || "http://localhost:3000").origin;
  const headers = { Origin: origin };
  const errors = captureBrowserErrors(page);
  expect(
    (
      await page.request.post("/api/profile", {
        headers,
        data: {
          settings: {
            notifications: { desktop_enabled: true, desktop_dm: true },
          },
        },
      })
    ).ok(),
  ).toBe(true);
  await desktopMock(page, "granted");
  const other = await page.context().newPage();
  await desktopMock(other, "granted");
  other.on("pageerror", (error) => errors.push(error.message));
  const sending = await browser.newContext({ baseURL });
  const sender = await sending.newPage();
  let roomId: string | undefined;
  try {
    await accounts.signIn(sender, "alertsender");
    await Promise.all([page.goto("/"), other.goto("/")]);
    await expect(
      page.getByRole("heading", { name: /A world of games/ }),
    ).toBeVisible();
    await expect(
      other.getByRole("heading", { name: /A world of games/ }),
    ).toBeVisible();
    const roomResponse = await sender.request.post("/api/chat/rooms", {
      headers,
      data: { userIds: [receiver.id] },
    });
    expect(roomResponse.ok()).toBe(true);
    const room = (await roomResponse.json()).data;
    roomId = room.id;
    const post = async (text: string) => {
      const result = await sender.request.post(
        `/api/chat/${room.id}/messages`,
        { headers, data: { content: text } },
      );
      expect(result.ok()).toBe(true);
    };
    await post("A background desktop alert");
    await expect
      .poll(
        async () =>
          (await notices(page)).length + (await notices(other)).length,
      )
      .toBe(1);
    const inbox = await page.request.get("/api/notifications");
    const first = (await inbox.json()).data.find(
      (item: { kind: string }) => item.kind === "dm",
    );
    expect(first).toBeTruthy();
    const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
    try {
      await redis.publish(
        "tell-aviv:events",
        JSON.stringify({
          type: "notification:create",
          userIds: [receiver.id],
          payload: first,
        }),
      );
      await Promise.all(
        ["One concurrent alert", "Another concurrent alert"].map((title) =>
          redis.publish(
            "tell-aviv:events",
            JSON.stringify({
              type: "notification:create",
              userIds: [receiver.id],
              payload: { id: randomUUID(), kind: "dm", title, link: "/chat" },
            }),
          ),
        ),
      );
    } finally {
      await redis.quit();
    }
    await page.waitForTimeout(250);
    expect(
      (await notices(page)).length + (await notices(other)).length,
      JSON.stringify({
        first: await notices(page),
        second: await notices(other),
      }),
    ).toBe(3);
    expect(
      (
        await page.request.post("/api/profile", {
          headers,
          data: { settings: { focusMode: true } },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /Room to focus/ }),
    ).toBeVisible();
    await post("Focus Mode suppresses this desktop alert");
    await expect
      .poll(async () => {
        const result = await page.request.get("/api/notifications");
        return (await result.json()).data.filter(
          (item: { kind: string }) => item.kind === "dm",
        ).length;
      })
      .toBe(2);
    await page.waitForTimeout(250);
    expect((await notices(page)).length + (await notices(other)).length).toBe(
      3,
    );
    expect(
      (
        await page.request.post("/api/profile", {
          headers,
          data: {
            settings: {
              focusMode: false,
              notifications: { desktop_dm: false },
            },
          },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /A world of games/ }),
    ).toBeVisible();
    await post("Desktop DM preferences suppress this alert");
    await page.waitForTimeout(350);
    expect((await notices(page)).length + (await notices(other)).length).toBe(
      3,
    );
    expect(errors).toEqual([]);
  } finally {
    await other.close();
    await sending.close();
    if (roomId) {
      const db = postgres(
        process.env.DATABASE_URL ??
          "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
        { max: 1 },
      );
      try {
        await db`DELETE FROM chat_rooms WHERE id=${roomId}`;
      } finally {
        await db.end();
      }
    }
  }
});

test("real input inactivity shows Away and input returns Online while DND and Invisible remain manual", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  const origin = new URL(baseURL || "http://localhost:3000").origin;
  const headers = { Origin: origin };
  const person = await accounts.signIn(page, "idleperson");
  await page.addInitScript(() => {
    const target = window as unknown as Window & {
      __idleOffset: number;
      __idleReport?: () => void;
    };
    target.__idleOffset = 0;
    const realNow = Date.now;
    Date.now = () => realNow() + target.__idleOffset;
    const nativeInterval = window.setInterval.bind(window);
    window.setInterval = ((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === 20_000 && typeof handler === "function")
        target.__idleReport = () => handler(...args);
      return nativeInterval(handler, delay, ...args);
    }) as typeof window.setInterval;
  });
  const observing = await browser.newContext({ baseURL });
  const watcher = await observing.newPage();
  try {
    await accounts.signIn(watcher, "idlewatcher");
    expect(
      (
        await page.request.post("/api/friends/request", {
          headers,
          data: {
            userId: (
              await watcher.request
                .get("/api/me")
                .then((response) => response.json())
            ).data.id,
          },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await watcher.request.post(`/api/friends/${person.id}/accept`, {
          headers,
          data: {},
        })
      ).ok(),
    ).toBe(true);
    await Promise.all([page.goto("/"), watcher.goto("/friends")]);
    const status = watcher.getByLabel(`Presence of ${person.username}`);
    await expect(status).toHaveText("Online");
    await page.evaluate(() => {
      const target = window as unknown as Window & {
        __idleOffset: number;
        __idleReport?: () => void;
      };
      target.__idleOffset = 6 * 60_000;
      target.__idleReport?.();
    });
    await expect(status).toHaveText("Away");
    await page.evaluate(() => {
      (window as unknown as Window & { __idleOffset: number }).__idleOffset = 0;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
    });
    await expect(status).toHaveText("Online");
    expect(
      (
        await page.request.post("/api/profile", {
          headers,
          data: { settings: { presence: "dnd" } },
        })
      ).ok(),
    ).toBe(true);
    await expect(status).toHaveText("Do not disturb");
    await page.evaluate(() => {
      (
        window as unknown as Window & { __idleReport?: () => void }
      ).__idleReport?.();
    });
    await expect(status).toHaveText("Do not disturb");
    expect(
      (
        await page.request.post("/api/profile", {
          headers,
          data: { settings: { presence: "invisible" } },
        })
      ).ok(),
    ).toBe(true);
    await expect(status).toHaveText("Offline");
  } finally {
    await observing.close();
  }
});
