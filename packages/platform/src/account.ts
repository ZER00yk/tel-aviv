import { cancelCasinoPokerForAccount, casinoPokerHistory } from "./casinoPoker";
import { requireRecentAuthentication } from "@tell-aviv/auth";
import { db } from "@tell-aviv/database";
import { fail, type ApiHandler } from "@tell-aviv/shared";
import { z } from "zod";
import { deleteFile } from "../../storage/src/index";
import { queueChatAttachmentCleanup, lockStorageKey } from "./storageCleanup";
import { egoRankedExport } from "./egoRanked";
import {
  cancelCasinoOffersForAccount,
  casinoMarketplaceExport,
} from "./casinoMarketplace";

/** Export only this account's records. Never include session digests or other users' notes. */
export async function exportAccount(userId: string) {
  return db.begin("isolation level repeatable read read only", async (tx) => {
    const [profile] =
      await tx`SELECT id,email,username,display_name,avatar,banner,bio,status,xp,settings,created_at FROM users WHERE id=${userId}`;
    if (!profile) fail(404, "Account not found");
    return {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      profile,
      usernameHistory:
        await tx`SELECT username,changed_at FROM username_history WHERE user_id=${userId} ORDER BY changed_at`,
      friends:
        await tx`SELECT CASE WHEN user_low=${userId} THEN user_high ELSE user_low END AS friend_id,created_at FROM friendships WHERE user_low=${userId} OR user_high=${userId}`,
      friendPreferences:
        await tx`SELECT friend_id,favorite,close_friend,muted,nickname,note FROM friend_preferences WHERE user_id=${userId}`,
      blocks:
        await tx`SELECT blocked_id,created_at FROM user_blocks WHERE user_id=${userId}`,
      messages:
        await tx`SELECT id,room_id,content,reply_to,thread_id,created_at,edited_at,deleted_at FROM chat_messages WHERE author_id=${userId} ORDER BY created_at`,
      attachments:
        await tx`SELECT id,room_id,message_id,filename,mime,bytes,created_at FROM chat_attachments WHERE owner_id=${userId}`,
      classes:
        await tx`SELECT id,name,color,created_at FROM school_classes WHERE owner_id=${userId}`,
      resources:
        await tx`SELECT id,class_id,parent_id,kind,title,data-'key' AS data,version,deleted_at,created_at,updated_at FROM school_resources WHERE owner_id=${userId}`,
      resourceVersions:
        await tx`SELECT r.id,r.resource_id,r.version,r.title,r.data-'key' AS data,r.created_at FROM school_revisions r JOIN school_resources s ON s.id=r.resource_id WHERE s.owner_id=${userId}`,
      shares:
        await tx`SELECT sh.resource_id,sh.user_id,sh.permission,sh.created_at FROM school_shares sh JOIN school_resources s ON s.id=sh.resource_id WHERE s.owner_id=${userId}`,
      quizAttempts:
        await tx`SELECT resource_id,score,total,resource_version,breakdown,created_at FROM school_quiz_attempts WHERE user_id=${userId}`,
      flashcardProgress:
        await tx`SELECT resource_id,card_key,due_at,interval_seconds,streak,review_count,last_review_at FROM flashcard_progress WHERE user_id=${userId}`,
      flashcardReviews:
        await tx`SELECT resource_id,card_key,rating,front,back,interval_seconds,due_at,created_at FROM school_flashcard_reviews WHERE user_id=${userId} ORDER BY created_at`,
      assignmentHistory:
        await tx`SELECT h.resource_id,h.version,h.previous_status,h.status,h.due_at,h.created_at FROM school_assignment_history h JOIN school_resources r ON r.id=h.resource_id WHERE r.owner_id=${userId} ORDER BY h.created_at`,
      egoRanked: await egoRankedExport(tx, userId),
      casinoMarketplace: await casinoMarketplaceExport(tx, userId),
      casinoPoker: await casinoPokerHistory(tx, userId, true),
      creatorCompletions:
        await tx`SELECT creation_id,creation_version,ticks,deaths,completed_at FROM creator_completions WHERE user_id=${userId} ORDER BY completed_at`,
      creatorCommunity: {
        collaboratorGrants:
          await tx`SELECT creation_id,user_id,permission,created_at FROM creation_collaborators WHERE invited_by=${userId} OR user_id=${userId}`,
        follows:
          await tx`SELECT creator_id,created_at FROM creator_follows WHERE follower_id=${userId}`,
        difficultyRatings:
          await tx`SELECT creation_id,rating,updated_at FROM creation_difficulty_ratings WHERE user_id=${userId}`,
        reports:
          await tx`SELECT creation_id,reason,details,status,created_at FROM creation_reports WHERE reporter_id=${userId}`,
      },
      creations:
        await tx`SELECT id,title,description,category,tags,level,version,published,plays,created_at,updated_at FROM creations WHERE owner_id=${userId}`,
      gameSaves:
        await tx`SELECT game_id,schema_version,revision,data,updated_at FROM game_saves WHERE user_id=${userId}`,
      playHistory:
        await tx`SELECT game_id,started_at,ended_at,mode FROM game_play_sessions WHERE user_id=${userId}`,
      achievements:
        await tx`SELECT achievement_id,unlocked_at FROM user_achievements WHERE user_id=${userId}`,
      balances:
        await tx`SELECT currency,balance FROM currency_accounts WHERE user_id=${userId}`,
      ledger:
        await tx`SELECT currency,amount,balance_after,reason,created_at FROM currency_ledger WHERE user_id=${userId} ORDER BY created_at`,
      inventory:
        await tx`SELECT item_id,acquired_at FROM cosmetic_inventory WHERE user_id=${userId}`,
      collectibles:
        await tx`SELECT id,item_id,serial,acquired_at FROM casino_collectibles WHERE user_id=${userId}`,
    };
  });
}

/** Hard-delete personal data; preserve shared communities by transferring leadership. */
export async function deleteAccount(
  userId: string,
  confirmation: string,
  request?: Request,
) {
  await db.begin(async (tx) => {
    const [user] =
      await tx`SELECT id,username,role FROM users WHERE id=${userId} FOR UPDATE`;
    if (!user) fail(404, "Account not found");
    if (request) await requireRecentAuthentication(request, userId, tx);
    if (confirmation !== `DELETE ${user.username}`)
      fail(400, "Type DELETE followed by your username to confirm");
    if (user.role === "owner")
      fail(
        409,
        "Transfer platform ownership before deleting this owner account",
      );
    await tx`INSERT INTO storage_cleanup_jobs(storage_key) SELECT (data->>'key')::uuid FROM school_resources WHERE owner_id=${userId} AND kind='file' ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO storage_cleanup_jobs(storage_key) SELECT storage_key FROM chat_attachments WHERE owner_id=${userId} ON CONFLICT DO NOTHING`;
    await tx`DELETE FROM chat_attachments WHERE owner_id=${userId}`;
    await tx`DELETE FROM chat_pins WHERE pinned_by=${userId}`;
    await tx`DELETE FROM chat_messages WHERE author_id=${userId}`;
    await tx`DELETE FROM server_invites WHERE creator_id=${userId}`;
    await tx`DELETE FROM party_invites WHERE inviter_id=${userId}`;
    const ownedServers =
      await tx`SELECT id FROM servers WHERE owner_id=${userId} FOR UPDATE`;
    for (const server of ownedServers) {
      const [next] =
        await tx`SELECT user_id FROM server_members WHERE server_id=${server.id} AND user_id<>${userId} ORDER BY joined_at,user_id LIMIT 1`;
      if (next)
        await tx`UPDATE servers SET owner_id=${next.user_id} WHERE id=${server.id}`;
      else {
        await queueChatAttachmentCleanup(tx, {
          kind: "server",
          id: String(server.id),
        });
        await tx`DELETE FROM servers WHERE id=${server.id}`;
      }
    }
    const ledParties =
      await tx`SELECT id FROM parties WHERE leader_id=${userId} FOR UPDATE`;
    for (const party of ledParties) {
      const [next] =
        await tx`SELECT user_id FROM party_members WHERE party_id=${party.id} AND user_id<>${userId} ORDER BY joined_at,user_id LIMIT 1`;
      if (next)
        await tx`UPDATE parties SET leader_id=${next.user_id} WHERE id=${party.id}`;
      else {
        await queueChatAttachmentCleanup(tx, {
          kind: "party",
          id: String(party.id),
        });
        await tx`DELETE FROM parties WHERE id=${party.id}`;
      }
    }
    const ownedPrivateRooms =
      await tx`SELECT id FROM chat_rooms WHERE owner_id=${userId} AND kind IN ('group','dm') ORDER BY id FOR UPDATE`;
    for (const room of ownedPrivateRooms) {
      const [next] =
        await tx`SELECT user_id FROM chat_members WHERE room_id=${room.id} AND user_id<>${userId} ORDER BY joined_at,user_id LIMIT 1`;
      if (next)
        await tx`UPDATE chat_rooms SET owner_id=${next.user_id} WHERE id=${room.id}`;
      else {
        await queueChatAttachmentCleanup(tx, {
          kind: "room",
          id: String(room.id),
        });
        await tx`DELETE FROM chat_rooms WHERE id=${room.id}`;
      }
    }
    await tx`UPDATE chat_rooms r SET owner_id=(SELECT m.user_id FROM chat_members m WHERE m.room_id=r.id AND m.user_id<>${userId} ORDER BY m.joined_at,m.user_id LIMIT 1) WHERE r.owner_id=${userId}`;
    // Remove this pseudonymous ID from archived match summaries, not others' outcomes.
    await tx`UPDATE multiplayer_matches SET result=jsonb_set(jsonb_set(result,'{winners}',COALESCE((SELECT jsonb_agg(w) FROM jsonb_array_elements(result->'winners') w WHERE w<>to_jsonb(${userId}::text)),'[]'::jsonb)),'{scores}',COALESCE(result->'scores','{}'::jsonb)-${userId}) WHERE result->'scores' ? ${userId}`;
    await cancelCasinoOffersForAccount(tx, userId);
    await cancelCasinoPokerForAccount(tx, userId);
    await tx`DELETE FROM users WHERE id=${userId}`;
  });
}

/** Retryable outbox: failed deletes keep their key without retaining account data. */
export async function processStorageCleanup(
  limit = 50,
  keys?: readonly string[],
) {
  let removed = 0;
  const jobs =
    await db`SELECT storage_key FROM storage_cleanup_jobs WHERE (${keys === undefined} OR storage_key=ANY(${keys ? [...keys] : []}::uuid[])) ORDER BY COALESCE(last_attempt_at,created_at),created_at,storage_key LIMIT ${Math.max(1, Math.min(limit, 500))}`;
  for (const job of jobs)
    await db.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock_shared(hashtextextended('backup-upload-bytes:v2',719025))`;
      await lockStorageKey(tx, job.storage_key);
      const [locked] =
        await tx`SELECT storage_key FROM storage_cleanup_jobs WHERE storage_key=${job.storage_key} FOR UPDATE SKIP LOCKED`;
      if (!locked) return;
      const [live] =
        await tx`SELECT EXISTS(SELECT 1 FROM school_resources WHERE kind='file' AND data->>'key'=${locked.storage_key}) OR EXISTS(SELECT 1 FROM chat_attachments WHERE storage_key=${locked.storage_key}) AS referenced`;
      if (live.referenced) {
        await tx`DELETE FROM storage_cleanup_jobs WHERE storage_key=${locked.storage_key}`;
        return;
      }
      try {
        await deleteFile(locked.storage_key);
        await tx`DELETE FROM storage_cleanup_jobs WHERE storage_key=${locked.storage_key}`;
        removed++;
      } catch {
        await tx`UPDATE storage_cleanup_jobs SET attempts=attempts+1,last_attempt_at=now() WHERE storage_key=${locked.storage_key}`;
      }
    });
  return {
    removed,
    pending: Number(
      (await db`SELECT count(*) FROM storage_cleanup_jobs`)[0].count,
    ),
  };
}

let immediateCleanup: Promise<unknown> | null = null;
/** Best-effort wakeup. The durable queue and scheduled worker own completion. */
export function requestStorageCleanup() {
  if (process.env.STORAGE_CLEANUP_IMMEDIATE === "false") return;
  if (immediateCleanup) return;
  immediateCleanup = processStorageCleanup(10)
    .catch(() =>
      console.error("Storage cleanup remains queued for a scheduled retry."),
    )
    .finally(() => {
      immediateCleanup = null;
    });
}

export const handleAccount: ApiHandler = async (
  path,
  method,
  { user, request },
  input,
) => {
  if (path[0] !== "account") return;
  if (path[1] === "export" && method === "GET")
    return Response.json(await exportAccount(user.id), {
      headers: {
        "Content-Disposition": 'attachment; filename="tell-aviv-account.json"',
        "Cache-Control": "private, no-store",
      },
    });
  if (path[1] === "delete" && method === "POST") {
    const { confirmation } = z
      .object({ confirmation: z.string().max(100) })
      .strict()
      .parse(input);
    await deleteAccount(user.id, confirmation, request);
    requestStorageCleanup();
    return Response.json(
      { data: { deleted: true } },
      {
        headers: {
          "Set-Cookie": `ta_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
          "Cache-Control": "no-store",
        },
      },
    );
  }
  fail(404, "Account action not found");
};
