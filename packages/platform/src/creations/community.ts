import { db } from "@tell-aviv/database";
import { fail } from "@tell-aviv/shared";
import type { TransactionSql } from "postgres";
import { z } from "zod";
import { CREATOR_RUNTIME_REVISION } from "../../../creator-runtime/src/index";
type AccessCreation = {
  owner_id: string;
  version: number;
  published: boolean;
  level: unknown;
  category: string;
  [key: string]: unknown;
};

const uuid = z.string().uuid();
export const reportReasons = [
  "inappropriate",
  "harassment",
  "exploit",
  "misleading",
  "broken",
  "other",
] as const;

/** Every grant/revoke/edit shares the parent lock, so an old permission cannot commit an edit. */
export async function lockCreationAccess(
  sql: TransactionSql,
  creationId: string,
  userId: string,
  need: "read" | "edit" | "owner" = "read",
) {
  const [actor] =
    await sql`SELECT id FROM users WHERE id=${userId} AND disabled=false FOR SHARE`;
  if (!actor) fail(401, "Sign in required");
  const [creation] = await sql<
    AccessCreation[]
  >`SELECT c.* FROM creations c JOIN users u ON u.id=c.owner_id
    WHERE c.id=${creationId} AND (c.owner_id=${userId} OR u.disabled=false) FOR UPDATE OF c`;
  if (!creation) fail(404, "Creation not found");
  const owner = creation.owner_id === userId;
  const [grant] = owner
    ? []
    : await sql`SELECT permission FROM creation_collaborators WHERE creation_id=${creationId} AND user_id=${userId}`;
  if (!owner && !grant && !creation.published) fail(404, "Creation not found");
  if (need === "owner" && !owner) fail(403, "Only the creator can do this");
  if (need === "edit" && !owner && grant?.permission !== "editor")
    fail(403, "An editor grant is required");
  return {
    ...creation,
    can_edit: owner || grant?.permission === "editor",
    collaborator_permission: owner ? "owner" : (grant?.permission ?? null),
  };
}

export async function creationStatistics(creationId: string, version?: number) {
  const [statistics] = await db`SELECT
    (SELECT count(*)::int FROM creator_play_attempts a WHERE a.creation_id=c.id) AS total_attempts,
    (SELECT count(*)::int FROM creator_play_attempts a WHERE a.creation_id=c.id AND a.status='completed') AS total_completions,
    (SELECT count(DISTINCT p.user_id)::int FROM creator_completions p WHERE p.creation_id=c.id) AS unique_account_completions,
    (SELECT count(DISTINCT p.user_id)::int FROM creator_completions p WHERE p.creation_id=c.id AND p.creation_version=COALESCE(${version ?? null}::int,c.version)) AS published_version_completions,
    (SELECT min(a.simulated_ticks)::int FROM creator_play_attempts a WHERE a.creation_id=c.id AND a.creation_version=COALESCE(${version ?? null}::int,c.version) AND a.status='completed' AND a.validated_at IS NOT NULL AND a.runtime_revision=${CREATOR_RUNTIME_REVISION}) AS fastest_verified_ticks,
    (SELECT round(avg(rating),2)::float FROM creation_difficulty_ratings r WHERE r.creation_id=c.id) AS difficulty,
    (SELECT count(*)::int FROM creation_difficulty_ratings r WHERE r.creation_id=c.id) AS difficulty_ratings
    FROM creations c WHERE c.id=${creationId}`;
  if (!statistics) fail(404, "Creation not found");
  return {
    ...statistics,
    completion_percentage: statistics.total_attempts
      ? Math.round(
          (statistics.total_completions / statistics.total_attempts) * 10000,
        ) / 100
      : 0,
    fastest_verified_seconds:
      statistics.fastest_verified_ticks === null
        ? null
        : statistics.fastest_verified_ticks / 60,
  };
}

export async function creationRankings(
  creationId: string,
  version: number,
  runtimeRevision: string,
) {
  const entries = await db`WITH personal AS (
    SELECT a.user_id,u.username,a.simulated_ticks AS ticks,(a.state->>'deaths')::int AS deaths,
      row_number() OVER(PARTITION BY a.user_id ORDER BY a.simulated_ticks,(a.state->>'deaths')::int,a.validated_at,a.id) AS choice
    FROM creator_play_attempts a JOIN users u ON u.id=a.user_id
    WHERE a.creation_id=${creationId} AND a.creation_version=${version} AND a.runtime_revision=${runtimeRevision}
      AND a.status='completed' AND a.validated_at IS NOT NULL AND u.disabled=false
  ) SELECT rank() OVER(ORDER BY ticks,deaths)::int AS rank,username,ticks,deaths
    FROM personal WHERE choice=1 ORDER BY ticks,deaths,username LIMIT 50`;
  return {
    version,
    runtimeRevision,
    entries: entries.map((row) => ({ ...row, seconds: row.ticks / 60 })),
  };
}

export async function handleCreatorProfile(
  path: string[],
  method: string,
  userId: string,
  input: Record<string, unknown>,
) {
  if (path[1] !== "creators") return;
  const creatorId = uuid.parse(path[2]);
  const [creator] =
    await db`SELECT id,username FROM users WHERE id=${creatorId} AND disabled=false`;
  if (!creator) fail(404, "Creator not found");
  if (path.length === 3 && method === "GET") {
    const [counts] = await db`SELECT
      (SELECT count(*)::int FROM creator_follows WHERE creator_id=${creatorId}) AS followers,
      EXISTS(SELECT 1 FROM creator_follows WHERE creator_id=${creatorId} AND follower_id=${userId}) AS followed,
      (SELECT count(*)::int FROM creations WHERE owner_id=${creatorId} AND published=true) AS published_levels`;
    return { ...creator, ...counts };
  }
  if (path[3] === "follow" && path.length === 4 && method === "POST") {
    const { followed } = z
      .object({ followed: z.boolean() })
      .strict()
      .parse(input);
    if (creatorId === userId) fail(400, "You cannot follow yourself");
    await db.begin(async (sql) => {
      const active =
        await sql`SELECT id FROM users WHERE id=ANY(${[creatorId, userId]}::uuid[]) AND disabled=false ORDER BY id FOR SHARE`;
      if (active.length !== 2) fail(404, "Creator not found");
      if (followed)
        await sql`INSERT INTO creator_follows(follower_id,creator_id) VALUES(${userId},${creatorId}) ON CONFLICT DO NOTHING`;
      else
        await sql`DELETE FROM creator_follows WHERE follower_id=${userId} AND creator_id=${creatorId}`;
    });
    return { followed };
  }
  fail(404, "Creator action not found");
}

export async function handleCreationCommunity(
  creationId: string,
  userId: string,
  suffix: string[],
  method: string,
  input: Record<string, unknown>,
) {
  if (suffix[0] === "collaborators") {
    return db.begin(async (sql) => {
      const creation = await lockCreationAccess(
        sql,
        creationId,
        userId,
        method === "POST" && suffix[1] !== "presence" ? "owner" : "read",
      );
      if (method === "GET" && suffix.length === 1) {
        if (creation.collaborator_permission === null)
          fail(403, "A collaborator grant is required");
        return sql`SELECT g.user_id,u.username,g.permission,
          CASE WHEN u.settings->>'presence'='invisible' OR u.settings->'privacy'->>'showActivity'='false' THEN false
            ELSE g.last_seen_at>now()-interval '45 seconds' END AS active
          FROM creation_collaborators g JOIN users u ON u.id=g.user_id
          WHERE g.creation_id=${creationId} AND u.disabled=false ORDER BY u.username LIMIT 25`;
      }
      if (
        method === "POST" &&
        suffix[1] === "presence" &&
        suffix.length === 2
      ) {
        z.object({}).strict().parse(input);
        if (!creation.collaborator_permission)
          fail(403, "A collaborator grant is required");
        await sql`UPDATE creation_collaborators SET last_seen_at=now() WHERE creation_id=${creationId} AND user_id=${userId}`;
        return {
          ok: true,
          tracked: creation.collaborator_permission !== "owner",
        };
      }
      if (method === "POST" && suffix.length === 1) {
        const data = z
          .object({
            username: z.string().trim().min(3).max(24),
            permission: z.enum(["viewer", "editor"]),
          })
          .strict()
          .parse(input);
        const [target] =
          await sql`SELECT id FROM users WHERE lower(username)=lower(${data.username}) AND disabled=false`;
        if (!target) fail(404, "Account not found");
        if (target.id === creation.owner_id)
          fail(400, "The creator already owns this project");
        const [count] =
          await sql`SELECT count(*)::int AS count FROM creation_collaborators WHERE creation_id=${creationId} AND user_id<>${target.id}`;
        if (count.count >= 25)
          fail(429, "A project supports at most 25 collaborators");
        await sql`INSERT INTO creation_collaborators(creation_id,user_id,permission,invited_by) VALUES(${creationId},${target.id},${data.permission},${userId})
          ON CONFLICT(creation_id,user_id) DO UPDATE SET permission=excluded.permission,last_seen_at=NULL`;
        return { userId: target.id, permission: data.permission };
      }
      if (method === "DELETE" && suffix.length === 2) {
        if (creation.owner_id !== userId)
          fail(403, "Only the creator can revoke a collaborator");
        const targetId = uuid.parse(suffix[1]);
        await sql`DELETE FROM creation_collaborators WHERE creation_id=${creationId} AND user_id=${targetId}`;
        return { removed: true };
      }
      fail(404, "Collaborator action not found");
    });
  }
  if (
    ["rating", "report"].includes(suffix[0]) &&
    method === "POST" &&
    suffix.length === 1
  ) {
    return db.begin(async (sql) => {
      // Account first, consistent with comments and draft edits.
      await sql`SELECT id FROM users WHERE id=${userId} AND disabled=false FOR UPDATE`;
      const creation = await lockCreationAccess(sql, creationId, userId);
      if (!creation.published) fail(404, "Published level not found");
      if (suffix[0] === "rating") {
        const { rating } = z
          .object({ rating: z.number().int().min(1).max(5) })
          .strict()
          .parse(input);
        if (creation.owner_id === userId)
          fail(400, "Creators cannot rate their own level");
        await sql`INSERT INTO creation_difficulty_ratings(creation_id,user_id,rating) VALUES(${creationId},${userId},${rating})
          ON CONFLICT(creation_id,user_id) DO UPDATE SET rating=excluded.rating,updated_at=now()`;
        return { rating };
      }
      const data = z
        .object({
          reason: z.enum(reportReasons),
          details: z.string().trim().max(1000).default(""),
        })
        .strict()
        .parse(input);
      const [existing] =
        await sql`SELECT id,status FROM creation_reports WHERE creation_id=${creationId} AND reporter_id=${userId}`;
      if (existing) return existing;
      const [count] =
        await sql`SELECT count(*)::int AS count FROM creation_reports WHERE reporter_id=${userId} AND created_at>now()-interval '1 hour'`;
      if (count.count >= 20) fail(429, "Too many reports in one hour");
      const [report] =
        await sql`INSERT INTO creation_reports(creation_id,reporter_id,reason,details) VALUES(${creationId},${userId},${data.reason},${data.details})
        ON CONFLICT(creation_id,reporter_id) DO NOTHING RETURNING id,status`;
      if (report) return report;
      return (
        await sql`SELECT id,status FROM creation_reports WHERE creation_id=${creationId} AND reporter_id=${userId}`
      )[0];
    });
  }
}

/** Review changes moderation state; it never deletes content or exposes private drafts. */
export async function handleCreatorReports(
  userId: string,
  method: string,
  reportId: string | undefined,
  input: Record<string, unknown>,
) {
  const [authorized] =
    await db`SELECT id FROM users WHERE id=${userId} AND disabled=false AND role IN ('admin','owner')`;
  if (!authorized) fail(403, "Administrator access required");
  if (method === "GET" && !reportId)
    return db`SELECT r.id,r.creation_id,r.reason,r.details,r.status,r.created_at,r.reviewed_at,r.review_note,
    CASE WHEN c.published THEN c.title ELSE NULL END AS title,u.username AS reporter
    FROM creation_reports r JOIN creations c ON c.id=r.creation_id LEFT JOIN users u ON u.id=r.reporter_id
    ORDER BY (r.status='open') DESC,r.created_at DESC LIMIT 100`;
  if (method === "POST" && reportId) {
    const id = uuid.parse(reportId);
    const data = z
      .object({
        status: z.enum(["reviewed", "dismissed"]),
        note: z.string().trim().min(1).max(500),
      })
      .strict()
      .parse(input);
    return db.begin(async (sql) => {
      const [actor] =
        await sql`SELECT id,username,role FROM users WHERE id=${userId} AND disabled=false FOR SHARE`;
      if (!actor || !["admin", "owner"].includes(actor.role))
        fail(403, "Administrator access required");
      const [report] =
        await sql`SELECT id,creation_id,status,review_note FROM creation_reports WHERE id=${id} FOR UPDATE`;
      if (!report) fail(404, "Report not found");
      if (report.status !== "open") {
        if (report.status === data.status && report.review_note === data.note)
          return { id, status: report.status, replayed: true };
        fail(409, "This report was already reviewed");
      }
      await sql`UPDATE creation_reports SET status=${data.status},review_note=${data.note},reviewed_by=${userId},reviewed_at=now() WHERE id=${id}`;
      await sql`INSERT INTO admin_audit_log(actor_id,actor_username,action,details) VALUES(${userId},${actor.username},'creator.report.review',${sql.json({ reportId: id, creationId: report.creation_id, status: data.status, note: data.note })})`;
      return { id, status: data.status };
    });
  }
  fail(404, "Report action not found");
}
