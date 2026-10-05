import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import Redis from "ioredis";
import { db } from "@tell-aviv/database";
import { apiMetricsSnapshot, apiMetricLabel } from "./apiMetrics";
import { failureCodes } from "./safeFailure";
import type { RealtimeMetricsSnapshot } from "../../../apps/realtime/src/metrics";

type Service = "web" | "realtime";
const counterNames = [
  "connections",
  "disconnects",
  "recoveredLobbies",
  "socketRequests",
  "socketErrors",
  "tickErrors",
  "databaseProbeFailures",
  "redisProbeFailures",
] as const;
const operationNames = ["presence", "room", "party", "game", "other"];
const processMetrics = globalThis as typeof globalThis & {
  tellAvivMetricsInstanceId?: string;
};
export const metricsInstanceId = (processMetrics.tellAvivMetricsInstanceId ??=
  randomUUID());
export function metricsAuthorized(
  header: string | null,
  configured = process.env.METRICS_SCRAPE_TOKEN,
) {
  if (
    !configured ||
    configured.length < 32 ||
    configured.length > 256 ||
    !header?.startsWith("Bearer ")
  )
    return false;
  return timingSafeEqual(
    createHash("sha256").update(header.slice(7)).digest(),
    createHash("sha256").update(configured).digest(),
  );
}
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(value, Number.MAX_SAFE_INTEGER)
    : 0;
export type ExportSnapshot = {
  http: {
    method: string;
    route: string;
    requests: number;
    errors: number;
    serverErrors: number;
    sumMs: number;
    buckets: number[];
  }[];
  counters: Record<string, number>;
  operations: { category: string; requests: number; errors: number }[];
  sockets: number;
  users: number;
  failures: Record<string, number>;
  workFailures: Record<string, number>;
};
/** Persisted JSON is untrusted too: old versions and manual rows cannot add labels. */
export function sanitizedStoredSnapshot(service: Service, input: unknown) {
  const value =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  if (service === "web") {
    const http = Array.isArray(value.http) ? value.http.slice(0, 200) : [];
    return sanitizedMetricSnapshot(service, {
      failures: value.failures,
      workFailures: value.workFailures,
      routes: http.map((entry) => {
        const row =
          entry && typeof entry === "object"
            ? (entry as Record<string, unknown>)
            : {};
        return {
          route: `${String(row.method ?? "")} ${String(row.route ?? "")}`,
          requests: row.requests,
          errors: row.errors,
          serverErrors: row.serverErrors,
          totalMs: row.sumMs,
          latencyBuckets: row.buckets,
        };
      }),
    });
  }
  const operations = Array.isArray(value.operations)
    ? value.operations.slice(0, 5)
    : [];
  return sanitizedMetricSnapshot(service, {
    failures: value.failures,
    counters: value.counters,
    activeConnections: value.sockets,
    activeUsers: value.users,
    operations: Object.fromEntries(
      operations.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const row = entry as Record<string, unknown>;
        return typeof row.category === "string" &&
          operationNames.includes(row.category)
          ? [[row.category, { requests: row.requests, errors: row.errors }]]
          : [];
      }),
    ),
  });
}
/** A whitelist boundary is applied before the durable sink and again when read. */
export function sanitizedMetricSnapshot(
  service: Service,
  input: unknown,
): ExportSnapshot {
  const value =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const result: ExportSnapshot = {
    http: [],
    counters: {},
    operations: [],
    sockets: 0,
    users: 0,
    failures: {},
    workFailures: {},
  };
  const failures =
    value.failures && typeof value.failures === "object"
      ? (value.failures as Record<string, unknown>)
      : {};
  for (const code of failureCodes)
    if (finite(failures[code])) result.failures[code] = finite(failures[code]);
  if (service === "web") {
    const work =
      value.workFailures && typeof value.workFailures === "object"
        ? (value.workFailures as Record<string, unknown>)
        : {};
    for (const category of ["upload", "economy"])
      result.workFailures[category] = finite(work[category]);
  }
  if (service === "web" && Array.isArray(value.routes)) {
    for (const entry of value.routes.slice(0, 200)) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const [method, route] = String(row.route ?? "").split(" ");
      if (
        apiMetricLabel(method, `http://metrics.invalid/api/${route}`) !==
        row.route
      )
        continue;
      result.http.push({
        method,
        route,
        requests: finite(row.requests),
        errors: finite(row.errors),
        serverErrors: finite(row.serverErrors),
        sumMs: finite(row.totalMs),
        buckets: Array.isArray(row.latencyBuckets)
          ? Array.from({ length: 5 }, (_, i) =>
              finite((row.latencyBuckets as unknown[])[i]),
            )
          : [0, 0, 0, 0, 0],
      });
    }
  }
  if (service === "realtime") {
    const counters =
      value.counters && typeof value.counters === "object"
        ? (value.counters as Record<string, unknown>)
        : {};
    for (const name of counterNames)
      result.counters[name] = finite(counters[name]);
    const operations =
      value.operations && typeof value.operations === "object"
        ? (value.operations as Record<string, unknown>)
        : {};
    for (const category of operationNames) {
      const row = operations[category] as Record<string, unknown> | undefined;
      if (row && typeof row === "object")
        result.operations.push({
          category,
          requests: finite(row.requests),
          errors: finite(row.errors),
        });
    }
    result.sockets = finite(value.activeConnections);
    result.users = finite(value.activeUsers);
  }
  return result;
}
export async function persistMetricSnapshot(
  service: Service,
  input: unknown,
  instance = metricsInstanceId,
  namespace = process.env.REALTIME_NAMESPACE ?? "tell-aviv",
) {
  const snapshot = sanitizedMetricSnapshot(service, input);
  await db`INSERT INTO operational_metric_snapshots(namespace,service,instance_id,snapshot,expires_at) VALUES(${namespace},${service},${instance},${db.json(snapshot)},now()+interval '48 hours') ON CONFLICT(namespace,service,instance_id) DO UPDATE SET snapshot=excluded.snapshot,updated_at=now(),expires_at=excluded.expires_at`;
  // Bound retention without an unbounded foreground delete or clearing other namespaces.
  await db`DELETE FROM operational_metric_snapshots WHERE (namespace,service,instance_id) IN (SELECT namespace,service,instance_id FROM operational_metric_snapshots WHERE namespace=${namespace} AND expires_at<=now() ORDER BY expires_at LIMIT 100)`;
}
const snake = (value: string) =>
  value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
export function renderMetrics(
  rows: { service: Service; snapshot: ExportSnapshot; ageSeconds: number }[],
  gauges: Record<string, number>,
) {
  const metrics = new Map<string, number>();
  const add = (label: string, value: number) =>
    metrics.set(label, (metrics.get(label) ?? 0) + finite(value));
  for (const row of rows) {
    const data = sanitizedStoredSnapshot(row.service, row.snapshot);
    for (const code of failureCodes)
      add(
        `tell_aviv_worker_failures_window{service="${row.service}",fingerprint="${code}"}`,
        data.failures?.[code],
      );
    if (row.service === "web")
      for (const category of ["upload", "economy"])
        add(
          `tell_aviv_http_work_errors_window{operation="${category}"}`,
          data.workFailures[category],
        );
    for (const entry of data.http) {
      const labels = `method="${entry.method}",route="${entry.route}"`;
      add(`tell_aviv_http_requests_window{${labels}}`, entry.requests);
      add(`tell_aviv_http_errors_window{${labels}}`, entry.errors);
      add(`tell_aviv_http_server_errors_window{${labels}}`, entry.serverErrors);
      add(
        `tell_aviv_http_duration_seconds_window_sum{${labels}}`,
        entry.sumMs / 1000,
      );
      add(
        `tell_aviv_http_duration_seconds_window_count{${labels}}`,
        entry.requests,
      );
      let cumulative = 0;
      for (const [i, bound] of ["0.1", "0.5", "1", "5", "+Inf"].entries()) {
        cumulative += entry.buckets[i];
        add(
          `tell_aviv_http_duration_seconds_window_bucket{${labels},le="${bound}"}`,
          cumulative,
        );
      }
    }
    for (const name of counterNames)
      add(`tell_aviv_realtime_${snake(name)}_window`, data.counters[name]);
    for (const entry of data.operations) {
      add(
        `tell_aviv_socket_requests_window{operation="${entry.category}"}`,
        entry.requests,
      );
      add(
        `tell_aviv_socket_errors_window{operation="${entry.category}"}`,
        entry.errors,
      );
    }
    if (row.ageSeconds <= 30) {
      add("tell_aviv_active_websocket_connections", data.sockets);
      add("tell_aviv_active_websocket_users", data.users);
    }
  }
  for (const [name, value] of Object.entries(gauges))
    add(`tell_aviv_${name}`, value);
  return (
    "# Process lifetime counters are retained for 48 hours after their final snapshot; gauges use samples no older than 30 seconds.\n" +
    [...metrics]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `${name} ${value}`)
      .join("\n") +
    "\n"
  );
}
export async function prometheusMetrics() {
  await persistMetricSnapshot("web", apiMetricsSnapshot());
  const namespace = process.env.REALTIME_NAMESPACE ?? "tell-aviv";
  const [rows, [database], [work]] = await Promise.all([
    db`SELECT service,snapshot,extract(epoch FROM now()-updated_at)::float8 AS age FROM operational_metric_snapshots WHERE namespace=${namespace} AND expires_at>now() ORDER BY updated_at DESC LIMIT 500`,
    db`SELECT count(*)::int AS connections,count(*) FILTER(WHERE state='active')::int AS active,current_setting('max_connections')::int AS capacity FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user`,
    db`SELECT (SELECT count(*) FROM storage_cleanup_jobs)::int AS cleanup,(SELECT count(*) FROM storage_cleanup_jobs WHERE attempts>=3)::int AS cleanup_retrying,(SELECT count(*) FROM matchmaking_tickets WHERE namespace=${namespace} AND status IN ('waiting','matching'))::int AS queued,(SELECT count(*) FROM matchmaking_tickets WHERE namespace=${namespace} AND status='failed')::int AS failed_matches,(SELECT count(*) FROM multiplayer_checkpoints WHERE namespace=${namespace} AND expires_at>now() AND snapshot->>'status'='playing')::int AS matches`,
  ]);
  let redisHealthy = 0,
    redisBytes = 0;
  if (process.env.REDIS_URL) {
    const redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      connectTimeout: 1500,
    });
    redis.on("error", () => undefined);
    try {
      await redis.connect();
      await redis.ping();
      redisHealthy = 1;
      redisBytes = Number(
        (await redis.info("memory")).match(/^used_memory:(\d+)/m)?.[1] ?? 0,
      );
    } catch {
      /* Health gauges report failure without leaking endpoint details. */
    } finally {
      redis.disconnect();
    }
  }
  return renderMetrics(
    rows.map((row) => ({
      service: row.service as Service,
      snapshot: sanitizedStoredSnapshot(row.service as Service, row.snapshot),
      ageSeconds: Number(row.age),
    })),
    {
      database_healthy: 1,
      database_connections: Number(database.connections),
      database_active_connections: Number(database.active),
      database_server_connection_capacity: Number(database.capacity),
      redis_healthy: redisHealthy,
      redis_used_memory_bytes: redisBytes,
      cleanup_backlog: Number(work.cleanup),
      cleanup_retrying: Number(work.cleanup_retrying),
      queued_tickets: Number(work.queued),
      active_matches: Number(work.matches),
      failed_matchmaking_attempts: Number(work.failed_matches),
      web_process_memory_bytes: process.memoryUsage().rss,
    },
  );
}
export async function metricsResponse(request: Request) {
  if (!metricsAuthorized(request.headers.get("authorization")))
    return new Response("Metrics authorization required\n", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  try {
    return new Response(await prometheusMetrics(), {
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("tell_aviv_database_healthy 0\n", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}
export async function persistRealtimeMetrics(
  snapshot: RealtimeMetricsSnapshot,
) {
  await persistMetricSnapshot("realtime", snapshot);
}
