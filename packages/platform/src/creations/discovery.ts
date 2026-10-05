import { db } from "@tell-aviv/database";
import { ApiError } from "@tell-aviv/shared";
import { z } from "zod";

export const categories = [
  "platformer",
  "puzzle",
  "action",
  "exploration",
  "challenge",
  "other",
] as const;
export const categorySchema = z.enum(categories);
const filters = z
  .object({
    q: z.string().trim().max(80).default(""),
    category: categorySchema.optional(),
    creator: z.string().uuid().optional(),
    favorites: z.enum(["true", "false"]).default("false"),
    followed: z.enum(["true", "false"]).default("false"),
    sort: z
      .enum(["recent", "popular", "liked", "completed", "trending"])
      .default("recent"),
    offset: z.coerce.number().int().min(0).max(5000).default(0),
  })
  .strict();

/** Public metadata only; private level snapshots never enter discovery responses. */
export async function discoverCreations(userId: string, url: string) {
  const params = Object.fromEntries(new URL(url).searchParams);
  const parsed = filters.safeParse(params);
  if (!parsed.success)
    throw new ApiError(
      400,
      parsed.error.issues[0]?.message ?? "Invalid discovery filters",
    );
  const filter = parsed.data;
  const where = db`c.published=true AND u.disabled=false
    AND (${!filter.category} OR c.category=${filter.category ?? "platformer"})
    AND (${!filter.creator} OR c.owner_id=${filter.creator ?? userId})
    AND (${filter.favorites !== "true"} OR EXISTS(SELECT 1 FROM creation_favorites f WHERE f.creation_id=c.id AND f.user_id=${userId}))
    AND (${filter.followed !== "true"} OR EXISTS(SELECT 1 FROM creator_follows f WHERE f.creator_id=c.owner_id AND f.follower_id=${userId}))
    AND (${!filter.q} OR position(lower(${filter.q}) in lower(c.title||' '||c.description||' '||c.tags::text||' '||u.username))>0)`;
  const [mine, community, counts, collaborations] = await Promise.all([
    db`SELECT c.*,(SELECT count(*)::int FROM creation_likes l WHERE l.creation_id=c.id) AS likes,
      (SELECT count(DISTINCT p.user_id)::int FROM creator_completions p WHERE p.creation_id=c.id) AS completions
      FROM creations c WHERE owner_id=${userId} ORDER BY updated_at DESC LIMIT 200`,
    db`SELECT c.id,c.owner_id,c.title,c.description,c.category,c.tags,c.plays,c.version,c.created_at,c.updated_at,u.username AS creator,
      (SELECT count(*)::int FROM creation_likes l WHERE l.creation_id=c.id) AS likes,
      (SELECT count(DISTINCT p.user_id)::int FROM creator_completions p WHERE p.creation_id=c.id) AS completions,
      (SELECT round(avg(rating),2)::float FROM creation_difficulty_ratings r WHERE r.creation_id=c.id) AS difficulty,
      EXISTS(SELECT 1 FROM creator_follows f WHERE f.creator_id=c.owner_id AND f.follower_id=${userId}) AS followed,
      EXISTS(SELECT 1 FROM creation_likes l WHERE l.creation_id=c.id AND l.user_id=${userId}) AS liked,
      EXISTS(SELECT 1 FROM creation_favorites f WHERE f.creation_id=c.id AND f.user_id=${userId}) AS favorited,
      EXISTS(SELECT 1 FROM creator_completions p WHERE p.creation_id=c.id AND p.user_id=${userId} AND p.creation_version=c.version) AS completed
      FROM creations c JOIN users u ON u.id=c.owner_id WHERE ${where}
      ORDER BY CASE WHEN ${filter.sort}='trending' THEN (SELECT count(DISTINCT a.user_id) FROM creator_play_attempts a WHERE a.creation_id=c.id AND a.started_at>now()-interval '7 days') END DESC,
        CASE WHEN ${filter.sort}='popular' THEN c.plays END DESC,
        CASE WHEN ${filter.sort}='liked' THEN (SELECT count(*) FROM creation_likes l WHERE l.creation_id=c.id) END DESC,
        CASE WHEN ${filter.sort}='completed' THEN (SELECT count(DISTINCT p.user_id) FROM creator_completions p WHERE p.creation_id=c.id) END DESC,
        c.updated_at DESC,c.id LIMIT 24 OFFSET ${filter.offset}`,
    db`SELECT count(*)::int AS total FROM creations c JOIN users u ON u.id=c.owner_id WHERE ${where}`,
    db`SELECT c.*,u.username AS creator,g.permission AS collaborator_permission,(g.permission='editor') AS can_edit
      FROM creation_collaborators g JOIN creations c ON c.id=g.creation_id JOIN users u ON u.id=c.owner_id
      WHERE g.user_id=${userId} AND u.disabled=false ORDER BY c.updated_at DESC LIMIT 200`,
  ]);
  return {
    mine,
    collaborations,
    community,
    total: counts[0].total as number,
    offset: filter.offset,
    pageSize: 24,
  };
}
