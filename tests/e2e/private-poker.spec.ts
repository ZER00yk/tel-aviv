import { test, expect, captureBrowserErrors } from "./fixtures";
import Redis from "ioredis";
import postgres from "postgres";
import type { Page } from "@playwright/test";
async function resume(page: Page) {
  await page.bringToFront();
  const button = page.getByRole("button", { name: "Resume", exact: true });
  if (await button.isVisible()) await button.click();
}
async function openTable(page: Page) {
  await page
    .getByRole("button", { name: "Private poker", exact: true })
    .click();
  await expect(
    page.getByText("Realtime connected", { exact: true }),
  ).toBeVisible();
}
test("two accounts keep private cards through reload, fold safely and cash out an actual all-in showdown once", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  test.setTimeout(75_000);
  const namespace = process.env.E2E_REALTIME_NAMESPACE ?? "tell-aviv";
  const context = await browser.newContext({ baseURL });
  const sql = postgres(
    process.env.DATABASE_URL ??
      "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
    { max: 1 },
  );
  const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  const matchIds: string[] = [];
  let code = "",
    userIds: string[] = [];
  const errors = captureBrowserErrors(page);
  try {
    const partner = await context.newPage(),
      partnerErrors = captureBrowserErrors(partner);
    const host = await accounts.signIn(page, "poker"),
      guest = await accounts.signIn(partner, "poker");
    userIds = [host.id, guest.id];
    for (const player of [page, partner]) {
      if (process.env.E2E_REALTIME_URL) {
        await player.addInitScript((endpoint) => {
          const NativeSocket = window.WebSocket;
          window.WebSocket = class extends NativeSocket {
            constructor(url: string | URL, protocols?: string | string[]) {
              const target = new URL(url.toString(), location.href);
              if (target.pathname.startsWith("/socket.io/")) {
                const worker = new URL(endpoint);
                target.protocol = worker.protocol === "https:" ? "wss:" : "ws:";
                target.host = worker.host;
              }
              super(target, protocols);
            }
          };
        }, process.env.E2E_REALTIME_URL);
        await player.route("**/socket.io/**", (route) => {
          const target = new URL(route.request().url());
          const worker = new URL(process.env.E2E_REALTIME_URL!);
          target.protocol = worker.protocol;
          target.host = worker.host;
          return route.continue({ url: target.toString() });
        });
      }
      await player.goto("/games/casino/play");
      await openTable(player);
      await expect(
        player.getByText("Public matchmaking", { exact: true }),
      ).toHaveCount(0);
    }
    await page
      .getByRole("button", { name: "Create private room", exact: true })
      .click();
    const heading = page.getByRole("heading", { name: /^Room [A-Z0-9]+$/ });
    await expect(heading).toBeVisible();
    code = (await heading.innerText()).replace("Room ", "");
    await partner.getByLabel("Room code").fill(code);
    await partner.getByRole("button", { name: "Join", exact: true }).click();
    await expect(
      partner.getByRole("heading", { name: `Room ${code}`, exact: true }),
    ).toBeVisible();
    // Changing a table's agreed stake clears both ready flags before the host can start.
    await partner.getByRole("button", { name: "Ready", exact: true }).click();
    await page.getByRole("button", { name: "Ready", exact: true }).click();
    await page.getByLabel("Poker table buy-in").fill("100");
    await page
      .getByRole("button", { name: "Set table buy-in", exact: true })
      .click();
    await expect(
      partner.getByRole("button", { name: "Ready", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Start match", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "ready" }),
    ).toBeVisible();
    async function start() {
      await resume(partner);
      await partner.getByRole("button", { name: "Ready", exact: true }).click();
      await resume(page);
      await page.getByRole("button", { name: "Ready", exact: true }).click();
      await page
        .getByRole("button", { name: "Start match", exact: true })
        .click();
      await expect(page.getByTestId("poker-table-street")).toHaveText(
        "preflop",
      );
      // A folded hand can still say "preflop" while the next asynchronous
      // start is pending. Capture the newly committed hand, not that old UI.
      let startedMatchId = "";
      await expect
        .poll(async () => {
          const [checkpoint] =
            await sql`SELECT match_id FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${code} AND snapshot->>'status'='playing'`;
          startedMatchId = checkpoint?.match_id ?? "";
          return startedMatchId && !matchIds.includes(startedMatchId);
        })
        .toBe(true);
      matchIds.push(startedMatchId);
    }
    await start();
    const own = page.getByLabel("Your poker cards", { exact: true });
    const pocket = await own
      .locator("[aria-label]")
      .evaluateAll((elements) =>
        elements.map((e) => e.getAttribute("aria-label")),
      );
    expect(pocket).toHaveLength(2);
    expect(pocket).not.toContain("Hidden card");
    await expect(
      page
        .locator(`[data-poker-user-id="${guest.id}"]`)
        .getByLabel("Hidden card", { exact: true }),
    ).toHaveCount(2);
    await expect(
      partner
        .locator(`[data-poker-user-id="${host.id}"]`)
        .getByLabel("Hidden card", { exact: true }),
    ).toHaveCount(2);
    await page.reload();
    await openTable(page);
    await expect(
      page.getByRole("heading", { name: `Room ${code}`, exact: true }),
    ).toBeVisible();
    await expect(own.locator("[aria-label]")).toHaveCount(2);
    expect(
      await own
        .locator("[aria-label]")
        .evaluateAll((elements) =>
          elements.map((e) => e.getAttribute("aria-label")),
        ),
    ).toEqual(pocket);
    await resume(page);
    await page.getByRole("button", { name: "Fold hand", exact: true }).click();
    for (const player of [page, partner])
      await expect(
        player.getByRole("heading", { name: "Hand settled", exact: true }),
      ).toBeVisible();
    await expect(
      page
        .locator(`[data-poker-user-id="${guest.id}"]`)
        .getByLabel("Hidden card", { exact: true }),
    ).toHaveCount(2);
    const [first] =
      await sql`SELECT status,public_summary FROM casino_poker_hands WHERE match_id=${matchIds[0]}`;
    expect(first.status).toBe("settled");
    expect(first.public_summary.revealed).toEqual([]);
    await start();
    // The second hand rotates the button. Its dealer acts first heads-up.
    await expect(
      partner.getByRole("button", { name: "All-in", exact: true }),
    ).toBeEnabled();
    await resume(partner);
    await partner.getByRole("button", { name: "All-in", exact: true }).click();
    await resume(page);
    await page.getByRole("button", { name: "Call 90", exact: true }).click();
    for (const player of [page, partner]) {
      await expect(
        player.getByRole("heading", { name: "Hand settled", exact: true }),
      ).toBeVisible();
      await expect(
        player
          .getByLabel("Poker community cards", { exact: true })
          .locator("[aria-label]"),
      ).toHaveCount(5);
      await expect(player.getByTestId("poker-table-street")).toHaveText(
        "river",
      );
      await expect(
        player
          .getByLabel("Poker seats", { exact: true })
          .getByLabel("Hidden card", { exact: true }),
      ).toHaveCount(0);
    }
    const [total] =
      await sql`SELECT sum(balance)::integer AS balance FROM currency_accounts WHERE user_id=ANY(${userIds}::uuid[]) AND currency='casino-credits'`;
    expect(total.balance).toBe(2000);
    const settledLedgers =
      await sql`SELECT user_id,reference_id,reason,count(*)::integer AS count FROM currency_ledger WHERE reference_id=ANY(${matchIds}::text[]) GROUP BY user_id,reference_id,reason`;
    expect(settledLedgers.every((row) => row.count === 1)).toBe(true);
    expect(
      settledLedgers.filter((row) => row.reason === "multiplayer poker buy-in"),
    ).toHaveLength(4);
    const [second] =
      await sql`SELECT public_summary FROM casino_poker_hands WHERE match_id=${matchIds[1]}`;
    expect(second.public_summary.revealed).toHaveLength(2);
    await page.getByText("Your poker hand history", { exact: true }).click();
    await expect(
      page.locator(`[data-poker-history="${matchIds[1]}"]`),
    ).toContainText("Settled hand");
    await expect(
      page
        .locator(`[data-poker-history="${matchIds[1]}"]`)
        .getByLabel("Historical own poker cards", { exact: true })
        .locator("[aria-label]"),
    ).toHaveCount(2);
    await expect(
      page
        .locator(`[data-poker-history="${matchIds[0]}"]`)
        .getByText("Shown at showdown", { exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await openTable(page);
    await expect(
      page.getByRole("heading", { name: "Hand settled", exact: true }),
    ).toBeVisible();
    const [afterReload] =
      await sql`SELECT sum(balance)::integer AS balance FROM currency_accounts WHERE user_id=ANY(${userIds}::uuid[]) AND currency='casino-credits'`;
    expect(afterReload.balance).toBe(2000);
    await page.getByRole("button", { name: "Leave room", exact: true }).click();
    await partner
      .getByRole("button", { name: "Leave room", exact: true })
      .click();
    expect([...errors, ...partnerErrors]).toEqual([]);
  } finally {
    if (code) {
      await redis.del(
        `${namespace}:lobby:${code}`,
        ...userIds.map((id) => `${namespace}:user-lobby:${id}`),
      );
      await redis.zrem(`${namespace}:lobbies`, code);
      await sql`DELETE FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${code}`;
      await sql`DELETE FROM multiplayer_matches WHERE lobby_code=${code}`;
    }
    await context.close();
    await redis.quit();
    await sql.end();
  }
});
