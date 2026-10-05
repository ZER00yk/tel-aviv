import { failureCode } from "./safeFailure";
const roots = new Set([
  "auth",
  "me",
  "profile",
  "users",
  "friends",
  "home",
  "chat",
  "servers",
  "parties",
  "classes",
  "creations",
  "games",
  "economy",
  "account",
  "admin",
  "inventory",
  "announcements",
  "flags",
  "errors",
  "health",
  "seasons",
]);
const methods = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
type Counter = {
  requests: number;
  errors: number;
  serverErrors: number;
  totalMs: number;
  maxMs: number;
  latencyBuckets: number[];
};
const runtime = globalThis as typeof globalThis & {
  tellAvivApiMetrics?: { startedAt: string; counters: Map<string, Counter> };
  tellAvivApiMetricsFlush?: { lastAt: number; pending: boolean };
  tellAvivApiFailures?: Map<string, number>;
  tellAvivApiWorkFailures?: Map<string, number>;
};
const metrics = (runtime.tellAvivApiMetrics ??= {
  startedAt: new Date().toISOString(),
  counters: new Map<string, Counter>(),
});
/** Bounded labels never include usernames, paths, IDs, message bodies or credentials. */
export function apiMetricLabel(method: string, url: string) {
  const root = new URL(url).pathname.split("/")[2] ?? "";
  return `${methods.has(method) ? method : "OTHER"} ${roots.has(root) ? root : "other"}`;
}
export function recordApiRequest(
  method: string,
  url: string,
  status: number,
  durationMs: number,
) {
  const label = apiMetricLabel(method, url);
  const current = metrics.counters.get(label) ?? {
    requests: 0,
    errors: 0,
    serverErrors: 0,
    totalMs: 0,
    maxMs: 0,
    latencyBuckets: [0, 0, 0, 0, 0],
  };
  const elapsed = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  current.requests++;
  current.errors += Number(status >= 400);
  current.serverErrors += Number(status >= 500);
  current.totalMs += elapsed;
  current.maxMs = Math.max(current.maxMs, elapsed);
  const bucket =
    elapsed <= 100
      ? 0
      : elapsed <= 500
        ? 1
        : elapsed <= 1000
          ? 2
          : elapsed <= 5000
            ? 3
            : 4;
  current.latencyBuckets[bucket]++;
  metrics.counters.set(label, current);
  // Best effort persistence never delays requests or includes their input.
  if (process.env.DATABASE_URL && process.env.NODE_ENV !== "test") {
    const flush = (runtime.tellAvivApiMetricsFlush ??= {
      lastAt: 0,
      pending: false,
    });
    if (!flush.pending && Date.now() - flush.lastAt >= 10_000) {
      flush.pending = true;
      flush.lastAt = Date.now();
      void import("./metricsExporter")
        .then(({ persistMetricSnapshot }) =>
          persistMetricSnapshot("web", apiMetricsSnapshot()),
        )
        .catch(() => undefined)
        .finally(() => {
          flush.pending = false;
        });
    }
  }
}
export function apiMetricsSnapshot() {
  return {
    startedAt: metrics.startedAt,
    scope: "current web process",
    failures: Object.fromEntries(runtime.tellAvivApiFailures ?? []),
    workFailures: Object.fromEntries(runtime.tellAvivApiWorkFailures ?? []),
    latencyBucketUpperMs: [100, 500, 1000, 5000, null],
    routes: [...metrics.counters].map(([route, counter]) => ({
      route,
      requests: counter.requests,
      errors: counter.errors,
      serverErrors: counter.serverErrors,
      totalMs: counter.totalMs,
      averageMs: Math.round(counter.totalMs / counter.requests),
      maxMs: Math.round(counter.maxMs),
      latencyBuckets: [...counter.latencyBuckets],
    })),
  };
}
export function recordApiFailure(error: unknown) {
  const failures = (runtime.tellAvivApiFailures ??= new Map());
  const code = failureCode(error);
  failures.set(code, (failures.get(code) ?? 0) + 1);
}
export function apiWorkCategory(
  path: readonly string[],
  method: string,
  input: Record<string, unknown>,
): "upload" | "economy" | undefined {
  if (
    method === "POST" &&
    ((path[0] === "chat" && path[2] === "files") ||
      (path[0] === "classes" && path[1] === "files" && path[2] === "upload"))
  )
    return "upload";
  if (
    path[0] === "economy" ||
    (path[0] === "games" &&
      path[1] === "casino" &&
      path[2] === "action" &&
      typeof input.action === "string" &&
      /^(collect\.|marketplace\.|loans\.)/.test(input.action))
  )
    return "economy";
}
export function recordApiWorkFailure(category: "upload" | "economy") {
  const counters = (runtime.tellAvivApiWorkFailures ??= new Map());
  counters.set(category, (counters.get(category) ?? 0) + 1);
}
export function apiErrorCode(status: number) {
  return (
    (
      {
        400: "invalid_input",
        401: "unauthenticated",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        413: "payload_too_large",
        415: "unsupported_content_type",
        429: "rate_limited",
        503: "service_unavailable",
      } as Record<number, string>
    )[status] ?? "internal_error"
  );
}
