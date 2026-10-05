import { test as base, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

interface Account {
  id: string;
  username: string;
}
interface Accounts {
  signIn: (page?: Page, prefix?: string) => Promise<Account>;
  registerCurrent: () => Promise<Account>;
}

// Every account and upload touched by cleanup belongs to this test's UUIDs.
export const test = base.extend<{ accounts: Accounts }>({
  accounts: async ({ page, baseURL }, use) => {
    const owned: Account[] = [];
    const origin = new URL(baseURL || "http://localhost:3000").origin;
    const registerCurrent = async () => {
      const response = await page.request.get("/api/me");
      expect(response.ok()).toBe(true);
      const { data } = (await response.json()) as { data: Account };
      owned.push(data);
      return data;
    };
    const signIn = async (target = page, prefix = "e2e") => {
      const username = `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const response = await target.request.post("/api/auth/dev", {
        data: { username },
        headers: { Origin: origin },
      });
      expect(
        response.ok(),
        "development sign-in is enabled in this local test environment",
      ).toBe(true);
      const { data } = (await response.json()) as { data: Account };
      owned.push(data);
      return data;
    };
    try {
      await use({ signIn, registerCurrent });
    } finally {
      if (owned.length) {
        const sql = postgres(
          process.env.DATABASE_URL ||
            "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv",
          { max: 1 },
        );
        try {
          const ids = owned.map((account) => account.id);
          const files = await sql<
            { key: string }[]
          >`select data->>'key' as key from school_resources where owner_id in ${sql(ids)} and kind='file'`;
          const attachments = await sql<
            { key: string }[]
          >`select storage_key::text as key from chat_attachments where owner_id in ${sql(ids)}`;
          await sql`delete from chat_attachments where owner_id in ${sql(ids)}`;
          await sql`delete from school_classes where owner_id in ${sql(ids)}`;
          await sql`delete from users where id in ${sql(ids)}`;
          if ((process.env.STORAGE_PROVIDER || "local") === "local") {
            for (const file of [...files, ...attachments]) {
              if (/^[0-9a-f-]{36}$/.test(file.key))
                await unlink(
                  join(
                    process.env.STORAGE_LOCAL_PATH ||
                      "/workspace/tell-aviv-data/uploads",
                    file.key,
                  ),
                ).catch((error) => {
                  if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                    throw error;
                });
            }
          }
        } finally {
          await sql.end();
        }
      }
    }
  },
});
export { expect };

export function captureBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
