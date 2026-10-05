import { db } from "@tell-aviv/database";
import { ApiError } from "@tell-aviv/shared";
import {
  getStorageProvider,
  storageKeyIsValid,
  type StorageProvider,
} from "../../storage/src/index";
import { lockStorageKey } from "./storageCleanup";
import { randomUUID } from "node:crypto";

type FindingKind = "orphan-object" | "missing-object" | "size-mismatch";
const DAY = 86400000;
const uuid = /^[0-9a-f-]{36}$/;
interface ReconciliationOptions {
  apply?: boolean;
  persist?: boolean;
  limit?: number;
  graceMs?: number;
  objectCursor?: string;
  metadataCursor?: string;
  keys?: readonly string[];
  provider?: StorageProvider;
  now?: Date;
}
/** Reports missing bytes; it never deletes school/chat metadata or private content. */
export async function reconcileStorage(options: ReconciliationOptions = {}) {
  const provider = options.provider ?? getStorageProvider();
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 100)));
  const graceMs = options.graceMs ?? DAY;
  const now = options.now ?? new Date();
  if (
    !Number.isFinite(limit) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(graceMs) ||
    graceMs < 3600000
  )
    throw new ApiError(400, "Invalid reconciliation limits");
  if (options.metadataCursor && !uuid.test(options.metadataCursor))
    throw new ApiError(400, "Invalid metadata cursor");
  if (options.keys?.some((key) => !storageKeyIsValid(key)))
    throw new ApiError(400, "Invalid storage keys");
  const persist = options.persist !== false;
  const report = {
    objectsChecked: 0,
    metadataChecked: 0,
    orphans: 0,
    missing: 0,
    mismatched: 0,
    queued: 0,
    unavailable: 0,
    objectCursor: null as string | null,
    metadataCursor: null as string | null,
  };
  async function finding(
    key: string,
    kind: FindingKind,
    expected: number | null,
    actual: number | null,
  ) {
    if (persist)
      await db`insert into storage_integrity_findings(storage_key,kind,expected_bytes,actual_bytes) values(${key},${kind},${expected},${actual}) on conflict(storage_key,kind) do update set first_detected_at=case when storage_integrity_findings.resolved_at is null then storage_integrity_findings.first_detected_at else now() end,last_detected_at=now(),resolved_at=null,expected_bytes=excluded.expected_bytes,actual_bytes=excluded.actual_bytes`;
  }
  async function resolveFinding(key: string, kind: FindingKind) {
    if (persist)
      await db`update storage_integrity_findings set resolved_at=now(),last_detected_at=now() where storage_key=${key} and kind=${kind} and resolved_at is null`;
  }
  async function referenced(key: string) {
    const [row] =
      await db`select exists(select 1 from school_resources where kind='file' and data->>'key'=${key}) or exists(select 1 from chat_attachments where storage_key=${key}) as present`;
    return Boolean(row.present);
  }
  const page = options.keys
    ? {
        objects: (
          await Promise.all(
            options.keys.slice(0, limit).map((key) => provider.head(key)),
          )
        ).filter((item): item is NonNullable<typeof item> => item !== null),
        nextCursor: null,
      }
    : await provider.list({ cursor: options.objectCursor, limit });
  report.objectCursor = page.nextCursor;
  for (const object of page.objects) {
    report.objectsChecked++;
    if (await referenced(object.key)) {
      await resolveFinding(object.key, "orphan-object");
      continue;
    }
    if (new Date(object.modifiedAt).getTime() > now.getTime() - graceMs)
      continue;
    report.orphans++;
    await finding(object.key, "orphan-object", null, object.size);
    if (!options.apply) continue;
    await db.begin(async (tx) => {
      await lockStorageKey(tx, object.key);
      const [metadata] =
        await tx`select exists(select 1 from school_resources where kind='file' and data->>'key'=${object.key}) or exists(select 1 from chat_attachments where storage_key=${object.key}) as present`;
      if (metadata.present) return;
      const current = await provider.head(object.key);
      if (
        !current ||
        new Date(current.modifiedAt).getTime() > now.getTime() - graceMs
      )
        return;
      const queued =
        await tx`insert into storage_cleanup_jobs(storage_key) values(${object.key}) on conflict do nothing returning storage_key`;
      report.queued += queued.length;
    });
  }
  const metadata = await db`with referenced as (
  select data->>'key' as key,case when data->>'size'~'^[0-9]{1,16}$' then (data->>'size')::bigint else null end as expected from school_resources where kind='file'
  union all select storage_key::text,bytes from chat_attachments
 ) select key,max(expected) as expected from referenced where key~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and (${options.metadataCursor === undefined} or key>${options.metadataCursor ?? ""}) and (${options.keys === undefined} or key=any(${options.keys ? [...options.keys] : []}::text[])) group by key order by key limit ${limit + 1}`;
  const batch = metadata.slice(0, limit);
  report.metadataCursor =
    metadata.length > limit ? (batch.at(-1)?.key ?? null) : null;
  for (const row of batch) {
    report.metadataChecked++;
    try {
      const object = await provider.head(row.key);
      if (!object) {
        report.missing++;
        await finding(
          row.key,
          "missing-object",
          row.expected === null ? null : Number(row.expected),
          null,
        );
        continue;
      }
      await resolveFinding(row.key, "missing-object");
      if (row.expected !== null && Number(row.expected) !== object.size) {
        report.mismatched++;
        await finding(
          row.key,
          "size-mismatch",
          Number(row.expected),
          object.size,
        );
      } else await resolveFinding(row.key, "size-mismatch");
    } catch {
      report.unavailable++;
    }
  }
  const findings =
    await db`select storage_key,kind from storage_integrity_findings where resolved_at is null and (${options.keys === undefined} or storage_key=any(${options.keys ? [...options.keys] : []}::uuid[])) order by last_detected_at,storage_key limit ${limit}`;
  for (const row of findings) {
    try {
      const present = await referenced(row.storage_key);
      if (!present) {
        const object = await provider.head(row.storage_key);
        if (!object || row.kind !== "orphan-object")
          await resolveFinding(row.storage_key, row.kind as FindingKind);
      }
      if (persist)
        await db`update storage_integrity_findings set last_detected_at=now() where storage_key=${row.storage_key} and kind=${row.kind}`;
    } catch {
      report.unavailable++;
    }
  }
  return report;
}
/** A private generated object proves provider put/head/read/delete; failed cleanup enters the outbox. */
export async function checkObjectStorage(provider = getStorageProvider()) {
  const key = randomUUID(),
    bytes = new TextEncoder().encode(
      "Tell Aviv private storage readiness probe",
    );
  let uploaded = false;
  try {
    // PUT can succeed remotely even when its response fails, so attempt cleanup in either case.
    uploaded = true;
    await provider.put(key, bytes);
    const info = await provider.head(key),
      read = await provider.read(key);
    if (
      !info ||
      info.size !== bytes.length ||
      !Buffer.from(read).equals(Buffer.from(bytes))
    )
      throw new ApiError(503, "Object storage readiness verification failed");
    return { ok: true, provider: process.env.STORAGE_PROVIDER ?? "local" };
  } finally {
    if (uploaded)
      try {
        await provider.delete(key);
      } catch {
        await db`insert into storage_cleanup_jobs(storage_key) values(${key}) on conflict do nothing`;
        throw new ApiError(
          503,
          "Object storage readiness cleanup failed; deletion was queued for retry",
        );
      }
  }
}
export async function storageOperationsHealth() {
  const [cleanup] =
    await db`select count(*)::int as pending,count(*) filter(where attempts>=3)::int as retrying,max(attempts)::int as highest_attempts,min(created_at) as oldest_pending_at from storage_cleanup_jobs`;
  const [integrity] =
    await db`select count(*) filter(where kind='orphan-object')::int as orphan_objects,count(*) filter(where kind='missing-object')::int as missing_objects,count(*) filter(where kind='size-mismatch')::int as size_mismatches from storage_integrity_findings where resolved_at is null`;
  return { cleanup, integrity };
}
