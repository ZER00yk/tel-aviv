import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, closeDatabase } from "@tell-aviv/database";
import type { User } from "@tell-aviv/shared";
import { deleteFile } from "../packages/storage/src/index";
const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
type Actor = { user: User; cookie: string };
let checks = 0;
function boundedFetch(url: string, options: RequestInit = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
}
async function request<T>(
  actor: Actor | null,
  path: string,
  method = "GET",
  input?: unknown,
  expected = 200,
): Promise<T> {
  const response = await boundedFetch(`${base}/api/${path}`, {
    method,
    headers: {
      ...(actor ? { Cookie: actor.cookie } : {}),
      ...(method === "GET"
        ? {}
        : { Origin: base, "Content-Type": "application/json" }),
    },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const body = (await response.json()) as { data: T; error?: string };
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: ${body.error ?? "unexpected status"}`,
  );
  checks++;
  return body.data;
}
async function login(username: string): Promise<Actor> {
  const response = await boundedFetch(`${base}/api/auth/dev`, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: User };
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  checks++;
  return { user: body.data, cookie };
}
const actors: Actor[] = [];
try {
  await request(null, "me", "GET", undefined, 401);
  await request(null, "classes", "GET", undefined, 401);
  await request(null, "games", "GET", undefined, 401);
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const a = await login(`smoke_a_${suffix}`),
    b = await login(`smoke_b_${suffix}`),
    c = await login(`smoke_c_${suffix}`);
  actors.push(a, b, c);
  assert.equal((await request<User>(a, "me")).id, a.user.id);
  assert.notEqual((await request<User>(b, "me")).id, a.user.id);
  const rejected = await boundedFetch(`${base}/api/profile`, {
    method: "POST",
    headers: {
      Cookie: a.cookie,
      Origin: "https://evil.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ displayName: "hijacked" }),
  });
  assert.equal(rejected.status, 403);
  checks++;
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"bio":"'));
      for (let chunk = 0; chunk < 33; chunk++)
        controller.enqueue(new Uint8Array(65536).fill(120));
      controller.enqueue(new TextEncoder().encode('"}'));
      controller.close();
    },
  });
  const oversizedOptions: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: {
      Cookie: a.cookie,
      Origin: base,
      "Content-Type": "application/json",
    },
    body: oversized,
    duplex: "half",
  };
  const tooLarge = await boundedFetch(`${base}/api/profile`, oversizedOptions);
  assert.equal(tooLarge.status, 413);
  checks++;
  await request(a, "profile", "POST", {
    displayName: "Smoke Alice",
    bio: "Integration account",
  });
  await request(a, "profile", "POST", { role: "owner" }, 400);
  await request(a, "admin/status", "GET", undefined, 403);
  await request(a, "friends/request", "POST", { userId: b.user.id });
  await request(b, `friends/${a.user.id}/accept`, "POST", {});
  const friends = await request<{ friends: { id: string }[] }>(a, "friends");
  assert.ok(friends.friends.some((x) => x.id === b.user.id));
  checks++;
  await request(a, `friends/${b.user.id}/preferences`, "POST", {
    favorite: true,
    nickname: "Private nickname",
    note: "Private friend note",
  });
  const profile = await request<Record<string, unknown>>(
    b,
    `users/${a.user.id}`,
  );
  assert.ok(!JSON.stringify(profile).includes("Private friend note"));
  checks++;
  const dm = await request<{ id: string }>(a, "chat/rooms", "POST", {
    userIds: [b.user.id],
  });
  const message = await request<{ id: string }>(
    a,
    `chat/${dm.id}/messages`,
    "POST",
    { content: "Persistent smoke message" },
  );
  await request(c, `chat/${dm.id}/messages`, "GET", undefined, 403);
  await request(
    b,
    `chat/messages/${message.id}`,
    "PATCH",
    { content: "not mine" },
    403,
  );
  await request(b, `chat/messages/${message.id}/reactions`, "POST", {
    emoji: "✨",
  });
  await request(a, `chat/messages/${message.id}`, "PATCH", {
    content: "Edited smoke message",
  });
  const messages = await request<{
    messages: { id: string; content: string; reactions: unknown[] }[];
  }>(b, `chat/${dm.id}/messages`);
  assert.equal(messages.messages[0].content, "Edited smoke message");
  assert.equal(messages.messages[0].reactions.length, 1);
  checks++;
  const server = await request<{ id: string }>(a, "servers", "POST", {
    name: "Integration server",
  });
  await request(b, `servers/${server.id}`, "GET", undefined, 403);
  const invite = await request<{ code: string }>(
    a,
    `servers/${server.id}/invites`,
    "POST",
    { maxUses: 1 },
  );
  await request(b, `invites/${invite.code}/join`, "POST", {});
  await request(c, `invites/${invite.code}/join`, "POST", {}, 404);
  await request(
    b,
    `servers/${server.id}/roles`,
    "POST",
    { name: "Unauthorized", permissions: ["manage_server"] },
    403,
  );
  const role = await request<{ id: string }>(
    a,
    `servers/${server.id}/roles`,
    "POST",
    {
      name: "Study room",
      permissions: ["view_channel", "send_messages"],
      position: 2,
    },
  );
  const channel = await request<{ id: string }>(
    a,
    `servers/${server.id}/channels`,
    "POST",
    { name: "private-role", restrictedRoleId: role.id },
  );
  await request(b, `chat/${channel.id}/messages`, "GET", undefined, 403);
  await request(a, `servers/${server.id}/members/${b.user.id}`, "POST", {
    roleIds: [role.id],
  });
  await request(b, `chat/${channel.id}/messages`);
  const party = await request<{ id: string }>(a, "parties", "POST", {});
  await request(a, `parties/${party.id}/invite`, "POST", { userId: b.user.id });
  await request(b, `parties/${party.id}/join`, "POST", {});
  await request(c, `parties/${party.id}/join`, "POST", {}, 403);
  const cls = await request<{ id: string }>(a, "classes", "POST", {
    name: "Physics",
  });
  const note = await request<{ id: string; version: number }>(
    a,
    `classes/${cls.id}/resources`,
    "POST",
    {
      kind: "note",
      title: "Private experiments",
      data: { markdown: "# Private notes\nEnergy is conserved." },
    },
  );
  const other = await request<{ id: string }>(
    a,
    `classes/${cls.id}/resources`,
    "POST",
    { kind: "note", title: "Never shared", data: { markdown: "Not public" } },
  );
  await request(b, `classes/resources/${note.id}`, "GET", undefined, 404);
  await request(a, `classes/resources/${note.id}/share`, "POST", {
    username: b.user.username,
    permission: "view",
  });
  await request(b, `classes/resources/${note.id}`);
  await request(b, `classes/resources/${other.id}`, "GET", undefined, 404);
  await request(c, `classes/resources/${note.id}`, "GET", undefined, 404);
  await request(
    b,
    `classes/resources/${note.id}`,
    "PATCH",
    { expectedVersion: 1, data: { markdown: "unauthorized edit" } },
    404,
  );
  await request(a, `classes/resources/${note.id}/share`, "POST", {
    username: b.user.username,
    permission: "edit",
  });
  const updated = await request<{ version: number }>(
    b,
    `classes/resources/${note.id}`,
    "PATCH",
    {
      expectedVersion: note.version,
      data: { markdown: "# Collaborated\nShared safely." },
    },
  );
  assert.equal(updated.version, 2);
  await request(
    a,
    `classes/resources/${note.id}`,
    "PATCH",
    { expectedVersion: 1, data: { markdown: "stale" } },
    409,
  );
  const search = await request<unknown[]>(c, "classes/search?q=Private");
  assert.equal(search.length, 0);
  checks++;
  const quiz = await request<{ id: string }>(
    a,
    `classes/${cls.id}/resources`,
    "POST",
    {
      kind: "quiz",
      title: "Conservation quiz",
      data: {
        questions: [
          {
            prompt: "2 + 2?",
            type: "multiple-choice",
            options: ["3", "4"],
            answer: "4",
          },
        ],
      },
    },
  );
  await request(a, `classes/resources/${quiz.id}/share`, "POST", {
    username: b.user.username,
    permission: "view",
  });
  const sharedQuiz = await request<{
    data: { questions: { answer?: string }[] };
  }>(b, `classes/resources/${quiz.id}`);
  assert.equal(sharedQuiz.data.questions[0].answer, undefined);
  checks++;
  const attempt = await request<{ score: number; total: number }>(
    b,
    `classes/resources/${quiz.id}/attempt`,
    "POST",
    { answers: ["4"] },
  );
  assert.equal(attempt.score, 1);
  const form = new FormData();
  form.set("classId", cls.id);
  form.set(
    "file",
    new File(["private file contents"], "experiment.txt", {
      type: "text/plain",
    }),
  );
  const upload = await boundedFetch(`${base}/api/classes/files/upload`, {
    method: "POST",
    headers: { Cookie: a.cookie, Origin: base },
    body: form,
  });
  assert.equal(upload.status, 201);
  const uploaded = (await upload.json()) as { data: { id: string } };
  checks++;
  const download = await boundedFetch(
    `${base}/api/classes/files/${uploaded.data.id}`,
    { headers: { Cookie: a.cookie } },
  );
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "private file contents");
  checks++;
  await request(c, `classes/files/${uploaded.data.id}`, "GET", undefined, 404);
  const identity = await request<Record<string, unknown>>(
    a,
    "games/incremental/user",
  );
  for (const key of ["email", "settings", "school", "documents", "google_sub"])
    assert.ok(!(key in identity));
  checks++;
  const level = {
    schemaVersion: 1,
    width: 640,
    height: 480,
    spawn: { x: 30, y: 390 },
    objects: [
      {
        id: randomUUID(),
        type: "platform",
        x: 0,
        y: 440,
        width: 640,
        height: 40,
      },
      {
        id: randomUUID(),
        type: "finish",
        x: 580,
        y: 390,
        width: 40,
        height: 50,
      },
    ],
  };
  const creation = await request<{ id: string }>(a, "creations", "POST", {
    title: "Smoke obstacle course",
    level,
  });
  await request(b, `creations/${creation.id}`, "GET", undefined, 404);
  await request(a, `creations/${creation.id}/publish`, "POST", {
    published: true,
  });
  await request(b, `creations/${creation.id}`);
  await request(b, `creations/${creation.id}/like`, "POST", { liked: true });
  await request(b, `creations/${creation.id}/comments`, "POST", {
    body: "Nice level",
  });
  await request(b, `creations/${creation.id}/play`, "POST", {});
  const saved = await request<{ revision: number }>(
    a,
    "games/ego-trip/save",
    "POST",
    { data: { run: { room: 2 } }, schemaVersion: 1, expectedRevision: 0 },
  );
  assert.equal(saved.revision, 1);
  await request(
    a,
    "games/ego-trip/save",
    "POST",
    { data: { run: { room: 3 } }, schemaVersion: 1, expectedRevision: 0 },
    409,
  );
  const isolated = await request<{ data: null }>(
    a,
    "games/physics-sandbox/save",
  );
  assert.equal(isolated.data, null);
  checks++;
  await request(
    a,
    "games/incremental/save",
    "POST",
    { data: { sparks: 1e12 } },
    403,
  );
  const incremental = await request<{ state: { spark: number } }>(
    a,
    "games/incremental/action",
    "POST",
    { action: "state", payload: {} },
  );
  assert.ok(Number.isFinite(incremental.state.spark));
  const tapped = await request<{ state: { spark: number } }>(
    a,
    "games/incremental/action",
    "POST",
    { action: "tap", payload: { amount: 1e12 } },
  );
  assert.equal(tapped.state.spark, incremental.state.spark + 1);
  checks++;
  await request(
    a,
    "games/incremental/action",
    "POST",
    { action: "setBalance", payload: { sparks: 1e12 } },
    400,
  );
  const casino = await request<{ state: { credits: number } }>(
    a,
    "games/casino/action",
    "POST",
    { action: "state", payload: {} },
  );
  assert.equal(casino.state.credits, 1000);
  await request(a, "games/casino/action", "POST", {
    action: "transfer",
    payload: { username: b.user.username, amount: 10 },
  });
  const accounts = await request<{
    accounts: { currency: string; balance: number }[];
  }>(a, "economy");
  assert.equal(
    accounts.accounts.find((x) => x.currency === "casino-credits")?.balance,
    990,
  );
  checks++;
  await request(a, "games/tower-defense/action", "POST", {
    action: "state",
    payload: {},
  });
  await request(a, "games/deck-roguelike/action", "POST", {
    action: "state",
    payload: {},
  });
  await request(a, "games/tycoon/action", "POST", {
    action: "state",
    payload: {},
  });
  await request(b, `friends/${a.user.id}/block`, "POST", {});
  await request(
    a,
    `chat/${dm.id}/messages`,
    "POST",
    { content: "must be blocked" },
    403,
  );
  await request(
    a,
    "games/casino/action",
    "POST",
    { action: "transfer", payload: { username: b.user.username, amount: 1 } },
    403,
  );
  await request(a, "auth/logout-all", "POST", {});
  await request(a, "me", "GET", undefined, 401);
  console.log(
    `PASS: ${checks} authenticated API checks — sessions, CSRF, social, roles/invites, parties, private files/sharing/revisions/quizzes, creations, namespaced saves and server economy.`,
  );
} finally {
  if (actors.length) {
    const ids = actors.map((a) => a.user.id);
    const files =
      await db`SELECT data->>'key' AS key FROM school_resources WHERE owner_id IN ${db(ids)} AND kind='file'`;
    for (const file of files) await deleteFile(file.key);
    await db`DELETE FROM school_classes WHERE owner_id IN ${db(ids)}`;
    await db`DELETE FROM servers WHERE owner_id IN ${db(ids)}`;
    await db`DELETE FROM parties WHERE leader_id IN ${db(ids)}`;
    await db`DELETE FROM chat_rooms WHERE owner_id IN ${db(ids)}`;
    await db`DELETE FROM chat_messages WHERE author_id IN ${db(ids)}`;
    await db`DELETE FROM users WHERE id IN ${db(ids)}`;
  }
  await closeDatabase();
}
