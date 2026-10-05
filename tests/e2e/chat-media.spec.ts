import { test, expect, captureBrowserErrors } from "./fixtures";
import postgres from "postgres";
import { emojiPng } from "../emoji-fixture";

test("server managers upload real emoji that members insert and see fall back after live deletion", async ({
  page,
  browser,
  accounts,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const memberContext = await browser.newContext({ baseURL });
  const outsiderContext = await browser.newContext({ baseURL });
  const headers = {
    Origin: new URL(baseURL || "http://localhost:3000").origin,
  };
  const sql = postgres(
    process.env.DATABASE_URL ||
      "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
    { max: 1 },
  );
  let serverId: string | undefined;
  try {
    await accounts.signIn(page, "mediaowner");
    const memberPage = await memberContext.newPage(),
      outsiderPage = await outsiderContext.newPage();
    const member = await accounts.signIn(memberPage, "mediamember");
    await accounts.signIn(outsiderPage, "emojiaway");
    const errors = captureBrowserErrors(page),
      memberErrors = captureBrowserErrors(memberPage);
    const created = await page.request.post("/api/servers", {
      data: { name: "Emoji laboratory" },
      headers,
    });
    expect(created.ok()).toBe(true);
    serverId = ((await created.json()) as { data: { id: string } }).data.id;
    await sql`INSERT INTO server_members(server_id,user_id) VALUES(${serverId},${member.id})`;
    await Promise.all([
      page.goto(`/servers?id=${serverId}`),
      memberPage.goto(`/servers?id=${serverId}`),
    ]);
    await page
      .getByRole("button", { name: "Server settings and members", exact: true })
      .click();
    const manager = page.getByRole("region", {
      name: "Server emoji management",
      exact: true,
    });
    await manager
      .getByLabel("Custom emoji name", { exact: true })
      .fill("pink_pixel");
    await manager
      .getByLabel("Custom emoji image", { exact: true })
      .setInputFiles({
        name: "pink.png",
        mimeType: "image/png",
        buffer: emojiPng,
      });
    await manager
      .getByRole("button", { name: "Upload server emoji", exact: true })
      .click();
    await expect(
      manager.getByRole("button", {
        name: "Delete emoji pink_pixel",
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(() =>
        manager
          .getByRole("img", { name: ":pink_pixel:", exact: true })
          .evaluate(
            (image: HTMLImageElement) => image.complete && image.naturalWidth,
          ),
      )
      .toBe(1);
    const listed = await page.request.get(`/api/servers/${serverId}/emojis`);
    const emojiId = ((await listed.json()) as { data: { id: string }[] })
      .data[0].id;
    expect(
      (
        await outsiderPage.request.get(
          `/api/servers/${serverId}/emojis/${emojiId}/file`,
        )
      ).status(),
    ).toBe(403);
    await memberPage
      .getByRole("button", { name: "Server settings and members", exact: true })
      .click();
    await expect(
      memberPage.getByLabel("Custom emoji image", { exact: true }),
    ).toHaveCount(0);
    await memberPage
      .getByRole("button", { name: "Server settings and members", exact: true })
      .click();
    const chat = memberPage.getByRole("region", {
      name: "Chat conversation",
      exact: true,
    });
    await chat
      .getByRole("button", { name: "Browse server emoji", exact: true })
      .click();
    await chat
      .getByRole("button", { name: "Insert emoji pink_pixel", exact: true })
      .click();
    await expect(chat.getByLabel("Message", { exact: true })).toHaveValue(
      `:emoji:${emojiId}:`,
    );
    await chat
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const messageImage = chat
      .locator(".message-text")
      .getByRole("img", { name: ":server emoji:", exact: true });
    await expect
      .poll(() =>
        messageImage.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth,
        ),
      )
      .toBe(1);
    const gifConfig = await memberPage.request.get("/api/chat/gifs");
    const gifData = (
      (await gifConfig.json()) as { data: { configured: boolean } }
    ).data;
    await chat
      .getByRole("button", { name: "Browse GIFs", exact: true })
      .click();
    const gifPicker = chat.getByRole("region", {
      name: "GIF search",
      exact: true,
    });
    if (!gifData.configured) {
      await expect(gifPicker.getByRole("status")).toHaveText(
        /GIF search is unavailable/,
      );
      await expect(
        gifPicker.getByLabel("Search GIFs", { exact: true }),
      ).toBeDisabled();
      await expect(
        gifPicker.getByRole("button", { name: "Search GIFs", exact: true }),
      ).toBeDisabled();
    } else
      await expect(
        gifPicker.getByLabel("Search GIFs", { exact: true }),
      ).toBeEnabled();
    await memberPage.screenshot({
      path: test.info().outputPath("server-emoji-message-and-gif-state.png"),
      fullPage: true,
    });
    page.once("dialog", (dialog) => void dialog.accept());
    await manager
      .getByRole("button", { name: "Delete emoji pink_pixel", exact: true })
      .click();
    await expect(
      manager.getByRole("button", {
        name: "Delete emoji pink_pixel",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      chat
        .locator(".message-text")
        .getByText(":emoji unavailable:", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await memberPage.request.get(
          `/api/servers/${serverId}/emojis/${emojiId}/file`,
        )
      ).status(),
    ).toBe(404);
    expect(errors).toEqual([]);
    expect(memberErrors).toEqual([]);
  } finally {
    if (serverId) await sql`DELETE FROM servers WHERE id=${serverId}`;
    await sql.end();
    await memberContext.close();
    await outsiderContext.close();
  }
});
