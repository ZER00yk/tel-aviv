import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, getUser } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import { handleAdmin } from "../packages/platform/src/admin";
import { handleGames } from "../packages/platform/src/games";
import { storageUsage } from "../packages/platform/src/storageQuota";

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "privileged controls and immutable audit",
  () => {
    const suffix = randomUUID().slice(0, 8);
    const fixtureIds: string[] = [];
    let owner: User;
    let admin: User;
    let ordinary: User;
    const context = (user: User) => ({
      user,
      request: new Request("http://localhost:3000/api/admin"),
    });
    async function fixture(label: string, role: User["role"] = "user") {
      const id = randomUUID();
      fixtureIds.push(id);
      await db`INSERT INTO users(id,username,display_name,role) VALUES(${id},${`adm_${label}_${suffix}`},${"Admin test " + label},${role})`;
      return (await getUser(id))!;
    }
    const change = (
      target: User,
      mode: "grant" | "reset",
      amount: number,
      operationId = randomUUID(),
      actor = owner,
    ) =>
      handleAdmin(
        ["admin", "users", target.id, "currency"],
        "POST",
        context(actor),
        {
          operationId,
          currency: "casino-credits",
          mode,
          amount,
          reason: "Isolated administrator test",
          confirmation: `${mode.toUpperCase()} casino-credits ${target.username}`,
        },
      );
    beforeAll(async () => {
      owner = await fixture("owner", "owner");
      admin = await fixture("admin", "admin");
      ordinary = await fixture("user");
    });
    afterAll(async () => {
      for (const userId of fixtureIds)
        await db`DELETE FROM chat_rooms WHERE owner_id=${userId}`;
      for (const userId of fixtureIds)
        await db`DELETE FROM users WHERE id=${userId}`;
      // Audit rows intentionally survive fixture account deletion: the append-only
      // record is itself part of the behavior under test.
    });
    it("uses the current stored role even when context claims owner", async () => {
      await expect(
        handleAdmin(
          ["admin", "status"],
          "GET",
          context({ ...ordinary, role: "owner" }),
          {},
        ),
      ).rejects.toMatchObject({ status: 403 });
      await db`UPDATE users SET role='user' WHERE id=${admin.id}`;
      await expect(
        handleAdmin(["admin", "audit"], "GET", context(admin), {}),
      ).rejects.toMatchObject({ status: 403 });
      await db`UPDATE users SET role='admin' WHERE id=${admin.id}`;
      await expect(
        change(owner, "grant", 10, randomUUID(), admin),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("rejects a missing confirmation without creating an account or audit record", async () => {
      const target = await fixture("confirm");
      const operationId = randomUUID();
      await expect(
        handleAdmin(
          ["admin", "users", target.id, "currency"],
          "POST",
          context(owner),
          {
            operationId,
            currency: "casino-credits",
            mode: "grant",
            amount: 100,
            reason: "Confirmation test",
            confirmation: "yes",
          },
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(
        await db`SELECT id FROM currency_ledger WHERE user_id=${target.id}`,
      ).toHaveLength(0);
      expect(
        await db`SELECT id FROM admin_audit_log WHERE id=${operationId}`,
      ).toHaveLength(0);
    });
    it("commits one grant for concurrent retries and journals every actual balance delta", async () => {
      const target = await fixture("retry");
      const operationId = randomUUID();
      const results = await Promise.all([
        change(target, "grant", 200, operationId),
        change(target, "grant", 200, operationId),
      ]);
      expect(
        results.filter((result) => (result as { replayed?: boolean }).replayed),
      ).toHaveLength(1);
      await Promise.all([
        change(target, "grant", 100),
        change(target, "grant", 100),
      ]);
      const [account] =
        await db`SELECT balance FROM currency_accounts WHERE user_id=${target.id} AND currency='casino-credits'`;
      const [ledger] =
        await db`SELECT sum(amount) AS amount,count(*)::integer AS count FROM currency_ledger WHERE user_id=${target.id}`;
      expect(Number(account.balance)).toBe(1400);
      expect(Number(ledger.amount)).toBe(1400);
      expect(ledger.count).toBe(4);
      expect(
        await db`SELECT id FROM admin_audit_log WHERE target_id=${target.id}`,
      ).toHaveLength(3);
      await expect(
        change(target, "grant", 201, operationId),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("records a balance reset as a delta and preserves existing debt", async () => {
      const target = await fixture("reset");
      await change(target, "grant", 250);
      await db`INSERT INTO casino_loans(user_id,principal,borrowed_at) VALUES(${target.id},500,now())`;
      await change(target, "reset", 0);
      const [account] =
        await db`SELECT balance FROM currency_accounts WHERE user_id=${target.id} AND currency='casino-credits'`;
      const [ledger] =
        await db`SELECT sum(amount) AS amount FROM currency_ledger WHERE user_id=${target.id}`;
      const [debt] =
        await db`SELECT principal FROM casino_loans WHERE user_id=${target.id}`;
      expect(Number(account.balance)).toBe(0);
      expect(Number(ledger.amount)).toBe(0);
      expect(Number(debt.principal)).toBe(500);
      await change(target, "reset", 0); // Zero-delta resets still leave an audit, never a forbidden zero ledger entry.
      expect(
        await db`SELECT id FROM admin_audit_log WHERE target_id=${target.id} AND action='currency.reset'`,
      ).toHaveLength(2);
    });
    it("blocks a casino reset while a committed hand has stakes in play", async () => {
      const target = await fixture("hand");
      await handleGames(
        ["games", "casino", "action"],
        "POST",
        context(target),
        { action: "mines.start", payload: { bet: 10, bombs: 3 } },
      );
      await expect(change(target, "reset", 0)).rejects.toMatchObject({
        status: 409,
      });
      const [account] =
        await db`SELECT balance FROM currency_accounts WHERE user_id=${target.id} AND currency='casino-credits'`;
      expect(Number(account.balance)).toBe(990);
    });
    it("counts chat uploads and school trash together and rejects undersized quotas atomically", async () => {
      const target = await fixture("quota");
      const [school] =
        await db`INSERT INTO school_classes(owner_id,name) VALUES(${target.id},'Quota test') RETURNING id`;
      await db`INSERT INTO school_resources(class_id,owner_id,kind,title,data,deleted_at) VALUES(${school.id},${target.id},'file','Trashed file',${db.json({ size: 800000, key: randomUUID() })},now())`;
      const [room] =
        await db`INSERT INTO chat_rooms(kind,name,owner_id) VALUES('group','Quota test',${target.id}) RETURNING id`;
      await db`INSERT INTO chat_attachments(room_id,owner_id,storage_key,filename,mime,bytes) VALUES(${room.id},${target.id},${randomUUID()},'Unattached file','text/plain',800000)`;
      expect((await storageUsage(db, target.id)).usageBytes).toBe(1600000);
      const setQuota = (quotaBytes: number | null) =>
        handleAdmin(
          ["admin", "users", target.id, "quota"],
          "POST",
          context(owner),
          {
            quotaBytes,
            reason: "Combined storage allowance test",
            confirmation: `QUOTA ${target.username}`,
          },
        );
      await expect(setQuota(1024 ** 2)).rejects.toMatchObject({ status: 409 });
      expect(
        await db`SELECT id FROM admin_audit_log WHERE target_id=${target.id}`,
      ).toHaveLength(0);
      await setQuota(4 * 1024 ** 2);
      expect(await storageUsage(db, target.id)).toMatchObject({
        usageBytes: 1600000,
        quotaBytes: 4 * 1024 ** 2,
        customQuota: true,
      });
      await setQuota(null);
      expect((await storageUsage(db, target.id)).customQuota).toBe(false);
    });
    it("prevents updates and deletion of existing audit records", async () => {
      const target = await fixture("audit");
      const operationId = randomUUID();
      await change(target, "grant", 5, operationId);
      await expect(
        db`UPDATE admin_audit_log SET action='tampered' WHERE id=${operationId}`,
      ).rejects.toThrow("append-only");
      await expect(
        db`DELETE FROM admin_audit_log WHERE id=${operationId}`,
      ).rejects.toThrow("append-only");
      await db`DELETE FROM users WHERE id=${target.id}`;
      expect(
        await db`SELECT id FROM admin_audit_log WHERE id=${operationId}`,
      ).toHaveLength(1);
    });
    it("requires explicit enable/disable confirmation and revokes sessions in the audited transaction", async () => {
      const target = await fixture("disable");
      await db`INSERT INTO sessions(id,token_hash,user_id,expires_at) VALUES(${randomUUID()},${randomUUID()},${target.id},now()+interval '1 day')`;
      const path = ["admin", "users", target.id];
      await handleAdmin(path, "POST", context(owner), {
        disabled: true,
        confirmation: `DISABLE ${target.username}`,
      });
      expect(
        await db`SELECT id FROM sessions WHERE user_id=${target.id}`,
      ).toHaveLength(0);
      await expect(
        handleAdmin(path, "POST", context(owner), {
          disabled: false,
          confirmation: "",
        }),
      ).rejects.toMatchObject({ status: 400 });
      await handleAdmin(path, "POST", context(owner), {
        disabled: false,
        confirmation: `ENABLE ${target.username}`,
      });
      expect(
        await db`SELECT action FROM admin_audit_log WHERE target_id=${target.id}`,
      ).toHaveLength(2);
    });
  },
);
