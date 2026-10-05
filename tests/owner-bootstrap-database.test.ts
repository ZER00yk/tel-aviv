import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@tell-aviv/database";
import { bootstrapOwner } from "../packages/platform/src/ownerBootstrap";
describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "host-only native owner bootstrap",
  () => {
    let schema = "";
    const ids = [randomUUID(), randomUUID()];
    async function call(id = ids[0], confirmation?: string) {
      return db.begin(async (sql) => {
        await sql`SELECT set_config('search_path',${schema + ",public"},true)`;
        return bootstrapOwner(sql, id, confirmation);
      });
    }
    const confirm = (id: string) => `BOOTSTRAP OWNER ${id}`;
    beforeEach(async () => {
      schema = `owner_fixture_${randomUUID().replaceAll("-", "")}`;
      await db`CREATE SCHEMA ${db(schema)}`;
      // Copy the actual current column/constraint contract into isolated fixture tables.
      // None of these statements can mutate a public account or administrative audit record.
      await db`CREATE TABLE ${db(schema)}.users (LIKE public.users INCLUDING ALL)`;
      await db`CREATE TABLE ${db(schema)}.user_credentials (LIKE public.user_credentials INCLUDING ALL)`;
      await db`CREATE TABLE ${db(schema)}.admin_audit_log (LIKE public.admin_audit_log INCLUDING ALL)`;
      await db`INSERT INTO ${db(schema)}.users(id,username,display_name) VALUES(${ids[0]},'native_operator_one','Fixture'),(${ids[1]},'native_operator_two','Fixture')`;
      for (const id of ids)
        await db`INSERT INTO ${db(schema)}.user_credentials(user_id,password_hash) VALUES(${id},'$argon2id$v=19$fixture-only-not-a-login-hash')`;
    });
    afterEach(async () => {
      if (schema) await db`DROP SCHEMA ${db(schema)} CASCADE`;
    });
    it("previews without changing authority and requires the exact UUID confirmation", async () => {
      expect(await call()).toMatchObject({
        dryRun: true,
        owner: false,
        changed: false,
      });
      await expect(call(ids[0], "BOOTSTRAP OWNER wrong")).rejects.toMatchObject(
        { status: 400 },
      );
      expect(await db`SELECT role FROM ${db(schema)}.users`).toEqual([
        { role: "user" },
        { role: "user" },
      ]);
      expect(
        await db`SELECT id FROM ${db(schema)}.admin_audit_log`,
      ).toHaveLength(0);
    });
    it("promotes once, preserves immutable UUID and audits only the first successful application", async () => {
      expect(await call(ids[0], confirm(ids[0]))).toMatchObject({
        changed: true,
        owner: true,
      });
      expect(await call(ids[0], confirm(ids[0]))).toMatchObject({
        changed: false,
        owner: true,
      });
      expect(
        await db`SELECT id,role FROM ${db(schema)}.users WHERE id=${ids[0]}`,
      ).toEqual([{ id: ids[0], role: "owner" }]);
      expect(
        await db`SELECT actor_id,action,details FROM ${db(schema)}.admin_audit_log`,
      ).toEqual([
        {
          actor_id: ids[0],
          action: "owner.bootstrap",
          details: { source: "host operator", previousRole: "user" },
        },
      ]);
    });
    it("serializes concurrent bootstrap attempts so only one different account becomes owner", async () => {
      const outcomes = await Promise.allSettled(
        ids.map((id) => call(id, confirm(id))),
      );
      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        (
          outcomes.find(
            (outcome) => outcome.status === "rejected",
          ) as PromiseRejectedResult
        ).reason,
      ).toMatchObject({ status: 409 });
      expect(
        await db`SELECT id FROM ${db(schema)}.users WHERE role='owner'`,
      ).toHaveLength(1);
      expect(
        await db`SELECT id FROM ${db(schema)}.admin_audit_log`,
      ).toHaveLength(1);
    });
    it("refuses replacement even when the existing owner is disabled", async () => {
      await db`UPDATE ${db(schema)}.users SET role='owner',disabled=true WHERE id=${ids[1]}`;
      await expect(call(ids[0], confirm(ids[0]))).rejects.toMatchObject({
        status: 409,
      });
      expect(
        await db`SELECT role FROM ${db(schema)}.users WHERE id=${ids[0]}`,
      ).toEqual([{ role: "user" }]);
    });
    it("refuses missing, disabled and non-native identities", async () => {
      await expect(call(randomUUID())).rejects.toMatchObject({ status: 404 });
      await db`UPDATE ${db(schema)}.users SET disabled=true WHERE id=${ids[0]}`;
      await expect(call()).rejects.toMatchObject({ status: 400 });
      await db`DELETE FROM ${db(schema)}.user_credentials WHERE user_id=${ids[1]}`;
      await expect(call(ids[1], confirm(ids[1]))).rejects.toMatchObject({
        status: 400,
      });
      expect(
        await db`SELECT id FROM ${db(schema)}.admin_audit_log`,
      ).toHaveLength(0);
    });
  },
);
