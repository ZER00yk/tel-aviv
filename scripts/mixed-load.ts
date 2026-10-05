/** Local fixture load, not a production capacity benchmark. All writes own UUIDs. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Redis from "ioredis";
import { io, type Socket } from "socket.io-client";
import { db, closeDatabase } from "@tell-aviv/database";
import { deleteAccount } from "../packages/platform/src/account";
import { authRateScopeHash } from "../packages/auth/src/rateLimit";
import { starterLevel } from "../packages/creator-runtime/src/schema";

const base = new URL(process.env.LOAD_BASE_URL ?? "http://localhost:3000");
assert(
  ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname),
  "Fixture load is limited to a local HTTP server",
);
const origin = base.origin;
const count = Number(process.env.LOAD_USERS ?? 2),
  rounds = Number(process.env.LOAD_ROUNDS ?? 4);
assert(
  Number.isInteger(count) && count >= 2 && count <= 6 && count % 2 === 0,
  "LOAD_USERS must be 2, 4 or 6",
);
assert(
  Number.isInteger(rounds) && rounds >= 1 && rounds <= 20,
  "LOAD_ROUNDS must be 1–20",
);
assert(process.env.REDIS_URL, "REDIS_URL is required");
const suffix = randomBytes(6).toString("hex");
const namespace = `tell-aviv:load:${suffix}`;
const edition = `load-${suffix}`;
const port = 3501;
type Actor = {
  id: string;
  username: string;
  password: string;
  cookie: string;
  socket?: Socket;
  classId?: string;
  noteId?: string;
  noteVersion: number;
  creationId?: string;
  creationVersion: number;
};
type Lobby = {
  code: string;
  matchId: string;
  status: string;
  state: {
    kind: string;
    board?: (string | null)[][];
    seats?: { userId: string }[];
    turnIndex?: number | null;
    revision?: number;
    stage?: string;
    players?: { userId: string; lastSequence: number }[];
  };
};
const actors: Actor[] = [],
  sockets: Socket[] = [],
  matchIds = new Set<string>();
const samples: {
  operation: string;
  ms: number;
  ok: boolean;
  expectedRejection: boolean;
}[] = [];
const assertions: string[] = [];
let child: ChildProcess | undefined,
  childOutput = "",
  redis: Redis | undefined;
const started = performance.now(),
  initialCpu = process.cpuUsage();
let workerBefore: { cpuTicks: number; rssBytes: number } | undefined;
let resources: Record<string, unknown> = {};
let failed = false,
  cleanupVerified = false;

async function measured<T>(
  operation: string,
  fn: () => Promise<T>,
  expectedRejection = false,
): Promise<T> {
  const start = performance.now();
  try {
    const value = await fn();
    samples.push({
      operation,
      ms: performance.now() - start,
      ok: true,
      expectedRejection,
    });
    return value;
  } catch (error) {
    samples.push({
      operation,
      ms: performance.now() - start,
      ok: false,
      expectedRejection,
    });
    throw error;
  }
}
async function request<T>(
  actor: Actor | undefined,
  path: string,
  method = "GET",
  payload?: unknown,
  expected = 200,
  label = `${method} ${path.split("/")[0]}`,
): Promise<T> {
  return measured(
    label,
    async () => {
      const response = await fetch(`${origin}/api/${path}`, {
        method,
        signal: AbortSignal.timeout(15000),
        headers: {
          ...(actor?.cookie ? { Cookie: actor.cookie } : {}),
          ...(method === "GET"
            ? {}
            : { Origin: origin, "Content-Type": "application/json" }),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      assert.equal(
        response.status,
        expected,
        `${label}: unexpected HTTP status ${response.status}`,
      );
      if (actor && path.startsWith("auth/"))
        actor.cookie =
          response.headers.get("set-cookie")?.split(";")[0] ?? actor.cookie;
      const body = (await response.json()) as { data: T };
      return body.data;
    },
    expected >= 400,
  );
}
async function emit<T = Lobby>(
  actor: Actor,
  event: string,
  payload: unknown = {},
  expectError = false,
) {
  return measured(
    `socket ${event}`,
    async () => {
      const result = await new Promise<{ data: T; error?: string }>(
        (accept, reject) =>
          actor
            .socket!.timeout(5000)
            .emit(
              event,
              payload,
              (error: Error | null, response: { data: T; error?: string }) =>
                error ? reject(error) : accept(response),
            ),
      );
      assert.equal(
        Boolean(result.error),
        expectError,
        `${event}: ${expectError ? "expected rejection" : "unexpected rejection"}`,
      );
      return result.data;
    },
    expectError,
  );
}
async function connect(actor: Actor) {
  actor.socket = io(`http://127.0.0.1:${port}`, {
    reconnection: false,
    transports: ["websocket"],
    extraHeaders: { Origin: origin, Cookie: actor.cookie },
  });
  sockets.push(actor.socket);
  await measured(
    "socket connect",
    () =>
      new Promise<void>((accept, reject) => {
        actor.socket!.once("connect", accept);
        actor.socket!.once("connect_error", reject);
        setTimeout(
          () => reject(new Error("Owned socket connect timed out")),
          5000,
        ).unref();
      }),
  );
}
async function launch() {
  child = spawn(
    process.execPath,
    ["--env-file=.env", "--import", "tsx", "apps/realtime/src/index.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_URL: origin,
        REALTIME_HOST: "127.0.0.1",
        REALTIME_PORT: String(port),
        REALTIME_NAMESPACE: namespace,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (chunk: Buffer) => {
      childOutput = (childOutput + chunk.toString()).slice(-4000);
    });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw new Error("Owned realtime fixture exited before readiness");
    try {
      if (
        (
          await fetch(`http://127.0.0.1:${port}/health`, {
            signal: AbortSignal.timeout(250),
          })
        ).ok
      )
        return;
    } catch {
      /* Bounded readiness polling. */
    }
    await delay(100);
  }
  throw new Error("Owned realtime fixture did not become ready");
}
async function workerResources() {
  if (!child?.pid) return undefined;
  try {
    const [stat, status] = await Promise.all([
      readFile(`/proc/${child.pid}/stat`, "utf8"),
      readFile(`/proc/${child.pid}/status`, "utf8"),
    ]);
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return {
      cpuTicks: Number(fields[11]) + Number(fields[12]),
      rssBytes: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) * 1024,
    };
  } catch {
    return undefined;
  }
}
async function setupActor(index: number) {
  const actor: Actor = {
    id: "",
    username: `load_${suffix}_${index}`,
    password: randomBytes(24).toString("base64url"),
    cookie: "",
    noteVersion: 1,
    creationVersion: 1,
  };
  const user = await request<{ id: string; username: string }>(
    actor,
    "auth/register",
    "POST",
    {
      username: actor.username,
      password: actor.password,
      passwordConfirmation: actor.password,
    },
    200,
    "native register",
  );
  assert.equal(user.username, actor.username);
  actor.id = user.id;
  // Track only the server-returned UUID after verifying this local DB owns it.
  const [owned] =
    await db`SELECT id FROM users WHERE id=${actor.id} AND username=${actor.username}`;
  assert(owned, "HTTP and fixture database do not refer to the same account");
  actors.push(actor);
  await request(actor, "auth/logout", "POST", {}, 200, "native logout");
  await request(
    actor,
    "auth/login",
    "POST",
    { username: actor.username, password: actor.password },
    200,
    "native login",
  );
  const school = await request<{ id: string }>(actor, "classes", "POST", {
    name: "Owned load fixture",
  });
  actor.classId = school.id;
  const note = await request<{ id: string; version: number }>(
    actor,
    `classes/${school.id}/resources`,
    "POST",
    { kind: "note", title: "Load note", data: { markdown: "Fixture" } },
  );
  actor.noteId = note.id;
  actor.noteVersion = note.version;
  const creation = await request<{ id: string; version: number }>(
    actor,
    "creations",
    "POST",
    { title: "Owned load level", level: starterLevel() },
  );
  actor.creationId = creation.id;
  actor.creationVersion = creation.version;
  await request(actor, "games/casino");
  await connect(actor);
  return actor;
}
async function lobby(
  a: Actor,
  b: Actor,
  gameId: string,
  options: Record<string, unknown> = {},
) {
  const made = await emit(a, "game:lobby:create", {
    gameId,
    visibility: "private",
    ...options,
  });
  matchIds.add(made.matchId);
  await emit(b, "game:lobby:join", { code: made.code });
  await emit(a, "game:lobby:ready", { ready: true });
  await emit(b, "game:lobby:ready", { ready: true });
  const startedMatch = await emit(a, "game:lobby:start");
  matchIds.add(startedMatch.matchId);
  return startedMatch;
}
try {
  await launch();
  redis = new Redis(process.env.REDIS_URL);
  workerBefore = await workerResources();
  await db`INSERT INTO casino_collectible_stock(item_id,supply,price) VALUES(${edition},${count * rounds + 1},1)`;
  for (let index = 0; index < count; index++) await setupActor(index);
  const room = await request<{ id: string }>(actors[0], "chat/rooms", "POST", {
    userIds: actors.slice(1).map((actor) => actor.id),
  });
  for (const actor of actors)
    await emit(actor, "room:subscribe", { roomId: room.id });
  for (let i = 0; i < rounds; i++) {
    await Promise.all(
      actors.map(async (actor) => {
        await request(actor, "me");
        await request(actor, `chat/${room.id}/messages`, "POST", {
          content: `Owned fixture round ${i}`,
        });
        await request(actor, `chat/${room.id}/messages`);
        const note = await request<{ version: number }>(
          actor,
          `classes/resources/${actor.noteId}`,
          "PATCH",
          {
            expectedVersion: actor.noteVersion,
            data: { markdown: `Fixture round ${i}` },
          },
          200,
          "Classes autosave",
        );
        actor.noteVersion = note.version;
        const creation = await request<{ version: number }>(
          actor,
          `creations/${actor.creationId}`,
          "PATCH",
          {
            expectedVersion: actor.creationVersion,
            title: "Owned load level",
            level: starterLevel(),
          },
          200,
          "Creator autosave",
        );
        actor.creationVersion = creation.version;
        await request(actor, "games/casino");
        await emit(actor, "presence:heartbeat");
        await emit(actor, "presence:snapshot");
      }),
    );
    if (rounds > 8) await delay(1100);
  }
  for (let index = 0; index < count; index += 2) {
    const a = actors[index],
      b = actors[index + 1];
    await request(a, "friends/request", "POST", { userId: b.id });
    await request(b, `friends/${a.id}/accept`, "POST", {});
    const party = await request<{ id: string }>(a, "parties", "POST", {});
    await request(a, `parties/${party.id}/invite`, "POST", { userId: b.id });
    await request(b, `parties/${party.id}/join`, "POST", {});
    await emit(a, "party:recover");
    await emit(a, "game:queue:join", { gameId: "connect-four" });
    await emit(b, "game:queue:join", { gameId: "connect-four" });
    // Queue matching is asynchronous; leave/cancel only our ticket/member UUIDs.
    await delay(350);
    await emit(a, "game:queue:leave");
    await emit(b, "game:queue:leave");
    const match = await lobby(a, b, "connect-four");
    const moved = await emit(a, "game:action", { type: "drop", column: 0 });
    assert.equal(moved.state.board?.[5][0], a.id);
    await emit(a, "game:action", { type: "drop", column: 0 }, true);
    await delay(110); // Delayed/out-of-turn duplicate cannot add a second chip.
    await emit(a, "game:action", { type: "drop", column: 2 }, true);
    b.socket!.disconnect();
    await delay(220);
    await connect(b);
    const recovered = await emit(b, "game:lobby:recover");
    assert.equal(recovered.matchId, match.matchId);
    assert.deepEqual(recovered.state.board, moved.state.board);
    await emit(b, "game:action", { type: "drop", column: 1 });
    const canon = await emit(a, "game:lobby:recover");
    assert.equal(canon.state.board?.[5][2], null);
    await emit(a, "game:lobby:leave");
    await emit(b, "game:lobby:leave");
    assertions.push(
      "Board delayed duplicate rejects; reconnect restores the same match and board",
    );
    let poker = await lobby(a, b, "poker");
    const turnId = poker.state.seats?.[poker.state.turnIndex ?? 0]?.userId;
    const acting = turnId === a.id ? a : b;
    const staleRevision = poker.state.revision;
    poker = await emit(acting, "game:action", {
      type: "poker:fold",
      revision: staleRevision,
    });
    assert.equal(poker.status, "finished");
    await emit(
      acting,
      "game:action",
      { type: "poker:fold", revision: staleRevision },
      true,
    );
    const [receipt] =
      await db`SELECT count(*)::int AS count FROM multiplayer_matches WHERE id=${poker.matchId}`;
    assert.equal(receipt.count, 1);
    await emit(a, "game:lobby:leave");
    await emit(b, "game:lobby:leave");
    assertions.push(
      "Poker duplicate terminal action rejects and has one match receipt",
    );
    await lobby(a, b, "ego-trip", { coopMode: "campaign" });
    await emit(a, "game:action", {
      type: "coop:input",
      sequence: 1,
      dx: 0.2,
      dy: 0,
      aimX: 800,
      aimY: 300,
      fire: true,
      alternate: false,
      dash: false,
      revive: false,
    });
    await emit(
      a,
      "game:action",
      {
        type: "coop:input",
        sequence: 1,
        dx: 0.2,
        dy: 0,
        aimX: 800,
        aimY: 300,
        fire: true,
        alternate: false,
        dash: false,
        revive: false,
      },
      true,
    );
    assertions.push("Ego Trip rejects a repeated input sequence");
    await emit(a, "game:lobby:leave");
    await emit(b, "game:lobby:leave");
    const bought = await request<{ state: { lastResult: { copyId: string } } }>(
      a,
      "games/casino/action",
      "POST",
      { action: "collect.buy", payload: { itemId: edition } },
      200,
      "market collectible purchase",
    );
    const listed = await request<{
      state: { lastResult: { listingId: string } };
    }>(
      a,
      "games/casino/action",
      "POST",
      {
        action: "marketplace.list",
        payload: { copyId: bought.state.lastResult.copyId, price: 2 },
      },
      200,
      "market listing",
    );
    await request(
      b,
      "games/casino/action",
      "POST",
      {
        action: "marketplace.buy",
        payload: { listingId: listed.state.lastResult.listingId },
      },
      200,
      "market purchase",
    );
  }
  const [database] =
    await db`SELECT count(*)::int AS connections,count(*) FILTER(WHERE state='active')::int AS active FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user`;
  const workerAfter = await workerResources();
  resources = {
    harnessCpuMicros: process.cpuUsage(initialCpu),
    harnessRssBytes: process.memoryUsage().rss,
    realtimeWorker: workerAfter,
    realtimeCpuTickDelta:
      workerAfter && workerBefore
        ? workerAfter.cpuTicks - workerBefore.cpuTicks
        : null,
    dbConnectionsForApplicationRole: database.connections,
    dbActiveConnectionsForApplicationRole: database.active,
    redisUsedMemoryBytes: Number(
      (await redis.info("memory")).match(/^used_memory:(\d+)/m)?.[1] ?? 0,
    ),
  };
} catch (error) {
  failed = true;
  // Never dump server responses, child output, cookies, passwords or private content.
  console.error(error instanceof Error ? error.message : "Fixture load failed");
} finally {
  for (const socket of sockets) socket.disconnect();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((accept) =>
      child!.once("exit", () => accept()),
    );
    child.kill("SIGTERM");
    await Promise.race([exited, delay(6000)]);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await Promise.race([exited, delay(1000)]);
  }
  if (redis) {
    const owned = await redis.keys(`${namespace}:*`);
    if (owned.length) await redis.del(...owned);
    for (const actor of actors)
      for (const pattern of [
        `tell-aviv:rate:${actor.id}:*`,
        `tell-aviv:connections:${actor.id}`,
        `tell-aviv:activity:${actor.id}`,
        `tell-aviv:presence:${actor.id}`,
      ]) {
        const keys = await redis.keys(pattern);
        if (keys.length) await redis.del(...keys);
      }
    await redis.quit();
  }
  await db`DELETE FROM multiplayer_matches WHERE id=ANY(${[...matchIds]}::uuid[])`;
  await db`DELETE FROM multiplayer_checkpoints WHERE namespace=${namespace}`;
  await db`DELETE FROM matchmaking_tickets WHERE namespace=${namespace}`;
  await db`DELETE FROM operational_metric_snapshots WHERE namespace=${namespace}`;
  await db`DELETE FROM realtime_worker_epochs WHERE namespace=${namespace}`;
  // The UUID and generated username pair is checked again before deletion.
  for (const actor of actors) {
    const [owned] =
      await db`SELECT id FROM users WHERE id=${actor.id} AND username=${actor.username}`;
    if (owned) await deleteAccount(actor.id, `DELETE ${actor.username}`);
    await db`DELETE FROM auth_request_windows WHERE scope_hash=ANY(${[authRateScopeHash("identity", actor.username), authRateScopeHash("identity", actor.id)]}::text[])`;
  }
  await db`DELETE FROM casino_collectible_stock WHERE item_id=${edition}`;
  const [left] =
    await db`SELECT count(*)::int AS count FROM users WHERE id=ANY(${actors.map((actor) => actor.id)}::uuid[])`;
  cleanupVerified = left.count === 0;
  const elapsedMs = performance.now() - started;
  const summary = [...new Set(samples.map((sample) => sample.operation))].map(
    (operation) => {
      const values = samples.filter((sample) => sample.operation === operation),
        timings = values.map((sample) => sample.ms).sort((a, b) => a - b);
      return {
        operation,
        requests: values.length,
        errors: values.filter((sample) => !sample.ok).length,
        expectedRejections: values.filter((sample) => sample.expectedRejection)
          .length,
        p50Ms: Math.round(timings[Math.ceil(timings.length * 0.5) - 1] ?? 0),
        p95Ms: Math.round(timings[Math.ceil(timings.length * 0.95) - 1] ?? 0),
      };
    },
  );
  const output = resolve(
    ".local",
    `mixed-load-${new Date().toISOString().replaceAll(":", "-")}.json`,
  );
  await mkdir(resolve(".local"), { recursive: true });
  const report = {
    scope: "Local fixture run; no production capacity claim",
    users: count,
    rounds,
    elapsedMs: Math.round(elapsedMs),
    operations: samples.length,
    operationsPerSecondIncludingSetupAndCleanup: Number(
      (samples.length / (elapsedMs / 1000)).toFixed(2),
    ),
    errors: samples.filter((sample) => !sample.ok).length,
    failed,
    cleanupVerified,
    assertions,
    resources,
    summary,
    childOutputOmitted: Boolean(childOutput),
  };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      report: output,
      operations: report.operations,
      errors: report.errors,
      failed,
      cleanupVerified,
    }),
  );
  await closeDatabase();
  if (failed || !cleanupVerified) process.exitCode = 1;
}
