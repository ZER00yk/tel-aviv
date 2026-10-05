import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, getUser } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import { getStorageProvider, storeFile } from "../packages/storage/src/index";
import {
  reconcileStorage,
  checkObjectStorage,
} from "../packages/platform/src/storageReconciliation";
import { assertUploadBindable } from "../packages/platform/src/storageCleanup";
import { processStorageCleanup } from "../packages/platform/src/account";
import { operationsPass } from "../scripts/ops/worker";
import { withUploadSnapshot } from "../scripts/ops/backup";

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "storage reconciliation with scoped fixture objects",
  () => {
    let directory: string, owner: User, classId: string;
    const keys: string[] = [];
    async function bytes(text = "fixture") {
      const key = await storeFile(new TextEncoder().encode(text));
      keys.push(key);
      return key;
    }
    async function metadata(key: string, size = 7) {
      const [row] =
        await db`insert into school_resources(class_id,owner_id,kind,title,data) values(${classId},${owner.id},'file','Fixture private upload',${db.json({ key, name: "fixture.txt", mime: "text/plain", size })}) returning id`;
      return row.id as string;
    }
    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "ta-reconcile-"));
      vi.stubEnv("STORAGE_PROVIDER", "local");
      vi.stubEnv("STORAGE_LOCAL_PATH", directory);
      const id = randomUUID();
      await db`insert into users(id,username,display_name) values(${id},${`opfixture_${id.slice(0, 8)}`},'Operations fixture')`;
      owner = (await getUser(id))!;
      const [cls] =
        await db`insert into school_classes(owner_id,name) values(${owner.id},'Operations fixture') returning id`;
      classId = cls.id;
    });
    afterAll(async () => {
      if (classId) await db`delete from school_classes where id=${classId}`;
      if (owner) await db`delete from users where id=${owner.id}`;
      if (keys.length) {
        await db`delete from storage_cleanup_jobs where storage_key=any(${keys}::uuid[])`;
        await db`delete from storage_integrity_findings where storage_key=any(${keys}::uuid[])`;
      }
      vi.unstubAllEnvs();
      if (directory) await rm(directory, { recursive: true, force: true });
    });
    it("protects live and recent objects, reports orphan bytes and queues only explicitly applied expired orphans", async () => {
      const live = await bytes(),
        orphan = await bytes("orphan"),
        recent = await bytes("recent");
      await metadata(live);
      const old = new Date(Date.now() - 2 * 86400000);
      await utimes(join(directory, orphan), old, old);
      const dry = await reconcileStorage({
        keys: [live, orphan, recent],
        persist: false,
      });
      expect(dry).toMatchObject({ orphans: 1, queued: 0, missing: 0 });
      expect(
        await db`select storage_key from storage_cleanup_jobs where storage_key=any(${[live, orphan, recent]}::uuid[])`,
      ).toHaveLength(0);
      const applied = await reconcileStorage({
        keys: [live, orphan, recent],
        apply: true,
      });
      expect(applied.queued).toBe(1);
      expect(await getStorageProvider().head(orphan)).not.toBeNull();
      await expect(
        db.begin((tx) => assertUploadBindable(tx, orphan)),
      ).rejects.toMatchObject({ status: 409 });
      await processStorageCleanup(10, [orphan]);
      expect(await getStorageProvider().head(orphan)).toBeNull();
      await expect(
        db.begin((tx) => assertUploadBindable(tx, orphan)),
      ).rejects.toMatchObject({ status: 409 });
      expect(await getStorageProvider().head(live)).not.toBeNull();
      expect(await getStorageProvider().head(recent)).not.toBeNull();
      await reconcileStorage({ keys: [orphan], apply: true });
      expect(
        (
          await db`select resolved_at from storage_integrity_findings where storage_key=${orphan} and kind='orphan-object'`
        )[0].resolved_at,
      ).not.toBeNull();
    });
    it("records missing/mismatched objects without removing private metadata, then resolves repaired bytes", async () => {
      const missing = randomUUID();
      keys.push(missing);
      const id = await metadata(missing);
      const mismatch = await bytes("size mismatch");
      await metadata(mismatch, 1);
      const report = await reconcileStorage({ keys: [missing, mismatch] });
      expect(report).toMatchObject({ missing: 1, mismatched: 1 });
      expect(
        await db`select id from school_resources where id=${id}`,
      ).toHaveLength(1);
      await getStorageProvider().put(
        missing,
        new TextEncoder().encode("fixture"),
      );
      await db`update school_resources set data=jsonb_set(data,'{size}',${db.json("13")}::jsonb) where kind='file' and data->>'key'=${mismatch}`;
      await reconcileStorage({ keys: [missing, mismatch] });
      expect(
        (
          await db`select resolved_at from storage_integrity_findings where storage_key=any(${[missing, mismatch]}::uuid[])`
        ).every((row) => row.resolved_at),
      ).toBe(true);
    });
    it("rechecks existing metadata before retry cleanup and keeps referenced bytes alive", async () => {
      const key = await bytes();
      await metadata(key);
      await db`insert into storage_cleanup_jobs(storage_key) values(${key})`;
      await processStorageCleanup(10, [key]);
      expect(await getStorageProvider().head(key)).not.toBeNull();
      expect(
        await db`select storage_key from storage_cleanup_jobs where storage_key=${key}`,
      ).toHaveLength(0);
    });
    it("runs scoped scheduler retention/reminders/outbox safely and leaves recent trash intact", async () => {
      const expiredKey = await bytes(),
        recentKey = await bytes();
      const expired = await metadata(expiredKey),
        recent = await metadata(recentKey);
      await db`update school_resources set deleted_at=now()-interval '31 days' where id=${expired}`;
      await db`update school_resources set deleted_at=now()-interval '1 day' where id=${recent}`;
      const [assignment] =
        await db`insert into school_resources(class_id,owner_id,kind,title,data) values(${classId},${owner.id},'assignment','Fixture due work',${db.json({ dueDate: new Date(Date.now() + 60000).toISOString(), status: "not-started" })}) returning id`;
      const dry = await operationsPass({
        ownerId: owner.id,
        keys: [expiredKey, recentKey],
        tasks: ["trash", "storage", "reminders"],
        probe: false,
      });
      expect(dry.failures).toBe(0);
      expect(
        await db`select id from school_resources where id=${expired}`,
      ).toHaveLength(1);
      const applied = await operationsPass({
        apply: true,
        ownerId: owner.id,
        keys: [expiredKey, recentKey],
        tasks: ["trash", "storage", "reminders"],
        probe: false,
      });
      expect(applied.failures).toBe(0);
      expect(
        await db`select id from school_resources where id=${expired}`,
      ).toHaveLength(0);
      expect(
        await db`select id from school_resources where id=${recent}`,
      ).toHaveLength(1);
      expect(await getStorageProvider().head(expiredKey)).toBeNull();
      expect(await getStorageProvider().head(recentKey)).not.toBeNull();
      expect(
        await db`select resource_id from school_reminder_deliveries where user_id=${owner.id} and resource_id=${assignment.id}`,
      ).toHaveLength(1);
      const again = await operationsPass({
        apply: true,
        ownerId: owner.id,
        keys: [expiredKey, recentKey],
        tasks: ["reminders"],
        probe: false,
      });
      expect(again.failures).toBe(0);
      expect(
        await db`select resource_id from school_reminder_deliveries where user_id=${owner.id} and resource_id=${assignment.id}`,
      ).toHaveLength(1);
    });
    it("checks put/head/read/delete against only a generated local probe object", async () => {
      expect(await checkObjectStorage()).toMatchObject({
        ok: true,
        provider: "local",
      });
    });
    it("persists a failed readiness-probe deletion for retry without treating the provider as ready", async () => {
      const provider = getStorageProvider();
      let probeKey = "";
      await expect(
        checkObjectStorage({
          put: async (key, bytes) => {
            probeKey = key;
            keys.push(key);
            await provider.put(key, bytes);
          },
          head: (key) => provider.head(key),
          read: (key) => provider.read(key),
          delete: async () => {
            throw Error("Fixture provider deletion outage");
          },
          list: (options) => provider.list(options),
        }),
      ).rejects.toMatchObject({ status: 503 });
      expect(
        await db`select storage_key from storage_cleanup_jobs where storage_key=${probeKey}`,
      ).toHaveLength(1);
      await processStorageCleanup(1, [probeKey]);
      expect(await provider.head(probeKey)).toBeNull();
    });
    it("keeps snapshot-referenced bytes until copy finishes even after metadata deletion commits", async () => {
      const key = await bytes(),
        resourceId = await metadata(key),
        provider = getStorageProvider();
      let ready!: () => void, finish!: () => void;
      const snapshotReady = new Promise<void>((resolve) => {
          ready = resolve;
        }),
        copyMayFinish = new Promise<void>((resolve) => {
          finish = resolve;
        });
      const snapshot = withUploadSnapshot(async (tx) => {
        const rows =
          await tx`select id from school_resources where id=${resourceId}`;
        expect(rows).toHaveLength(1);
        ready();
        await copyMayFinish;
        expect(
          await tx`select id from school_resources where id=${resourceId}`,
        ).toHaveLength(1);
        return provider.read(key);
      });
      try {
        await snapshotReady;
        await db.begin(async (tx) => {
          await tx`insert into storage_cleanup_jobs(storage_key) values(${key})`;
          await tx`delete from school_resources where id=${resourceId}`;
        });
        const cleanup = processStorageCleanup(1, [key]);
        const removedEarly = await Promise.race([
          cleanup.then(() => true),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(false), 50),
          ),
        ]);
        expect(removedEarly).toBe(false);
        expect(await provider.head(key)).not.toBeNull();
        finish();
        expect(new TextDecoder().decode(await snapshot)).toBe("fixture");
        await cleanup;
        expect(await provider.head(key)).toBeNull();
      } finally {
        finish();
        await snapshot;
      }
    });
  },
);
