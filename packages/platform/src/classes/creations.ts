import { db } from "@tell-aviv/database";
import { ApiError, type ApiHandler } from "@tell-aviv/shared";
import { z } from "zod";
import { CREATOR_RUNTIME_REVISION } from "../../../creator-runtime/src/index";
import { idSchema, levelSchema, titleSchema } from "./models";
import { categorySchema, discoverCreations } from "../creations/discovery";
import { handleCreatorAttempt } from "../creations/progress";
import {
  creationStatistics,
  creationRankings,
  handleCreatorProfile,
  handleCreationCommunity,
  lockCreationAccess,
} from "../creations/community";
const creationInput = z.object({
  title: titleSchema,
  description: z.string().max(3000).default(""),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
  level: levelSchema,
  category: categorySchema.optional(),
});
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError(400, result.error.issues[0]?.message ?? "Invalid input");
  return result.data;
}
export const handleCreations: ApiHandler = async (
  path,
  method,
  context,
  input,
) => {
  const userId = context.user.id;
  if (path[1] === "creators")
    return handleCreatorProfile(path, method, userId, input);
  if (path.length === 1 && method === "GET") {
    return discoverCreations(userId, context.request.url);
  }
  if (path.length === 1 && method === "POST") {
    const data = parse(creationInput.strict(), input);
    return db.begin(async (sql) => {
      await sql`select id from users where id=${userId} for update`;
      const [count] =
        await sql`select count(*)::int as count from creations where owner_id=${userId}`;
      if (count.count >= 200)
        throw new ApiError(
          429,
          "This account has reached its limit of 200 creations",
        );
      const [row] =
        await sql`insert into creations(owner_id,title,description,tags,level,category) values(${userId},${data.title},${data.description},${sql.json(data.tags)},${sql.json(data.level)},${data.category ?? "platformer"}) returning *`;
      await sql`insert into creation_versions(creation_id,version,level) values(${row.id},1,${sql.json(data.level)})`;
      return row;
    });
  }
  const creationId = parse(idSchema, path[1]);
  const [creation] =
    await db`select c.*,u.username as creator,(select count(*)::int from creation_likes l where l.creation_id=c.id) as likes,(select count(DISTINCT p.user_id)::int from creator_completions p where p.creation_id=c.id) as completions,
      (c.owner_id=${userId} OR EXISTS(SELECT 1 FROM creation_collaborators g WHERE g.creation_id=c.id AND g.user_id=${userId} AND g.permission='editor')) AS can_edit,
      (SELECT g.permission FROM creation_collaborators g WHERE g.creation_id=c.id AND g.user_id=${userId}) AS collaborator_permission,
      exists(select 1 from creation_likes l where l.creation_id=c.id and l.user_id=${userId}) as liked,
      exists(select 1 from creation_favorites f where f.creation_id=c.id and f.user_id=${userId}) as favorited
      from creations c join users u on u.id=c.owner_id where c.id=${creationId} and (c.owner_id=${userId} or (u.disabled=false AND (c.published=true OR EXISTS(SELECT 1 FROM creation_collaborators g WHERE g.creation_id=c.id AND g.user_id=${userId}))))`;
  if (!creation) throw new ApiError(404, "Creation not found");
  if (path.length === 2 && method === "GET") {
    const comments =
      await db`select c.id,c.body,c.created_at,u.username from creation_comments c join users u on u.id=c.user_id where creation_id=${creationId} order by c.created_at desc limit 50`;
    return {
      ...creation,
      comments,
      statistics: await creationStatistics(creationId, creation.version),
    };
  }
  const communityAction = await handleCreationCommunity(
    creationId,
    userId,
    path.slice(2),
    method,
    input,
  );
  if (communityAction !== undefined) return communityAction;
  if (path.length === 2 && method === "PATCH") {
    const data = parse(
      creationInput
        .extend({ expectedVersion: z.number().int().positive() })
        .strict(),
      input,
    );
    return db.begin(async (sql) => {
      const locked = await lockCreationAccess(sql, creationId, userId, "edit");
      if (locked.version !== data.expectedVersion)
        throw new ApiError(409, "This level changed. Reload before saving.");
      const [row] =
        await sql`update creations set title=${data.title},description=${data.description},tags=${sql.json(data.tags)},category=${data.category ?? creation.category},level=${sql.json(data.level)},version=version+1,updated_at=now() where id=${creationId} returning *`;
      await sql`insert into creation_versions(creation_id,version,level) values(${creationId},${row.version},${sql.json(data.level)})`;
      return {
        ...row,
        can_edit: true,
        collaborator_permission: locked.collaborator_permission,
      };
    });
  }
  if (path[2] === "publish" && method === "POST") {
    if (creation.owner_id !== userId)
      throw new ApiError(403, "Only the creator can publish");
    const { published } = parse(
      z.object({ published: z.boolean() }).strict(),
      input,
    );
    return db.begin(async (sql) => {
      const locked = await lockCreationAccess(sql, creationId, userId, "owner");
      const level = parse(levelSchema, locked.level);
      if (
        published &&
        !level.objects.some((object) => object.type === "finish") &&
        !(level.logic ?? []).some((block) =>
          block.actions.some((action) => action.type === "complete"),
        )
      )
        throw new ApiError(
          400,
          "Add a finish zone or complete action before publishing",
        );
      const [row] =
        await sql`UPDATE creations SET published=${published},updated_at=now() WHERE id=${creationId} RETURNING *`;
      return row;
    });
  }
  if (path[2] === "versions" && method === "GET") {
    if (!creation.can_edit)
      throw new ApiError(403, "An editor grant is required");
    return db`select version,created_at from creation_versions where creation_id=${creationId} order by version desc limit 100`;
  }
  if (path[2] === "restore-version" && method === "POST") {
    if (creation.owner_id !== userId)
      throw new ApiError(403, "Only the creator can restore versions");
    const { version } = parse(
      z.object({ version: z.number().int().positive() }).strict(),
      input,
    );
    const [previous] =
      await db`select level from creation_versions where creation_id=${creationId} and version=${version}`;
    if (!previous) throw new ApiError(404, "Version not found");
    return db.begin(async (sql) => {
      await lockCreationAccess(sql, creationId, userId, "owner");
      const [row] =
        await sql`update creations set level=${sql.json(previous.level)},version=version+1,updated_at=now() where id=${creationId} returning *`;
      await sql`insert into creation_versions(creation_id,version,level) values(${creationId},${row.version},${sql.json(row.level)})`;
      return row;
    });
  }
  if (!creation.published)
    throw new ApiError(400, "Publish this creation before community actions");
  if (path[2] === "rankings" && path.length === 3 && method === "GET")
    return creationRankings(
      creationId,
      creation.version,
      CREATOR_RUNTIME_REVISION,
    );
  if (path[2] === "attempts" && path.length <= 5) {
    return handleCreatorAttempt(
      creationId,
      userId,
      method,
      path[3],
      path[4],
      input,
    );
  }
  if (path[2] === "like" && method === "POST") {
    const { liked } = parse(z.object({ liked: z.boolean() }).strict(), input);
    if (liked)
      await db`insert into creation_likes(creation_id,user_id) values(${creationId},${userId}) on conflict do nothing`;
    else
      await db`delete from creation_likes where creation_id=${creationId} and user_id=${userId}`;
    const [count] =
      await db`select count(*)::int as likes from creation_likes where creation_id=${creationId}`;
    return { liked, likes: count.likes };
  }
  if (path[2] === "favorite" && method === "POST") {
    const { favorited } = parse(
      z.object({ favorited: z.boolean() }).strict(),
      input,
    );
    if (favorited)
      await db`insert into creation_favorites(creation_id,user_id) values(${creationId},${userId}) on conflict do nothing`;
    else
      await db`delete from creation_favorites where creation_id=${creationId} and user_id=${userId}`;
    return { favorited };
  }
  if (path[2] === "comments" && method === "POST") {
    const { body } = parse(
      z.object({ body: z.string().trim().min(1).max(1000) }).strict(),
      input,
    );
    return db.begin(async (sql) => {
      await sql`select id from users where id=${userId} for update`;
      const [available] =
        await sql`select id from creations where id=${creationId} and published=true for share`;
      if (!available) throw new ApiError(404, "Published level not found");
      const [rate] =
        await sql`select count(*)::int as count from creation_comments where user_id=${userId} and created_at>now()-interval '1 minute'`;
      if (rate.count >= 10)
        throw new ApiError(429, "Wait a minute before posting more comments");
      const [row] =
        await sql`insert into creation_comments(creation_id,user_id,body) values(${creationId},${userId},${body}) returning id,body,created_at`;
      return { ...row, username: context.user.username };
    });
  }
  if (path[2] === "play" && method === "POST") {
    return db.begin(async (sql) => {
      const added =
        await sql`insert into creator_play_visits(creation_id,user_id) values(${creationId},${userId}) on conflict do nothing returning creation_id`;
      if (added.length)
        await sql`update creations set plays=plays+1 where id=${creationId}`;
      return { registered: added.length > 0, ranked: false };
    });
  }
  return undefined;
};
