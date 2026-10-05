import type { TransactionSql } from "postgres";
import { db } from "@tell-aviv/database";
import {
  deleteFile,
  storageKeyIsValid,
  getStorageProvider,
} from "../../storage/src/index";
import { ApiError } from "@tell-aviv/shared";

/** Upload binding, orphan discovery and retry workers use the same per-object lock. */
export async function lockStorageKey(sql: TransactionSql, key: string) {
  if (!storageKeyIsValid(key)) throw new ApiError(400, "Invalid storage key");
  await sql`select pg_advisory_xact_lock(hashtextextended(${key},719023))`;
}
export async function assertUploadBindable(sql: TransactionSql, key: string) {
  await lockStorageKey(sql, key);
  const [pending] =
    await sql`select storage_key from storage_cleanup_jobs where storage_key=${key}`;
  if (pending)
    throw new ApiError(
      409,
      "This upload expired before it was attached. Upload the file again.",
    );
  if (!(await getStorageProvider().head(key)))
    throw new ApiError(
      409,
      "This upload is no longer present. Upload the file again.",
    );
}

/** Rollback cannot remove uploaded bytes. Persist failed physical deletes after
 * the metadata transaction has ended; an outbox write failure must reach the caller.
 */
export async function removeUncommittedFile(key: string): Promise<void> {
  try {
    await deleteFile(key);
  } catch {
    await db`INSERT INTO storage_cleanup_jobs(storage_key) VALUES(${key}) ON CONFLICT DO NOTHING`;
  }
}

type ChatCleanupScope = {
  kind: "message" | "room" | "server" | "party";
  id: string;
};

/** Preserve private file keys before their attachment metadata is removed.
 * Call inside the authorized deletion transaction. Server/party callers hold
 * the parent row lock so new rooms cannot appear between collection and cascade.
 * Room locks prevent an upload from committing after keys have been collected.
 */
export async function queueChatAttachmentCleanup(
  sql: TransactionSql,
  scope: ChatCleanupScope,
): Promise<void> {
  if (scope.kind === "message") {
    await sql`SELECT id FROM chat_messages WHERE id=${scope.id} FOR UPDATE`;
    await sql`INSERT INTO storage_cleanup_jobs(storage_key) SELECT storage_key FROM chat_attachments WHERE message_id=${scope.id} ON CONFLICT DO NOTHING`;
    return;
  }
  if (scope.kind === "room") {
    await sql`SELECT id FROM chat_rooms WHERE id=${scope.id} FOR UPDATE`;
    await sql`INSERT INTO storage_cleanup_jobs(storage_key) SELECT storage_key FROM chat_attachments WHERE room_id=${scope.id} ON CONFLICT DO NOTHING`;
    return;
  }
  if (scope.kind === "server") {
    await sql`SELECT id FROM chat_rooms WHERE server_id=${scope.id} ORDER BY id FOR UPDATE`;
    await sql`INSERT INTO storage_cleanup_jobs(storage_key) SELECT a.storage_key FROM chat_attachments a JOIN chat_rooms r ON r.id=a.room_id WHERE r.server_id=${scope.id} ON CONFLICT DO NOTHING`;
    return;
  }
  await sql`SELECT id FROM chat_rooms WHERE party_id=${scope.id} ORDER BY id FOR UPDATE`;
  await sql`INSERT INTO storage_cleanup_jobs(storage_key) SELECT a.storage_key FROM chat_attachments a JOIN chat_rooms r ON r.id=a.room_id WHERE r.party_id=${scope.id} ON CONFLICT DO NOTHING`;
}
