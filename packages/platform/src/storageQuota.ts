import type { TransactionSql } from "postgres";
import type { db } from "@tell-aviv/database";

export const MIN_STORAGE_QUOTA = 1024 ** 2;
export const MAX_STORAGE_QUOTA = 100 * 1024 ** 3;

export function defaultStorageQuota(): number {
  const configured = Number(process.env.STORAGE_QUOTA_BYTES ?? 2 * 1024 ** 3);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : 2 * 1024 ** 3;
}

/** Include trashed school files and unattached chat uploads while their bytes exist.
 * Callers that reserve upload space must first lock the same users row FOR UPDATE.
 */
export async function storageUsage(
  sql: typeof db | TransactionSql,
  userId: string,
) {
  const [row] = await sql`SELECT
    (SELECT coalesce(sum((data->>'size')::bigint),0) FROM school_resources WHERE owner_id=${userId} AND kind='file')
      + (SELECT coalesce(sum(bytes),0) FROM chat_attachments WHERE owner_id=${userId})
      + (SELECT coalesce(sum(bytes),0) FROM server_emojis WHERE owner_id=${userId}) AS usage_bytes,
    (SELECT quota_bytes FROM user_storage_quotas WHERE user_id=${userId}) AS quota_bytes`;
  return {
    usageBytes: Number(row.usage_bytes),
    quotaBytes:
      row.quota_bytes === null
        ? defaultStorageQuota()
        : Number(row.quota_bytes),
    customQuota: row.quota_bytes !== null,
  };
}
