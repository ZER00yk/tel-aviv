import { test, expect, captureBrowserErrors } from "./fixtures";
import Redis from "ioredis";
import postgres from "postgres";
import { campaignRoom } from "../../games/ego-trip/coop-campaign";
import type { CoopState } from "../../games/ego-trip/coop-engine";
import { randomUUID } from "node:crypto";

test("two-account party votes carry one key, unlock a shared secret and retain separate rewards through reload", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  test.setTimeout(90000);
  const host = await accounts.signIn(page, "coopsecret"),
    context = await browser.newContext({ baseURL });
  const guestPage = await context.newPage(),
    guest = await accounts.signIn(guestPage, "coopsecret");
  const errors = captureBrowserErrors(page),
    guestErrors = captureBrowserErrors(guestPage);
  const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  let code = "";
  const players = [page, guestPage];
  try {
    for (const player of players) {
      await player.goto("/games/ego-trip/play");
      await player
        .getByRole("button", { name: "Private co-op", exact: true })
        .click();
      await expect(
        player.getByText("Realtime connected", { exact: true }),
      ).toBeVisible();
    }
    await page.getByLabel("Co-op expedition mode").selectOption("campaign");
    await page
      .getByRole("button", { name: "Create private room", exact: true })
      .click();
    const heading = page.getByRole("heading", { name: /^Room [A-Z0-9]+$/ });
    await expect(heading).toBeVisible();
    code = (await heading.innerText()).replace("Room ", "");
    await guestPage.getByLabel("Room code").fill(code);
    await guestPage.getByRole("button", { name: "Join", exact: true }).click();
    await expect(
      guestPage.getByRole("heading", { name: `Room ${code}`, exact: true }),
    ).toBeVisible();
    for (const player of players)
      await player.getByRole("button", { name: "Ready", exact: true }).click();
    await page
      .getByRole("button", { name: "Start match", exact: true })
      .click();
    await expect(page.getByText(/Shared room 1 \/ 40/)).toBeVisible();
    await page.bringToFront();
    const resume = page.getByRole("button", { name: "Resume", exact: true });
    if (await resume.isVisible()) await resume.click();
    await page
      .getByRole("button", { name: "Start sustained fire", exact: true })
      .click();
    await expect(page.locator(`[data-player-id="${host.id}"]`)).toContainText(
      /damage [1-9]\d*/,
    );
    await page
      .getByRole("button", { name: "Stop sustained fire", exact: true })
      .click();
    let roomIndex = 0;
    const readState = async () =>
      (
        JSON.parse((await redis.get(`tell-aviv:lobby:${code}`))!) as {
          state: CoopState;
        }
      ).state;
    const waitForFight = async () => {
      await expect
        .poll(async () => {
          const state = await readState();
          return { index: state.campaign!.room.index, stage: state.stage };
        })
        .toEqual({ index: roomIndex, stage: "fight" });
    };
    const mutate = async (fn: (state: CoopState) => void) => {
      // Share the server's scoped lobby lock so an in-flight tick cannot replace
      // this fixture update with the state it read before the update.
      const lockKey = `tell-aviv:lock:lobby:${code}`,
        token = randomUUID();
      let locked = false;
      for (let attempt = 0; attempt < 80 && !locked; attempt++) {
        locked = !!(await redis.set(lockKey, token, "PX", 5000, "NX"));
        if (!locked) await page.waitForTimeout(25);
      }
      expect(locked).toBe(true);
      try {
        const fixture = JSON.parse(
          (await redis.get(`tell-aviv:lobby:${code}`))!,
        ) as { state: CoopState };
        expect(fixture.state.campaign!.room.index).toBe(roomIndex);
        fn(fixture.state);
        await redis.set(
          `tell-aviv:lobby:${code}`,
          JSON.stringify(fixture),
          "EX",
          3600,
        );
      } finally {
        await redis.eval(
          "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
          1,
          lockKey,
          token,
        );
      }
    };
    // Fixture seed chooses an NPC junction. Only this test's existing server room
    // is shortened; votes, grants, clears and recovery use real Socket.IO actions.
    await mutate((state) => {
      // Continue this historical compact checkpoint's event/reward contract;
      // the new active mission contract has separate journey browser coverage.
      delete state.campaign!.pacingVersion;
      delete state.campaign!.journey;
      delete state.campaign!.objective;
      state.campaign!.seed = Array.from({ length: 1000 }, (_, i) => i).find(
        (seed) => campaignRoom(seed, 2).kind === "npc",
      )!;
    });
    const clear = async () => {
      await waitForFight();
      await mutate((state) => {
        for (const enemy of state.campaign!.enemies) enemy.hp = 0;
        if (state.campaign!.room.kind === "boss") state.boss.hp = 0;
        if (state.campaign!.room.kind === "environment")
          state.campaign!.roomElapsed = 28;
      });
      for (const player of players)
        await expect(
          player.getByRole("heading", {
            name: "Encounter cleared",
            exact: true,
          }),
        ).toBeVisible();
    };
    const next = async () => {
      for (const player of players)
        await player
          .getByRole("button", { name: "Continue expedition", exact: true })
          .click();
      roomIndex++;
      for (const player of players)
        await expect(
          player.getByText(new RegExp(`^Shared room ${roomIndex + 1} / 40`)),
        ).toBeVisible();
    };
    const route = async () => {
      for (const player of players) {
        await expect(
          player.getByRole("heading", {
            name: "Choose the shared route",
            exact: true,
          }),
        ).toBeVisible();
        await player
          .getByRole("button", { name: "Vote combat", exact: true })
          .click();
      }
      await waitForFight();
    };
    await clear();
    await next();
    await route();
    await clear();
    await next();
    for (const player of players)
      await expect(
        player.getByRole("button", {
          name: "Carry the shared signal key",
          exact: true,
        }),
      ).toBeVisible();
    await page
      .getByRole("button", { name: "Carry the shared signal key", exact: true })
      .click();
    await expect(
      guestPage.getByText("1 event votes received", { exact: true }),
    ).toBeVisible();
    await guestPage
      .getByRole("button", { name: "Carry the shared signal key", exact: true })
      .click();
    for (const player of players)
      await expect(
        player.getByText("Carried party object: signal key", { exact: true }),
      ).toBeVisible();
    await guestPage.reload();
    await guestPage
      .getByRole("button", { name: "Private co-op", exact: true })
      .click();
    await expect(
      guestPage.getByText("Carried party object: signal key", { exact: true }),
    ).toBeVisible();
    await next();
    await clear();
    await next(); // room4 boss
    await clear();
    await next(); // room5 patrol
    await clear();
    await next();
    await route();
    await clear();
    await next(); // room7 secret
    for (const player of players)
      await expect(
        player.getByRole("button", {
          name: "Open the shared secret",
          exact: true,
        }),
      ).toBeVisible();
    for (const player of players)
      await player
        .getByRole("button", { name: "Open the shared secret", exact: true })
        .click();
    for (const player of players) {
      await expect(player.getByLabel("Co-op weapon")).toHaveValue("prism");
      await expect(
        player.getByText("Your expedition modifiers: refraction", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        player.getByText("Carried party object: signal key", { exact: true }),
      ).toHaveCount(0);
    }
    await page
      .getByRole("button", {
        name: "Choose Signal companion (0/4)",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Choose Signal companion (1/4)",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      guestPage.getByRole("button", {
        name: "Choose Signal companion (0/4)",
        exact: true,
      }),
    ).toBeEnabled();
    await guestPage.reload();
    await guestPage
      .getByRole("button", { name: "Private co-op", exact: true })
      .click();
    await expect(guestPage.getByLabel("Co-op weapon")).toHaveValue("prism");
    await expect(
      guestPage.getByText("Your expedition modifiers: refraction", {
        exact: true,
      }),
    ).toBeVisible();
    const fixture = JSON.parse(
      (await redis.get(`tell-aviv:lobby:${code}`))!,
    ) as { state: CoopState };
    expect(fixture.state.campaign!.secrets).toEqual(["restored-relay"]);
    expect(fixture.state.players[host.id].upgrades?.helper).toBe(1);
    expect(fixture.state.players[guest.id].upgrades?.helper).toBeUndefined();
    expect(errors).toEqual([]);
    expect(guestErrors).toEqual([]);
  } finally {
    if (code) {
      await redis.del(
        `tell-aviv:lobby:${code}`,
        `tell-aviv:user-lobby:${host.id}`,
        `tell-aviv:user-lobby:${guest.id}`,
      );
      await redis.zrem("tell-aviv:lobbies", code);
      const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
      try {
        await sql`DELETE FROM multiplayer_checkpoints WHERE namespace='tell-aviv' AND lobby_code=${code}`;
        await sql`DELETE FROM multiplayer_matches WHERE lobby_code=${code}`;
      } finally {
        await sql.end();
      }
    }
    await redis.quit();
    await context.close();
  }
});
