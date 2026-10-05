import { test, expect, captureBrowserErrors } from "./fixtures";
import type { Page } from "@playwright/test";
import Redis from "ioredis";
import postgres from "postgres";

// Only isolated-worker runs need this; normal suite runs retain the configured CSP.
test.use({ bypassCSP: Boolean(process.env.E2E_REALTIME_URL) });

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
async function resume(page: Page) {
  await page.bringToFront();
  const button = page.getByRole("button", { name: "Resume", exact: true });
  if (await button.isVisible()) await button.click();
}
async function openLive(page: Page) {
  await page
    .getByRole("button", { name: "Live co-op defense", exact: true })
    .click();
  await expect(
    page.getByText("Realtime connected", { exact: true }),
  ).toBeVisible();
}

test("Neon live co-op shares commands during server combat and restores the same room after reload", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const namespace = process.env.E2E_REALTIME_NAMESPACE ?? "tell-aviv";
  const partnerContext = await browser.newContext({
    baseURL,
    bypassCSP: Boolean(process.env.E2E_REALTIME_URL),
  });
  const sql = postgres(
    process.env.DATABASE_URL ??
      "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
    { max: 1 },
  );
  const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  let code = "";
  let userIds: string[] = [];
  const errors = captureBrowserErrors(page);
  try {
    const partner = await partnerContext.newPage();
    const partnerErrors = captureBrowserErrors(partner);
    const host = await accounts.signIn(page, "neonlive");
    const guest = await accounts.signIn(partner, "neonlive");
    userIds = [host.id, guest.id];
    for (const player of [page, partner]) {
      await targetRealtime(player);
      await player.goto("/games/tower-defense/play");
      await openLive(player);
    }
    await resume(page);
    await page
      .getByRole("button", { name: "Create private room", exact: true })
      .click();
    const heading = page.getByRole("heading", { name: /^Room [A-Z2-9]{6}$/ });
    await expect(heading).toBeVisible();
    code = (await heading.innerText()).replace("Room ", "");
    await resume(partner);
    await partner.getByLabel("Room code", { exact: true }).fill(code);
    await partner.getByRole("button", { name: "Join", exact: true }).click();
    await expect(
      partner.getByRole("heading", { name: `Room ${code}`, exact: true }),
    ).toBeVisible();
    await partner.getByRole("button", { name: "Ready", exact: true }).click();
    await resume(page);
    await page.getByRole("button", { name: "Ready", exact: true }).click();
    await page
      .getByRole("button", { name: "Start match", exact: true })
      .click();
    await expect(
      page.getByLabel("Live defense arena", { exact: true }),
    ).toBeVisible();
    for (const player of [page, partner])
      await expect(
        player.getByRole("button", { name: "Solo defense", exact: true }),
      ).toBeDisabled();
    await page
      .getByRole("button", { name: "Build Rapid at 0, 0", exact: true })
      .click();
    await expect(page.getByTestId("live-defense-cash")).toHaveText("105");
    await page
      .getByRole("button", { name: "Send live wave 1", exact: true })
      .click();
    await expect(page.getByTestId("live-defense-phase")).toContainText(
      "Wave in progress",
    );
    const enemy = page.locator("[data-live-enemy-id='1']");
    await expect(enemy).toBeVisible();
    const originalPosition = await enemy.getAttribute("transform");
    await expect
      .poll(() => enemy.getAttribute("transform"))
      .not.toBe(originalPosition);
    await resume(partner);
    await expect(partner.getByTestId("live-defense-phase")).toContainText(
      "Wave in progress",
    );
    await partner
      .getByRole("button", { name: "Build Rapid at 3, 1", exact: true })
      .click();
    await expect(partner.getByTestId("live-defense-cash")).toHaveText("60");
    await partner
      .getByRole("button", { name: "Rapid tower at 3, 1", exact: true })
      .click();
    await partner
      .getByRole("button", { name: /^Upgrade selected tower/ })
      .click();
    await expect(partner.getByTestId("live-defense-cash")).toHaveText("24");
    await partner
      .getByLabel("Live targeting priority", { exact: true })
      .selectOption("strongest");
    await expect(
      page.getByRole("button", { name: "Rapid tower at 3, 1", exact: true }),
    ).toContainText("Lv 2");
    // Observe real damage from the teammate's mid-wave build before selling it.
    await expect
      .poll(
        async () =>
          Number(await partner.getByTestId("live-defense-kills").innerText()),
        {
          timeout: 15_000,
        },
      )
      .toBeGreaterThan(0);
    await partner
      .getByRole("button", { name: "Sell selected tower", exact: true })
      .click();
    await expect(
      partner.getByRole("button", { name: "Rapid tower at 3, 1", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("live-defense-cash")).toHaveText("72");
    const [checkpoint] =
      await sql`SELECT snapshot FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${code}`;
    expect(checkpoint.snapshot.state.commandRevision).toBe(6);
    expect(checkpoint.snapshot.state.defense.towers).toHaveLength(1);
    expect(checkpoint.snapshot.state.defense.towers[0].id).toBe("1");
    expect(checkpoint.snapshot.state.defense.cash).toBe(72);
    expect(checkpoint.snapshot.state.defense.phase).toBe("wave");
    await partner.reload();
    await openLive(partner);
    await expect(
      partner.getByRole("heading", { name: `Room ${code}`, exact: true }),
    ).toBeVisible();
    await expect(
      partner.getByRole("button", { name: "Rapid tower at 0, 0", exact: true }),
    ).toBeVisible();
    await expect(partner.getByTestId("live-defense-cash")).toHaveText("72");
    await expect(partner.getByTestId("live-defense-phase")).toContainText(
      "Wave in progress",
    );
    expect([...errors, ...partnerErrors]).toEqual([]);
    for (const player of [partner, page]) {
      await resume(player);
      await player
        .getByRole("button", { name: "Leave room", exact: true })
        .click();
    }
    await expect(
      page.getByRole("button", { name: "Solo defense", exact: true }),
    ).toBeEnabled();
  } finally {
    await partnerContext.close();
    if (code) {
      await redis.del(
        `${namespace}:lobby:${code}`,
        ...userIds.map((id) => `${namespace}:user-lobby:${id}`),
      );
      await redis.zrem(`${namespace}:lobbies`, code);
      await sql`DELETE FROM multiplayer_checkpoints WHERE namespace=${namespace} AND lobby_code=${code}`;
      await sql`DELETE FROM multiplayer_matches WHERE lobby_code=${code}`;
    }
    await redis.quit();
    await sql.end();
  }
});
