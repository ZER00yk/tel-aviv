import { db } from "@tell-aviv/database";
import { ApiError, type ApiHandler, type User } from "@tell-aviv/shared";
import { z } from "zod";
import {
  readFile,
  storeFile,
  validateFile,
  MAX_FILE_BYTES,
} from "../../storage/src/index";
import { storageUsage } from "./storageQuota";
import { removeUncommittedFile, assertUploadBindable } from "./storageCleanup";
import { handleFlashcardStudy } from "./classes/study";
import { generateSchoolReminders } from "./classes/reminders";
import { schoolResourceSchema } from "./classes/flashcards";
import {
  deleteSchoolClass,
  permanentlyDeleteSchoolResource,
} from "./classes/lifecycle";
import { handleCreations } from "./classes/creations";
import {
  idSchema,
  resourceKind,
  scoreQuiz,
  titleSchema,
  type ResourceKind,
  type Quiz,
} from "./classes/models";

type Resource = {
  id: string;
  class_id: string;
  owner_id: string;
  parent_id: string | null;
  kind: ResourceKind;
  title: string;
  data: Record<string, unknown>;
  version: number;
  deleted_at: string | null;
  [key: string]: unknown;
};
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError(400, result.error.issues[0]?.message ?? "Invalid input");
  return result.data;
}
function id(value: unknown) {
  return parse(idSchema, value);
}
async function ownClass(classId: string, userId: string) {
  const [row] =
    await db`select * from school_classes where id=${classId} and owner_id=${userId}`;
  if (!row) throw new ApiError(404, "Class not found");
  return row;
}
// Authorization follows folder ancestry. A grant explicitly shares that folder's subtree.
export async function authorizeResource(
  resourceId: string,
  userId: string,
  edit = false,
  trash = false,
): Promise<Resource> {
  const [row] = await db`with recursive ancestry as (
    select r.*, 0 as depth from school_resources r where r.id=${resourceId}
    union all select p.*, a.depth+1 from school_resources p join ancestry a on a.parent_id=p.id 
  ) select r.*, exists(select 1 from ancestry a join school_shares s on s.resource_id=a.id where s.user_id=${userId} and (${!edit} or s.permission='edit')) as shared,
    exists(select 1 from ancestry a join school_shares s on s.resource_id=a.id where s.user_id=${userId} and s.permission='edit') as can_edit,
    exists(select 1 from ancestry a where a.deleted_at is not null) as hidden
  from school_resources r where r.id=${resourceId}`;
  if (
    !row ||
    (row.owner_id !== userId && !row.shared) ||
    (!trash && row.hidden)
  )
    throw new ApiError(404, "Resource not found");
  if (trash && row.owner_id !== userId)
    throw new ApiError(404, "Resource not found");
  return row as Resource;
}
function publicResource(resource: Resource, userId: string) {
  const view = {
    ...resource,
    owned: resource.owner_id === userId,
    editable: resource.owner_id === userId || Boolean(resource.can_edit),
  };
  if (
    resource.kind === "quiz" &&
    resource.owner_id !== userId &&
    !resource.can_edit
  ) {
    const quiz = resource.data as unknown as Quiz;
    return {
      ...view,
      data: {
        ...quiz,
        questions: quiz.questions.map(
          ({ answer: _answer, ...question }) => question,
        ),
      },
    };
  }
  if (resource.kind === "file") {
    const { key: _key, ...metadata } = resource.data;
    return { ...view, data: metadata };
  }
  return view;
}
async function validateParent(
  parentId: string | null,
  classId: string,
  userId: string,
  resourceId?: string,
) {
  if (!parentId) return;
  const parent = await authorizeResource(parentId, userId, true);
  if (parent.kind !== "folder" || parent.class_id !== classId)
    throw new ApiError(400, "Choose a folder in this class");
  if (resourceId) {
    const [cycle] =
      await db`with recursive parents as (select id,parent_id from school_resources where id=${parentId} union all select r.id,r.parent_id from school_resources r join parents p on p.parent_id=r.id) select id from parents where id=${resourceId}`;
    if (cycle) throw new ApiError(400, "A folder cannot contain itself");
  }
}
async function validateAttachments(
  data: Record<string, unknown>,
  classId: string,
  userId: string,
) {
  for (const attachmentId of (data.attachments as string[] | undefined) ?? []) {
    const file = await authorizeResource(attachmentId, userId);
    if (file.kind !== "file" || file.class_id !== classId)
      throw new ApiError(400, "Attachment must be a file in this class");
  }
  const imageIds = (
    (data.cards as { imageResourceId?: string | null }[] | undefined) ?? []
  )
    .map((card) => card.imageResourceId)
    .filter((value): value is string => Boolean(value));
  for (const imageId of new Set(imageIds)) {
    const image = await authorizeResource(imageId, userId);
    if (
      image.kind !== "file" ||
      image.class_id !== classId ||
      !String(image.data.mime).startsWith("image/")
    )
      throw new ApiError(
        400,
        "Flashcard image must be an accessible image in this class",
      );
  }
}
async function accessibleResources(userId: string, query = "") {
  return db`with recursive visible as (
    select r.id from school_resources r where r.owner_id=${userId} or exists(select 1 from school_shares s where s.resource_id=r.id and s.user_id=${userId})
    union select r.id from school_resources r join visible v on r.parent_id=v.id
  ), hidden as (select id from school_resources where deleted_at is not null union select r.id from school_resources r join hidden h on r.parent_id=h.id)
  select r.* from school_resources r join visible v on v.id=r.id where not exists(select 1 from hidden h where h.id=r.id)
  and (r.title ilike ${`%${query}%`} or r.data->>'markdown' ilike ${`%${query}%`}) order by r.updated_at desc limit 500`;
}
export const handleClasses: ApiHandler = async (
  path,
  method,
  context,
  input,
) => {
  if (path[0] === "creations")
    return handleCreations(path, method, context, input);
  if (path[0] !== "classes") return undefined;
  const userId = context.user.id;
  if (path.length === 2 && path[1] === "reminders" && method === "POST")
    return generateSchoolReminders(userId);
  if (path.length === 2 && path[1] === "assignments" && method === "GET") {
    const assignments = (await accessibleResources(userId)).filter(
      (row) => row.owner_id === userId && row.kind === "assignment",
    );
    const classes =
      await db`select id,name from school_classes where owner_id=${userId}`;
    const folders =
      await db`select id,title from school_resources where owner_id=${userId} and kind='folder' and deleted_at is null`;
    return {
      assignments: assignments.map((row) =>
        publicResource(row as Resource, userId),
      ),
      classes,
      folders,
    };
  }
  if (path.length === 1 && method === "GET") {
    const classes =
      await db`select * from school_classes where owner_id=${userId} order by created_at`;
    const upcoming =
      await db`with recursive hidden as (select id from school_resources where deleted_at is not null union select r.id from school_resources r join hidden h on r.parent_id=h.id) select r.* from school_resources r where r.owner_id=${userId} and r.kind='assignment' and not exists(select 1 from hidden h where h.id=r.id) and r.data->>'status'<>'done' and r.data->>'dueDate' is not null order by r.data->>'dueDate' limit 12`;
    const usage = await storageUsage(db, userId);
    return {
      classes,
      upcoming,
      shared: (await accessibleResources(userId))
        .filter((row) => row.owner_id !== userId)
        .map((row) => publicResource(row as Resource, userId)),
      ...usage,
    };
  }
  if (path.length === 1 && method === "POST") {
    const data = parse(
      z
        .object({
          name: titleSchema,
          color: z
            .string()
            .regex(/^#[0-9a-f]{6}$/i)
            .default("#6c70ff"),
        })
        .strict(),
      input,
    );
    const [row] =
      await db`insert into school_classes(owner_id,name,color) values(${userId},${data.name},${data.color}) returning *`;
    return row;
  }
  if (path[1] === "search" && method === "GET") {
    const query =
      new URL(context.request.url).searchParams
        .get("q")
        ?.trim()
        .slice(0, 100) ?? "";
    return (await accessibleResources(userId, query)).map((row) =>
      publicResource(row as Resource, userId),
    );
  }
  if (path[1] === "resources" && path[2]) {
    const resourceId = id(path[2]);
    const resource = await authorizeResource(
      resourceId,
      userId,
      ["PATCH"].includes(method),
      path[3] === "restore" || path[3] === "permanent",
    );
    if (path[3] === "study")
      return handleFlashcardStudy(
        resource,
        userId,
        method,
        path[4],
        input,
        authorizeResource,
        new URL(context.request.url).searchParams,
      );
    if (!path[3] && method === "GET") {
      const shares =
        resource.owner_id === userId
          ? await db`select s.user_id,s.permission,u.username from school_shares s join users u on u.id=s.user_id where resource_id=${resourceId}`
          : [];
      return {
        ...publicResource(resource, userId),
        shares,
        owned: resource.owner_id === userId,
        editable: resource.owner_id === userId || Boolean(resource.can_edit),
      };
    }
    if (!path[3] && method === "PATCH") {
      const data = parse(
        z
          .object({
            title: titleSchema.optional(),
            data: z.record(z.string(), z.unknown()).optional(),
            expectedVersion: z.number().int().positive(),
            parentId: idSchema.nullable().optional(),
          })
          .strict(),
        input,
      );
      if (resource.kind === "file" && data.data)
        throw new ApiError(400, "File metadata is read-only");
      const nextData = data.data
        ? parse(schoolResourceSchema(resource.kind), data.data)
        : resource.data;
      await validateAttachments(
        nextData as Record<string, unknown>,
        resource.class_id,
        userId,
      );
      if (data.parentId !== undefined) {
        if (resource.owner_id !== userId)
          throw new ApiError(403, "Only the owner can move resources");
        await validateParent(
          data.parentId,
          resource.class_id,
          userId,
          resourceId,
        );
      }
      return db.begin(async (sql) => {
        const [lockedClass] =
          await sql`select id from school_classes where id=${resource.class_id} for update`;
        if (!lockedClass) throw new ApiError(404, "Resource not found");
        const current = await authorizeResource(resourceId, userId, true);
        await validateAttachments(
          nextData as Record<string, unknown>,
          current.class_id,
          userId,
        );
        if (data.parentId !== undefined) {
          await validateParent(
            data.parentId,
            resource.class_id,
            userId,
            resourceId,
          );
        }
        const [locked] =
          await sql`select version from school_resources where id=${resourceId} for update`;
        if (locked.version !== data.expectedVersion)
          throw new ApiError(
            409,
            "This resource changed. Reload before saving.",
          );
        const [row] =
          await sql`update school_resources set title=${data.title ?? resource.title},data=${sql.json(nextData as never)},parent_id=${data.parentId === undefined ? resource.parent_id : data.parentId},version=version+1,updated_at=now() where id=${resourceId} returning *`;
        if (resource.kind === "note")
          await sql`insert into school_revisions(resource_id,editor_id,version,title,data) values(${resourceId},${userId},${row.version},${row.title},${sql.json(nextData as never)})`;
        if (
          resource.kind === "assignment" &&
          (current.data.status !==
            (nextData as Record<string, unknown>).status ||
            current.data.dueDate !==
              (nextData as Record<string, unknown>).dueDate)
        )
          await sql`insert into school_assignment_history(resource_id,editor_id,version,previous_status,status,due_at) values(${resourceId},${userId},${row.version},${String(current.data.status ?? "not-started")},${String((nextData as Record<string, unknown>).status ?? "not-started")},${(nextData as Record<string, unknown>).dueDate as string | null})`;
        return publicResource(
          { ...(row as Resource), can_edit: resource.can_edit },
          userId,
        );
      });
    }
    if (!path[3] && method === "DELETE") {
      if (resource.owner_id !== userId)
        throw new ApiError(403, "Only the owner can move resources to trash");
      return db.begin(async (sql) => {
        await sql`select id from school_classes where id=${resource.class_id} for update`;
        const [row] =
          await sql`update school_resources set deleted_at=now() where id=${resourceId} and owner_id=${userId} returning id`;
        if (!row) throw new ApiError(404, "Resource not found");
        return { trashed: true };
      });
    }
    if (path[3] === "restore" && method === "POST") {
      if (resource.owner_id !== userId)
        throw new ApiError(403, "Only the owner can restore resources");
      return db.begin(async (sql) => {
        await sql`select id from school_classes where id=${resource.class_id} for update`;
        const [row] =
          await sql`update school_resources set deleted_at=null where id=${resourceId} and owner_id=${userId} returning id`;
        if (!row) throw new ApiError(404, "Resource not found");
        return { restored: true };
      });
    }
    if (path[3] === "permanent" && method === "DELETE") {
      if (resource.owner_id !== userId)
        throw new ApiError(
          403,
          "Only the owner can permanently delete resources",
        );
      if (!resource.deleted_at)
        throw new ApiError(400, "Move this resource to trash first");
      return permanentlyDeleteSchoolResource(resourceId, userId);
    }
    if (path[3] === "revisions" && method === "GET")
      return db`select id,version,title,created_at from school_revisions where resource_id=${resourceId} order by version desc limit 100`;
    if (path[3] === "restore-revision" && method === "POST") {
      await authorizeResource(resourceId, userId, true);
      const revisionId = id(input.revisionId);
      const [revision] =
        await db`select * from school_revisions where id=${revisionId} and resource_id=${resourceId}`;
      if (!revision || resource.kind !== "note")
        throw new ApiError(404, "Revision not found");
      return db.begin(async (sql) => {
        const [lockedClass] =
          await sql`select id from school_classes where id=${resource.class_id} for update`;
        if (!lockedClass) throw new ApiError(404, "Resource not found");
        await authorizeResource(resourceId, userId, true);
        await sql`select id from school_resources where id=${resourceId} for update`;
        const [row] =
          await sql`update school_resources set data=${sql.json(revision.data)},title=${revision.title},version=version+1,updated_at=now() where id=${resourceId} returning *`;
        await sql`insert into school_revisions(resource_id,editor_id,version,title,data) values(${resourceId},${userId},${row.version},${row.title},${sql.json(row.data)})`;
        return publicResource(
          { ...(row as Resource), can_edit: resource.can_edit },
          userId,
        );
      });
    }
    if (path[3] === "share") {
      if (resource.owner_id !== userId)
        throw new ApiError(403, "Only the owner can change sharing");
      if (method === "POST") {
        const grant = parse(
          z
            .object({
              username: z.string().min(3).max(24),
              permission: z.enum(["view", "edit"]),
            })
            .strict(),
          input,
        );
        const [target] =
          await db`select id from users where lower(username)=lower(${grant.username})`;
        if (!target || target.id === userId)
          throw new ApiError(400, "Choose another existing user");
        return db.begin(async (sql) => {
          await sql`select id from school_classes where id=${resource.class_id} for update`;
          await sql`insert into school_shares(resource_id,user_id,permission) values(${resourceId},${target.id},${grant.permission}) on conflict(resource_id,user_id) do update set permission=excluded.permission`;
          return { shared: true };
        });
      }
      if (method === "DELETE" && path[4]) {
        const recipientId = id(path[4]);
        return db.begin(async (sql) => {
          await sql`select id from school_classes where id=${resource.class_id} for update`;
          await sql`delete from school_shares where resource_id=${resourceId} and user_id=${recipientId}`;
          return { revoked: true };
        });
      }
    }
    if (path[3] === "attempt" && method === "POST") {
      if (resource.kind !== "quiz")
        throw new ApiError(400, "This resource is not a quiz");
      const { answers } = parse(
        z
          .object({
            answers: z
              .array(
                z.union([
                  z.string().max(500),
                  z.array(z.string().max(500)).max(8),
                ]),
              )
              .max(100),
          })
          .strict(),
        input,
      );
      return db.begin(async (sql) => {
        await sql`select id from school_classes where id=${resource.class_id} for update`;
        const current = await authorizeResource(resourceId, userId);
        const result = scoreQuiz(current.data as unknown as Quiz, answers);
        const [attempt] =
          await sql`insert into school_quiz_attempts(resource_id,user_id,score,total,resource_version,breakdown) values(${resourceId},${userId},${result.score},${result.total},${current.version},${sql.json(result.results)}) returning id,created_at`;
        return { ...result, ...attempt };
      });
    }
    if (path[3] === "attempts" && method === "GET")
      return db`select id,score,total,resource_version,breakdown,created_at from school_quiz_attempts where resource_id=${resourceId} and user_id=${userId} order by created_at desc limit 30`;
    if (
      path[3] === "history" &&
      method === "GET" &&
      resource.kind === "assignment"
    )
      return db`select id,version,previous_status,status,due_at,created_at from school_assignment_history where resource_id=${resourceId} order by created_at desc limit 100`;
    if (
      path[3] === "analytics" &&
      method === "GET" &&
      resource.kind === "quiz"
    ) {
      if (resource.owner_id !== userId)
        throw new ApiError(
          403,
          "Only the quiz owner can view aggregate analytics",
        );
      const [summary] =
        await db`select count(*)::int as attempts,round(avg(case when total>0 then score::numeric/total*100 end),1) as average_percent,count(distinct user_id)::int as learners from school_quiz_attempts where resource_id=${resourceId}`;
      const questions =
        await db`select (item->>'index')::int as index,count(*)::int as attempts,count(*) filter(where item->>'correct'='true')::int as correct from school_quiz_attempts a cross join lateral jsonb_array_elements(a.breakdown) item where a.resource_id=${resourceId} and a.resource_version=${resource.version} group by item->>'index' order by (item->>'index')::int`;
      return { ...summary, resourceVersion: resource.version, questions };
    }
    return undefined;
  }
  if (path[1] && idSchema.safeParse(path[1]).success) {
    const classId = id(path[1]);
    const cls = await ownClass(classId, userId);
    if (path.length === 2 && method === "PATCH") {
      const update = parse(
        z
          .object({
            name: titleSchema,
            color: z
              .string()
              .regex(/^#[0-9a-f]{6}$/i)
              .optional(),
          })
          .strict(),
        input,
      );
      const [row] =
        await db`update school_classes set name=${update.name},color=${update.color ?? cls.color} where id=${classId} and owner_id=${userId} returning *`;
      if (!row) throw new ApiError(404, "Class not found");
      return row;
    }
    if (path.length === 2 && method === "DELETE") {
      const { confirmation } = parse(
        z.object({ confirmation: z.string().max(167) }).strict(),
        input,
      );
      return deleteSchoolClass(classId, userId, confirmation);
    }
    if (path.length === 2 && method === "GET") {
      const resources = (await accessibleResources(userId))
        .filter((row) => row.class_id === classId)
        .map((row) => publicResource(row as Resource, userId));
      const trash =
        await db`select * from school_resources where class_id=${classId} and owner_id=${userId} and deleted_at is not null order by deleted_at desc`;
      return {
        class: cls,
        resources,
        trash: trash.map((row) => publicResource(row as Resource, userId)),
      };
    }
    if (path[2] === "resources" && method === "POST") {
      const data = parse(
        z
          .object({
            kind: resourceKind.exclude(["file"]),
            title: titleSchema,
            parentId: idSchema.nullable().default(null),
            data: z.record(z.string(), z.unknown()).default({}),
          })
          .strict(),
        input,
      );
      const content = parse(schoolResourceSchema(data.kind), data.data);
      await validateParent(data.parentId, classId, userId);
      await validateAttachments(
        content as Record<string, unknown>,
        classId,
        userId,
      );
      return db.begin(async (sql) => {
        const [lockedClass] =
          await sql`select id from school_classes where id=${classId} and owner_id=${userId} for update`;
        if (!lockedClass) throw new ApiError(404, "Class not found");
        await validateParent(data.parentId, classId, userId);
        const [row] =
          await sql`insert into school_resources(class_id,owner_id,parent_id,kind,title,data) values(${classId},${userId},${data.parentId},${data.kind},${data.title},${sql.json(content as never)}) returning *`;
        if (data.kind === "note")
          await sql`insert into school_revisions(resource_id,editor_id,version,title,data) values(${row.id},${userId},1,${row.title},${sql.json(content as never)})`;
        if (data.kind === "assignment")
          await sql`insert into school_assignment_history(resource_id,editor_id,version,status,due_at) values(${row.id},${userId},1,${String((content as Record<string, unknown>).status ?? "not-started")},${(content as Record<string, unknown>).dueDate as string | null})`;
        return publicResource(row as Resource, userId);
      });
    }
  }
  return undefined;
};

export async function handleClassFile(
  request: Request,
  user: User,
  fileId: string,
): Promise<Response> {
  if (request.method === "GET" && fileId !== "upload") {
    const resource = await authorizeResource(id(fileId), user.id);
    if (resource.kind !== "file") throw new ApiError(404, "File not found");
    const bytes = await readFile(String(resource.data.key));
    const name = String(resource.data.name).replace(/[\r\n"\\]/g, "_");
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": String(resource.data.mime),
        "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (request.method !== "POST" || fileId !== "upload")
    throw new ApiError(405, "Method not allowed");
  const origin = request.headers.get("origin");
  const allowed = new Set([
    new URL(request.url).origin,
    ...(process.env.APP_URL ? [new URL(process.env.APP_URL).origin] : []),
  ]);
  if (!origin || !allowed.has(origin))
    throw new ApiError(403, "Invalid request origin");
  const length = Number(request.headers.get("content-length"));
  if (
    !Number.isFinite(length) ||
    length <= 0 ||
    length > MAX_FILE_BYTES + 64 * 1024
  )
    throw new ApiError(413, "Upload size is missing or exceeds the limit");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "Choose a file");
  const classId = id(form.get("classId"));
  const parentId = form.get("parentId") ? id(form.get("parentId")) : null;
  await ownClass(classId, user.id);
  await validateParent(parentId, classId, user.id);
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateFile({ name: file.name, type: file.type, size: file.size }, bytes);
  const key = await storeFile(bytes);
  try {
    const result = await db.begin(async (sql) => {
      await sql`select id from users where id=${user.id} for update`;
      const [lockedClass] =
        await sql`select id from school_classes where id=${classId} and owner_id=${user.id} for update`;
      if (!lockedClass) throw new ApiError(404, "Class not found");
      await validateParent(parentId, classId, user.id);
      const usage = await storageUsage(sql, user.id);
      if (usage.usageBytes + file.size > usage.quotaBytes)
        throw new ApiError(413, "Storage quota exceeded");
      await assertUploadBindable(sql, key);
      const [row] =
        await sql`insert into school_resources(class_id,owner_id,parent_id,kind,title,data) values(${classId},${user.id},${parentId},'file',${file.name.slice(0, 160)},${sql.json({ key, name: file.name, mime: file.type || "application/octet-stream", size: file.size })}) returning *`;
      return publicResource(row as Resource, user.id);
    });
    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    await removeUncommittedFile(key);
    throw error;
  }
}
