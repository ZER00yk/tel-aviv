import { db } from "@tell-aviv/database";
import { ApiError } from "@tell-aviv/shared";
import type { Sql } from "postgres";

export const SCHOOL_TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export function trashCutoff(now = new Date()) {
  if (!Number.isFinite(now.getTime()))
    throw new ApiError(400, "Invalid retention date");
  return new Date(now.getTime() - SCHOOL_TRASH_RETENTION_DAYS * DAY_MS);
}
async function enqueueSubtreeFiles(tx: Sql, resourceIds: string[]) {
  const queued = await tx`with recursive subtree as (
    select id,parent_id,kind,data from school_resources where id in ${tx(resourceIds)}
    union select r.id,r.parent_id,r.kind,r.data from school_resources r join subtree p on r.parent_id=p.id
  ) insert into storage_cleanup_jobs(storage_key)
    select distinct (data->>'key')::uuid from subtree where kind='file'
    on conflict do nothing returning storage_key`;
  return queued.length;
}

/** The class lock serializes lifecycle changes against moves and file reservations. */
export async function permanentlyDeleteSchoolResource(
  resourceId: string,
  ownerId: string,
) {
  return db.begin(async (tx) => {
    const [cls] =
      await tx`select c.id from school_classes c join school_resources r on r.class_id=c.id where r.id=${resourceId} and c.owner_id=${ownerId} for update of c`;
    if (!cls) throw new ApiError(404, "Resource not found");
    const [resource] =
      await tx`select id,deleted_at from school_resources where id=${resourceId} and owner_id=${ownerId} for update`;
    if (!resource) throw new ApiError(404, "Resource not found");
    if (!resource.deleted_at)
      throw new ApiError(400, "Move this resource to trash first");
    const queuedFiles = await enqueueSubtreeFiles(tx as unknown as Sql, [
      resourceId,
    ]);
    await tx`delete from school_resources where id=${resourceId} and owner_id=${ownerId}`;
    return { deleted: true, queuedFiles };
  });
}
export async function deleteSchoolClass(
  classId: string,
  ownerId: string,
  confirmation: string,
) {
  return db.begin(async (tx) => {
    const [cls] =
      await tx`select id,name from school_classes where id=${classId} and owner_id=${ownerId} for update`;
    if (!cls) throw new ApiError(404, "Class not found");
    if (confirmation !== `DELETE ${cls.name}`)
      throw new ApiError(
        400,
        "Type DELETE followed by the current class name to confirm",
      );
    const queued =
      await tx`insert into storage_cleanup_jobs(storage_key) select distinct (data->>'key')::uuid from school_resources where class_id=${classId} and kind='file' on conflict do nothing returning storage_key`;
    await tx`delete from school_classes where id=${classId} and owner_id=${ownerId}`;
    return { deleted: true, queuedFiles: queued.length };
  });
}

/** Internal scheduler entrypoint. Tests must scope ownerId to their isolated fixture. */
export async function purgeExpiredSchoolTrash(
  options: { ownerId?: string; now?: Date; limit?: number } = {},
) {
  const cutoff = trashCutoff(options.now);
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 100)));
  if (!Number.isFinite(limit))
    throw new ApiError(400, "Invalid retention batch size");
  const classes =
    await db`select distinct class_id from school_resources where deleted_at<=${cutoff.toISOString()} and (${!options.ownerId} or owner_id=${options.ownerId ?? null}) order by class_id limit ${limit}`;
  let purgedRoots = 0;
  let queuedFiles = 0;
  for (const row of classes) {
    if (purgedRoots >= limit) break;
    const result = await db.begin(async (tx) => {
      const [cls] =
        await tx`select id from school_classes where id=${row.class_id} and (${!options.ownerId} or owner_id=${options.ownerId ?? null}) for update skip locked`;
      if (!cls) return { roots: 0, queued: 0 };
      // Recheck after taking the class lock so a just-restored resource is preserved.
      const resources =
        await tx`select id from school_resources where class_id=${cls.id} and deleted_at<=${cutoff.toISOString()} order by deleted_at,id limit ${limit - purgedRoots} for update`;
      if (!resources.length) return { roots: 0, queued: 0 };
      const ids = resources.map((resource) => resource.id as string);
      const queued = await enqueueSubtreeFiles(tx as unknown as Sql, ids);
      await tx`delete from school_resources where id in ${tx(ids)}`;
      return { roots: resources.length, queued };
    });
    purgedRoots += result.roots;
    queuedFiles += result.queued;
  }
  return {
    purgedRoots,
    queuedFiles,
    cutoff: cutoff.toISOString(),
    retentionDays: SCHOOL_TRASH_RETENTION_DAYS,
  };
}
