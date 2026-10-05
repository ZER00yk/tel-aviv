import { describe, expect, it } from "vitest";
import {
  metricsAuthorized,
  renderMetrics,
  sanitizedMetricSnapshot,
  sanitizedStoredSnapshot,
} from "../packages/platform/src/metricsExporter";
import {
  failureCode,
  safeSqlState,
} from "../packages/platform/src/safeFailure";

describe("private bounded operational exporter", () => {
  it("requires a separately configured high entropy bearer token", () => {
    const token = "fixture-scoped-metrics-token-32-characters";
    expect(metricsAuthorized(`Bearer ${token}`, token)).toBe(true);
    expect(metricsAuthorized(`Bearer ${token}x`, token)).toBe(false);
    expect(metricsAuthorized(`Basic ${token}`, token)).toBe(false);
    expect(metricsAuthorized("Bearer short", "short")).toBe(false);
    expect(metricsAuthorized(null, token)).toBe(false);
  });
  it("whitelists labels and drops arbitrary errors, identities, tokens and hidden state before persistence", () => {
    const snapshot = sanitizedMetricSnapshot("web", {
      password: "secret",
      routes: [
        {
          route: "GET chat",
          requests: 3,
          errors: 1,
          serverErrors: 0,
          totalMs: 600,
          latencyBuckets: [1, 2, 0, 0, 0],
          roomId: "private-room",
        },
        { route: 'GET chat" password="secret', requests: 999 },
        { route: "GET private-user-name", requests: 999 },
      ],
    });
    expect(snapshot.http).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /secret|private-room|password/,
    );
    const realtime = sanitizedMetricSnapshot("realtime", {
      counters: { connections: 2, hiddenCards: 99 },
      operations: {
        game: { requests: 4, errors: 1 },
        username: { requests: 999 },
      },
      activeConnections: 2,
      activeUsers: 1,
      messages: "private",
    });
    expect(Object.keys(realtime.counters)).not.toContain("hiddenCards");
    expect(realtime.operations).toEqual([
      { category: "game", requests: 4, errors: 1 },
    ]);
  });
  it("aggregates retained counters, cumulative latency buckets and fresh connection gauges", () => {
    const web = sanitizedMetricSnapshot("web", {
      routes: [
        {
          route: "GET me",
          requests: 3,
          errors: 1,
          serverErrors: 0,
          totalMs: 600,
          latencyBuckets: [1, 2, 0, 0, 0],
        },
      ],
    });
    const realtime = sanitizedMetricSnapshot("realtime", {
      counters: { connections: 4 },
      activeConnections: 3,
      activeUsers: 2,
    });
    const output = renderMetrics(
      [
        { service: "web", snapshot: web, ageSeconds: 1 },
        { service: "realtime", snapshot: realtime, ageSeconds: 1 },
        { service: "realtime", snapshot: realtime, ageSeconds: 60 },
      ],
      { database_healthy: 1 },
    );
    expect(output).toContain(
      'tell_aviv_http_duration_seconds_window_bucket{method="GET",route="me",le="0.5"} 3',
    );
    expect(output).toContain(
      'tell_aviv_http_duration_seconds_window_sum{method="GET",route="me"} 0.6',
    );
    expect(output).toContain("tell_aviv_realtime_connections_window 8");
    expect(output).toContain("tell_aviv_active_websocket_connections 3");
    expect(output).toContain("tell_aviv_database_healthy 1");
  });
  it("revalidates persisted snapshots and preserves only bounded SQLSTATE fingerprints", () => {
    const stored = sanitizedStoredSnapshot("web", {
      http: [
        { method: "GET", route: "chat", requests: 4, sumMs: 10, buckets: [4] },
        { method: "GET", route: 'chat\"}\nsecret_metric 999', requests: 999 },
      ],
      failures: { postgres_40001: 2, password: "private" },
      sessionToken: "private-token",
    });
    const output = renderMetrics(
      [{ service: "web", snapshot: stored, ageSeconds: 0 }],
      {},
    );
    expect(output).toContain(
      'tell_aviv_http_requests_window{method="GET",route="chat"} 4',
    );
    expect(output).toContain('fingerprint="postgres_40001"} 2');
    expect(output).not.toMatch(/private|secret_metric|sessionToken|password/);
    expect(failureCode({ code: "40P01", query: "private SQL" })).toBe(
      "postgres_40P01",
    );
    expect(failureCode({ code: "XX999", message: "private SQL" })).toBe(
      "postgres_other",
    );
    expect(failureCode(new TypeError("private input"))).toBe("type_error");
    expect(failureCode({ code: "secret-token" })).toBe("internal_error");
    expect(
      safeSqlState({
        code: {
          toString() {
            throw new Error("must not call");
          },
        },
      }),
    ).toBeUndefined();
    expect(safeSqlState({ code: "23505" })).toBe("23505");
    expect(
      failureCode({
        get code() {
          throw new Error("private getter data");
        },
      }),
    ).toBe("internal_error");
    expect(
      sanitizedMetricSnapshot("web", {
        routes: [{ route: "GET me", requests: Number.MAX_VALUE }],
      }).http[0].requests,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });
});
