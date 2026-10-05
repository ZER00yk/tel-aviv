import { test, expect, captureBrowserErrors } from "./fixtures";
import Redis from "ioredis";
import postgres from "postgres";
import type { CoopState } from "../../games/ego-trip/coop-engine";

test("holding Escape pauses once until the key is released and pressed again", async ({
  page,
  accounts,
}) => {
  await accounts.signIn(page, "escrepeat");
  const errors = captureBrowserErrors(page);
  await page.goto("/games/ego-trip/play");
  const toolbar = page.locator(".game-toolbar");
  await expect(
    toolbar.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.keyboard.down("Escape");
  await expect(
    toolbar.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  // Playwright marks successive downs of a held key as native repeat events.
  await page.keyboard.down("Escape");
  await expect(
    toolbar.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.keyboard.down("Escape");
  await expect(
    toolbar.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.keyboard.up("Escape");
  await page.keyboard.press("Escape");
  await expect(
    toolbar.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

interface StoredCoopLobby {
  state: CoopState | null;
}
test("Space activates co-op ready buttons and rebinding a held movement key stops the server actor", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const host = await accounts.signIn(page, "holdmove");
  const context = await browser.newContext({ baseURL });
  const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  const sql = postgres(
    process.env.DATABASE_URL ??
      "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
    { max: 1 },
  );
  let code = "",
    guestId = "";
  async function snapshot(): Promise<StoredCoopLobby> {
    const raw = await redis.get(`tell-aviv:lobby:${code}`);
    expect(raw, "the test's own live co-op lobby is persisted").toBeTruthy();
    return JSON.parse(raw!) as StoredCoopLobby;
  }
  async function state(): Promise<CoopState> {
    const current = (await snapshot()).state;
    if (!current) throw Error("The co-op match has not started");
    return current;
  }
  try {
    const guestPage = await context.newPage();
    const guest = await accounts.signIn(guestPage, "holdguest");
    guestId = guest.id;
    const errors = captureBrowserErrors(page),
      guestErrors = captureBrowserErrors(guestPage);
    for (const player of [page, guestPage]) {
      await player.goto("/games/ego-trip/play");
      await player
        .getByRole("button", { name: "Private co-op", exact: true })
        .click();
      await expect(
        player.getByText("Realtime connected", { exact: true }),
      ).toBeVisible();
    }
    await page
      .getByRole("button", { name: "Create private room", exact: true })
      .click();
    const heading = page.getByRole("heading", { name: /^Room [A-Z0-9]+$/ });
    await expect(heading).toBeVisible();
    code = (await heading.innerText()).replace("Room ", "");
    await guestPage.getByLabel("Room code", { exact: true }).fill(code);
    await guestPage.getByRole("button", { name: "Join", exact: true }).click();
    await expect(
      guestPage.getByRole("heading", { name: `Room ${code}`, exact: true }),
    ).toBeVisible();
    for (const player of [guestPage, page]) {
      await player.getByRole("button", { name: "Ready", exact: true }).focus();
      await player.keyboard.press("Space");
      // A real browser-generated click must reach the ready protocol. The old
      // global game handler canceled Space and left this button unchanged.
      await expect(
        player.getByRole("button", { name: "Unready", exact: true }),
      ).toBeVisible();
    }
    await page
      .getByRole("button", { name: "Start match", exact: true })
      .click();
    await expect
      .poll(async () => (await snapshot()).state?.stage)
      .toBe("fight");
    await page.bringToFront();
    const toolbar = page.locator(".game-toolbar");
    const resume = toolbar.getByRole("button", { name: "Resume", exact: true });
    if (await resume.isVisible()) await resume.click();
    await page.getByLabel("Co-op combat arena", { exact: true }).focus();
    const initial = (await state()).players[host.id];
    await page.keyboard.down("d");
    await expect
      .poll(async () => (await state()).players[host.id].input?.dx)
      .toBe(1);
    await expect
      .poll(async () => (await state()).players[host.id].x)
      .toBeGreaterThan(initial.x + 12);
    // Keep the physical D key down throughout the actual settings/save flow.
    // Moving focus within this page must not mask the regression with window blur.
    await toolbar
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await page
      .getByLabel("Move right key", { exact: true })
      .selectOption("KeyI");
    await page
      .getByRole("button", { name: "Save movement controls", exact: true })
      .click();
    await expect(
      page.getByText("Movement controls saved to your account.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.up("d");
    await expect
      .poll(async () => (await state()).players[host.id].input?.dx)
      .toBe(0);
    const stopped = await state();
    await expect
      .poll(async () => {
        const current = await state(),
          actor = current.players[host.id];
        if (current.elapsed < stopped.elapsed + 0.6) return null;
        return {
          dx: actor.input?.dx,
          drift: Math.abs(actor.x - stopped.players[host.id].x),
          sequenceAdvanced: actor.sequence > stopped.players[host.id].sequence,
        };
      })
      .toEqual({ dx: 0, drift: 0, sequenceAdvanced: true });
    await toolbar
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await page.getByLabel("Co-op combat arena", { exact: true }).focus();
    await page.keyboard.down("i");
    await expect
      .poll(async () => (await state()).players[host.id].input?.dx)
      .toBe(1);
    await page.keyboard.up("i");
    await expect
      .poll(async () => (await state()).players[host.id].input?.dx)
      .toBe(0);
    await page.getByRole("button", { name: "Leave room", exact: true }).click();
    await guestPage
      .getByRole("button", { name: "Leave room", exact: true })
      .click();
    expect(errors).toEqual([]);
    expect(guestErrors).toEqual([]);
  } finally {
    await page.keyboard.up("d").catch(() => undefined);
    await page.keyboard.up("i").catch(() => undefined);
    if (code) {
      await redis.del(
        `tell-aviv:lobby:${code}`,
        ...[host.id, guestId]
          .filter(Boolean)
          .map((id) => `tell-aviv:user-lobby:${id}`),
      );
      await redis.zrem("tell-aviv:lobbies", code);
      await sql`DELETE FROM multiplayer_checkpoints WHERE namespace='tell-aviv' AND lobby_code=${code}`;
      await sql`DELETE FROM multiplayer_matches WHERE lobby_code=${code}`;
    }
    await redis.quit();
    await sql.end();
    await context.close();
  }
});
