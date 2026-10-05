import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@tell-aviv/database";
import {
  metricsResponse,
  persistMetricSnapshot,
} from "../packages/platform/src/metricsExporter";

describe.runIf(process.env.RUN_DB_TESTS === "true")(
  "durable private metrics export",
  () => {
    const namespace = `metrics-fixture-${randomBytes(6).toString("hex")}`;
    const neighbor = `${namespace}-other`;
    const first = randomUUID(),
      second = randomUUID(),
      expired = randomUUID();
    afterAll(async () => {
      await db`DELETE FROM operational_metric_snapshots WHERE namespace=ANY(${[namespace, neighbor]}::text[])`;
    });
    it("upserts process snapshots, keeps other namespaces, and prunes only expired owned rows", async () => {
      await db`INSERT INTO operational_metric_snapshots(namespace,service,instance_id,snapshot,expires_at) VALUES(${namespace},'web',${expired},'{}',now()-interval '1 second'),(${neighbor},'web',${expired},'{}',now()-interval '1 second')`;
      const sample = {
        routes: [
          {
            route: "GET me",
            requests: 2,
            errors: 0,
            totalMs: 200,
            latencyBuckets: [2, 0, 0, 0, 0],
          },
        ],
        sessionToken: "never-retained",
      };
      await persistMetricSnapshot("web", sample, first, namespace);
      await persistMetricSnapshot(
        "web",
        { ...sample, routes: [{ ...sample.routes[0], requests: 3 }] },
        first,
        namespace,
      );
      await persistMetricSnapshot(
        "realtime",
        { counters: { connections: 2 }, activeConnections: 1, activeUsers: 1 },
        second,
        namespace,
      );
      const rows =
        await db`SELECT snapshot,extract(epoch FROM expires_at-updated_at)::int AS ttl FROM operational_metric_snapshots WHERE namespace=${namespace}`;
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.ttl === 172800)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("never-retained");
      expect(
        rows.find((row) => row.snapshot.http.length)?.snapshot.http[0].requests,
      ).toBe(3);
      expect(
        await db`SELECT 1 FROM operational_metric_snapshots WHERE namespace=${neighbor}`,
      ).toHaveLength(1);
    });
    it("requires its separate token and scrapes retained snapshots without leaking SQL or private JSON", async () => {
      const previousNamespace = process.env.REALTIME_NAMESPACE;
      const previousToken = process.env.METRICS_SCRAPE_TOKEN;
      const token = randomBytes(32).toString("base64url");
      process.env.REALTIME_NAMESPACE = namespace;
      process.env.METRICS_SCRAPE_TOKEN = token;
      try {
        const denied = await metricsResponse(
          new Request("http://fixture.invalid/api/metrics"),
        );
        expect(denied.status).toBe(401);
        expect(denied.headers.get("cache-control")).toBe("no-store");
        await db`INSERT INTO operational_metric_snapshots(namespace,service,instance_id,snapshot,expires_at) VALUES(${namespace},'web',${randomUUID()},${db.json({ http: [{ method: "GET", route: 'chat"}\nprivate_token 99', requests: 99 }], password: "private" })},now()+interval '1 hour')`;
        const accepted = await metricsResponse(
          new Request("http://fixture.invalid/api/metrics", {
            headers: { authorization: `Bearer ${token}` },
          }),
        );
        expect(accepted.status).toBe(200);
        expect(accepted.headers.get("content-type")).toContain("text/plain");
        const text = await accepted.text();
        expect(text).toContain("tell_aviv_database_healthy 1");
        expect(text).toMatch(/tell_aviv_redis_healthy [01]/);
        if (process.env.REDIS_URL)
          expect(text).toContain("tell_aviv_redis_healthy 1");
        expect(text).toContain("tell_aviv_realtime_connections_window 2");
        expect(text).not.toMatch(/private_token|password|never-retained/);
        expect(text).not.toContain(token);
      } finally {
        if (previousNamespace === undefined)
          delete process.env.REALTIME_NAMESPACE;
        else process.env.REALTIME_NAMESPACE = previousNamespace;
        if (previousToken === undefined)
          delete process.env.METRICS_SCRAPE_TOKEN;
        else process.env.METRICS_SCRAPE_TOKEN = previousToken;
      }
    });
  },
);
