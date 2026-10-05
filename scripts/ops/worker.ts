import { db } from "@tell-aviv/database";
import type { Json } from "@tell-aviv/shared";
import { generateSchoolReminders } from "../../packages/platform/src/classes/reminders";
import { purgeExpiredSchoolTrash } from "../../packages/platform/src/classes/lifecycle";
import { processStorageCleanup } from "../../packages/platform/src/account";
import {
  checkObjectStorage,
  reconcileStorage,
  storageOperationsHealth,
} from "../../packages/platform/src/storageReconciliation";
import { pruneBackups } from "./backup";
import { createProtectedBackup } from "./protectedBackup";
import { recordBackupStatus } from "../../packages/platform/src/backupStatus";
import {
  expireCasinoOffers,
  publishCasinoMarketUpdate,
} from "../../packages/platform/src/casinoMarketplace";
import { expireCasinoPokerHands } from "../../packages/platform/src/casinoPoker";
interface WorkerState {
  reminderCursor?: string;
  objectCursor?: string;
  metadataCursor?: string;
  lastBackupAt?: string;
  lastProbeAt?: string;
}
export interface WorkerOptions {
  apply?: boolean;
  ownerId?: string;
  keys?: readonly string[];
  limit?: number;
  backupEnabled?: boolean;
  backupRoot?: string;
  backupEveryHours?: number;
  retainDays?: number;
  minKeep?: number;
  probe?: boolean;
  now?: Date;
  tasks?: readonly (
    | "reminders"
    | "storage"
    | "trash"
    | "reconcile"
    | "backup"
    | "retention"
    | "marketplace"
  )[];
}
/** One bounded pass, guarded against duplicate workers. Tests scope ownerId/keys to their own fixtures. */
export async function operationsPass(options: WorkerOptions = {}) {
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 100))),
    now = options.now ?? new Date();
  if (!Number.isFinite(limit) || !Number.isFinite(now.getTime()))
    throw Error("Invalid worker limits");
  const tasks = new Set(
    options.tasks ?? [
      "reminders",
      "trash",
      "storage",
      "reconcile",
      "backup",
      "retention",
      "marketplace",
    ],
  );
  return db.begin(async (tx) => {
    const [lock] =
      await tx`select pg_try_advisory_xact_lock(719024) as acquired`;
    if (!lock.acquired)
      return { locked: true, applied: false, failures: 0, tasks: {} };
    const [previous] =
      await tx`select data from operation_state where name='ops-worker:v1'`;
    const state: WorkerState = {
      ...(options.ownerId || options.keys ? {} : (previous?.data ?? {})),
    };
    const results: Record<string, unknown> = {};
    let failures = 0;
    async function attempt(name: string, work: () => Promise<unknown>) {
      try {
        results[name] = await work();
      } catch (error) {
        failures++;
        results[name] = {
          ok: false,
          error:
            "Operation failed; retry after checking this operation's configuration and integrity.",
          errorCode:
            typeof (error as { code?: unknown })?.code === "string" &&
            /^[A-Z0-9_]{2,30}$/.test((error as { code: string }).code)
              ? (error as { code: string }).code
              : error instanceof Error
                ? error.name
                : "UnknownError",
        };
      }
    }
    if (tasks.has("reminders"))
      await attempt("reminders", async () => {
        const users =
          await db`select id from users where disabled=false and (${options.ownerId === undefined} or id=${options.ownerId ?? null}) and (${options.ownerId !== undefined || !state.reminderCursor} or id>${state.reminderCursor ?? "00000000-0000-0000-0000-000000000000"}::uuid) order by id limit ${limit + 1}`;
        let generated = 0;
        for (const user of users.slice(0, limit))
          if (options.apply)
            generated += (await generateSchoolReminders(user.id)).generated;
        state.reminderCursor =
          users.length > limit ? users[limit - 1]?.id : undefined;
        return {
          accounts: Math.min(users.length, limit),
          generated,
          dryRun: !options.apply,
        };
      });
    if (tasks.has("trash"))
      await attempt("trash", async () =>
        options.apply
          ? purgeExpiredSchoolTrash({ ownerId: options.ownerId, limit, now })
          : {
              dryRun: true,
              eligible: Number(
                (
                  await db`select count(*) from school_resources where deleted_at<=${new Date(now.getTime() - 30 * 86400000).toISOString()} and (${options.ownerId === undefined} or owner_id=${options.ownerId ?? null})`
                )[0].count,
              ),
            },
      );
    if (tasks.has("storage"))
      await attempt("storage", async () =>
        options.apply
          ? processStorageCleanup(limit, options.keys)
          : { dryRun: true, ...(await storageOperationsHealth()) },
      );
    if (tasks.has("marketplace"))
      await attempt("marketplace", async () => {
        if (!options.apply)
          return {
            dryRun: true,
            eligible: Number(
              (
                await db`select count(*) from casino_trade_offers where status='pending' and expires_at<=now() and (${options.ownerId === undefined} or sender_id=${options.ownerId ?? null} or recipient_id=${options.ownerId ?? null})`
              )[0].count,
            ),
          };
        const expired = await expireCasinoOffers(limit, options.ownerId);
        const refundedPokerHands = await expireCasinoPokerHands(
          limit,
          options.ownerId,
        );
        if (expired || refundedPokerHands)
          await publishCasinoMarketUpdate("maintenance");
        return { expired, refundedPokerHands };
      });
    if (tasks.has("reconcile"))
      await attempt("reconciliation", async () => {
        const report = await reconcileStorage({
          apply: options.apply,
          persist: options.apply,
          limit,
          keys: options.keys,
          objectCursor: state.objectCursor,
          metadataCursor: state.metadataCursor,
          now,
        });
        state.objectCursor = report.objectCursor ?? undefined;
        state.metadataCursor = report.metadataCursor ?? undefined;
        return report;
      });
    if (
      options.apply &&
      options.probe !== false &&
      (!state.lastProbeAt ||
        now.getTime() - new Date(state.lastProbeAt).getTime() >= 10 * 60000)
    )
      await attempt("provider", async () => {
        state.lastProbeAt = now.toISOString();
        const result = await checkObjectStorage();
        return result;
      });
    const backupEveryHours = options.backupEveryHours ?? 24;
    if (!Number.isFinite(backupEveryHours) || backupEveryHours < 1)
      throw Error("Invalid backup schedule");
    if (
      tasks.has("backup") &&
      options.backupEnabled &&
      (!state.lastBackupAt ||
        now.getTime() - new Date(state.lastBackupAt).getTime() >=
          backupEveryHours * 3600000)
    )
      await attempt("backup", async () => {
        if (!options.apply) return { dryRun: true, due: true };
        const backup = await createProtectedBackup({
          root: options.backupRoot,
          now,
        });
        state.lastBackupAt = now.toISOString();
        return {
          ok: true,
          directory: backup.directory,
          objects: backup.manifest.uploads.length,
          databaseBytes: backup.manifest.databaseBytes,
        };
      });
    if (tasks.has("retention"))
      await attempt("backupRetention", async () => {
        const result = await pruneBackups({
          root: options.backupRoot,
          retainDays: options.retainDays,
          minKeep: options.minKeep,
          apply: options.apply,
          now,
        });
        if (options.apply && !options.ownerId && !options.keys)
          await recordBackupStatus("retention", {
            at: now.toISOString(),
            retainDays: options.retainDays ?? 14,
            minKeep: options.minKeep ?? 7,
            retained: result.retained,
            candidates: result.candidates.length,
            removed: result.removed,
            rejected: result.rejected,
          });
        return result;
      });
    const report = {
      locked: false,
      applied: !!options.apply,
      failures,
      tasks: results,
    };
    if (options.apply && !options.ownerId && !options.keys) {
      const recorded = JSON.parse(
        JSON.stringify({
          ...state,
          lastRunAt: now.toISOString(),
          lastFailures: failures,
          tasks: results,
        }),
      ) as Json;
      await tx`insert into operation_state(name,data) values('ops-worker:v1',${tx.json(recorded)}) on conflict(name) do update set data=excluded.data,updated_at=now()`;
    }
    return report;
  });
}
