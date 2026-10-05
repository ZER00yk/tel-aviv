import { test, expect, captureBrowserErrors } from "./fixtures";
import Redis from "ioredis";
import postgres from "postgres";
import type { Page } from "@playwright/test";

// The isolated worker uses a test-only port outside the production connect-src.
// Keep normal CSP enforcement when this file runs against the configured worker.
test.use({ bypassCSP: !!process.env.E2E_REALTIME_URL });

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
async function targetRealtime(page: Page) {
  if (!process.env.E2E_REALTIME_URL) return;
  await page.addInitScript((endpoint) => {
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
  await page.route("**/socket.io/**", (route) => {
    const target = new URL(route.request().url());
    const worker = new URL(process.env.E2E_REALTIME_URL!);
    target.protocol = worker.protocol;
    target.host = worker.host;
    return route.continue({ url: target.toString() });
  });
}

test("persistent private poker retains funded seats through two actual hands, reload and one table cash-out", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  const namespace = process.env.E2E_REALTIME_NAMESPACE ?? "tell-aviv";
  const context = await browser.newContext({
    baseURL,
    bypassCSP: !!process.env.E2E_REALTIME_URL,
  });
  const sql = postgres(
    process.env.DATABASE_URL ??
      "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
    { max: 1 },
  );
  const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  const matchIds: string[] = [];
  let code = "",
    tableId = "",
    userIds: string[] = [];
  const errors = captureBrowserErrors(page);
  try {
    const partner = await context.newPage();
    const partnerErrors = captureBrowserErrors(partner);
    const host = await accounts.signIn(page, "ppoker");
    const guest = await accounts.signIn(partner, "ppoker");
    userIds = [host.id, guest.id];
    for (const player of [page, partner]) {
      await targetRealtime(player);
      await player.goto("/games/casino/play");
      await openTable(player);
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
    await page.getByLabel("Keep table open between hands").check();
    await page.getByLabel("Poker minimum buy-in").fill("100");
    await page.getByLabel("Poker maximum buy-in").fill("1000");
    await page
      .getByRole("button", { name: "Set table buy-in", exact: true })
      .click();
    for (const player of [page, partner]) {
      await expect(
        player.getByLabel("Persistent poker table", { exact: true }),
      ).toBeVisible();
      await expect(
        player.getByRole("button", { name: "Ready", exact: true }),
      ).toBeDisabled();
    }
    await page.getByLabel("Poker seat amount").fill("200");
    await page
      .getByRole("button", { name: "Reserve poker seat", exact: true })
      .click();
    await partner.getByLabel("Poker seat amount").fill("300");
    await partner
      .getByRole("button", { name: "Reserve poker seat", exact: true })
      .click();
    await expect(
      page.locator(`[data-poker-table-seat="${host.id}"]`),
    ).toContainText("200 retained chips");
    await expect(
      page.locator(`[data-poker-table-seat="${guest.id}"]`),
    ).toContainText("300 retained chips");
    const wallets = async () => {
      const [row] =
        await sql`SELECT sum(balance)::integer AS balance FROM currency_accounts WHERE user_id=ANY(${userIds}::uuid[]) AND currency='casino-credits'`;
      return Number(row.balance);
    };
    const retained = async () => {
      const [row] =
        await sql`SELECT coalesce(sum(stack),0)::integer AS chips FROM casino_poker_table_seats WHERE table_id=${tableId} AND status='active'`;
      return Number(row.chips);
    };
    const [table] =
      await sql`SELECT id FROM casino_poker_tables WHERE namespace=${namespace} AND lobby_code=${code} AND status='active'`;
    tableId = table.id;
    expect(await wallets()).toBe(1500);
    expect(await retained()).toBe(500);
    const start = async (handNumber: number) => {
      await resume(partner);
      await partner.getByRole("button", { name: "Ready", exact: true }).click();
      await resume(page);
      await page.getByRole("button", { name: "Ready", exact: true }).click();
      const button = page.getByRole("button", {
        name: "Start next hand",
        exact: true,
      });
      await expect(button).toBeEnabled();
      await button.click();
      await expect(page.getByTestId("poker-hand-blinds")).toContainText(
        `Hand ${handNumber} · blinds 5/10`,
      );
      let matchId = "";
      await expect
        .poll(async () => {
          const [checkpoint] =
            await sql`SELECT match_id FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${code} AND snapshot->>'status'='playing'`;
          matchId = checkpoint?.match_id ?? "";
          return !!matchId && !matchIds.includes(matchId);
        })
        .toBe(true);
      matchIds.push(matchId);
      const [hand] =
        await sql`SELECT table_id,hand_number FROM casino_poker_table_hands WHERE match_id=${matchId}`;
      expect(hand.table_id).toBe(tableId);
      expect(hand.hand_number).toBe(handNumber);
      expect(await wallets()).toBe(1500);
    };
    await start(1);
    for (const [player, otherId] of [
      [page, guest.id],
      [partner, host.id],
    ] as const) {
      await expect(
        player
          .locator(`[data-poker-user-id="${otherId}"]`)
          .getByLabel("Hidden card", { exact: true }),
      ).toHaveCount(2);
    }
    await expect(
      page.locator(`[data-poker-user-id="${host.id}"]`),
    ).toContainText("Dealer");
    await expect(
      page.getByRole("button", { name: "Fold hand", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Fold hand", exact: true }).click();
    for (const player of [page, partner]) {
      await expect(
        player.getByRole("heading", { name: "Hand settled", exact: true }),
      ).toBeVisible();
      await expect(
        player.getByText("These chips stay at the table for the next hand.", {
          exact: false,
        }),
      ).toBeVisible();
    }
    expect(await wallets()).toBe(1500);
    expect(await retained()).toBe(500);
    await expect(
      page.locator(`[data-poker-table-seat="${host.id}"]`),
    ).toContainText("195 retained chips");
    await expect(
      page.locator(`[data-poker-table-seat="${guest.id}"]`),
    ).toContainText("305 retained chips");
    const [folded] =
      await sql`SELECT public_summary FROM casino_poker_table_hands WHERE match_id=${matchIds[0]}`;
    expect(folded.public_summary.revealed).toEqual([]);
    await start(2);
    await expect(
      partner.locator(`[data-poker-user-id="${guest.id}"]`),
    ).toContainText("Dealer");
    const pocket = await page
      .getByLabel("Your poker cards", { exact: true })
      .locator("[aria-label]")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("aria-label")),
      );
    expect(pocket).toHaveLength(2);
    expect(pocket).not.toContain("Hidden card");
    await page.reload();
    await openTable(page);
    await expect(page.getByTestId("poker-hand-blinds")).toContainText("Hand 2");
    await expect(
      page
        .getByLabel("Your poker cards", { exact: true })
        .locator("[aria-label]"),
    ).toHaveCount(2);
    expect(
      await page
        .getByLabel("Your poker cards", { exact: true })
        .locator("[aria-label]")
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("aria-label")),
        ),
    ).toEqual(pocket);
    await expect(
      page
        .locator(`[data-poker-user-id="${guest.id}"]`)
        .getByLabel("Hidden card", { exact: true }),
    ).toHaveCount(2);
    expect(await wallets()).toBe(1500);
    // Use the committed server turn to choose the player, then take a real UI action.
    for (let actions = 0; actions < 8; actions++) {
      const [checkpoint] =
        await sql`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${code}`;
      const state = checkpoint.snapshot.state as {
        phase: string;
        revision: number;
        turnIndex: number | null;
        currentBet: number;
        seats: { userId: string; streetBet: number }[];
      };
      expect(state.phase).toBe("betting");
      const actor = state.seats[state.turnIndex!];
      const player = actor.userId === host.id ? page : partner;
      await resume(player);
      const button =
        actor.streetBet < state.currentBet
          ? player.getByRole("button", { name: /^Call \d+$/ })
          : player.getByRole("button", { name: "Check hand", exact: true });
      await expect(button).toBeEnabled();
      await button.click();
      await expect
        .poll(async () => {
          const [latest] =
            await sql`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${code}`;
          return latest.snapshot.state.revision > state.revision;
        })
        .toBe(true);
    }
    for (const player of [page, partner]) {
      await expect(
        player.getByRole("heading", { name: "Hand settled", exact: true }),
      ).toBeVisible();
      await expect(player.getByTestId("poker-table-street")).toHaveText(
        "river",
      );
      await expect(
        player
          .getByLabel("Poker community cards", { exact: true })
          .locator("[aria-label]"),
      ).toHaveCount(5);
      await expect(
        player
          .getByLabel("Poker seats", { exact: true })
          .getByLabel("Hidden card", { exact: true }),
      ).toHaveCount(0);
      await expect(
        player
          .getByLabel("Private multiplayer poker", { exact: true })
          .getByRole("alert"),
      ).toHaveCount(0);
    }
    expect(await wallets()).toBe(1500);
    expect(await retained()).toBe(500);
    const buyIns =
      await sql`SELECT user_id,amount,count(*)::integer AS count FROM currency_ledger WHERE user_id=ANY(${userIds}::uuid[]) AND reason='persistent poker buy-in' GROUP BY user_id,amount`;
    expect(buyIns).toHaveLength(2);
    expect(buyIns.every((row) => row.count === 1)).toBe(true);
    expect(
      buyIns.map((row) => Number(row.amount)).sort((a, b) => a - b),
    ).toEqual([-300, -200]);
    const [showdown] =
      await sql`SELECT public_summary FROM casino_poker_table_hands WHERE match_id=${matchIds[1]}`;
    expect(showdown.public_summary.revealed).toHaveLength(2);
    await page.getByText("Your poker hand history", { exact: true }).click();
    await expect(
      page.locator(`[data-poker-history="${matchIds[1]}"]`),
    ).toContainText("Persistent table · hand 2");
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
    await resume(page);
    await page
      .getByRole("button", { name: "Close poker table", exact: true })
      .click();
    await expect(
      page.getByLabel("Persistent poker table", { exact: true }),
    ).toContainText("Closed");
    await expect.poll(wallets).toBe(2000);
    expect(await retained()).toBe(0);
    const cashouts =
      await sql`SELECT user_id,count(*)::integer AS count FROM currency_ledger WHERE reference_id=${tableId} AND reason='persistent poker close' GROUP BY user_id`;
    expect(cashouts).toHaveLength(2);
    expect(cashouts.every((row) => row.count === 1)).toBe(true);
    await page.reload();
    await openTable(page);
    await expect(
      page.getByLabel("Persistent poker table", { exact: true }),
    ).toContainText("Closed");
    expect(await wallets()).toBe(2000);
    expect(await retained()).toBe(0);
    for (const player of [page, partner])
      await player
        .getByRole("button", { name: "Leave room", exact: true })
        .click();
    expect([...errors, ...partnerErrors]).toEqual([]);
  } finally {
    await context.close();
    if (code) {
      await redis.del(
        `${namespace}:lobby:${code}`,
        ...userIds.map((id) => `${namespace}:user-lobby:${id}`),
      );
      await redis.zrem(`${namespace}:lobbies`, code);
      await sql`DELETE FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${code}`;
      await sql`DELETE FROM multiplayer_matches WHERE lobby_code=${code}`;
    }
    if (tableId) await sql`DELETE FROM casino_poker_tables WHERE id=${tableId}`;
    await redis.quit();
    await sql.end();
  }
});
