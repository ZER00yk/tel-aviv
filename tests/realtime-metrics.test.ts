import { describe, it, expect } from "vitest";
import { createRealtimeMetrics } from "../apps/realtime/src/metrics";

describe("bounded realtime metrics", () => {
  it("aggregates successes and failures without retaining inputs or unbounded labels", () => {
    const metrics = createRealtimeMetrics();
    metrics.increment("connections");
    metrics.request("game:action", false);
    metrics.request("game:private-fixture-code", true);
    for (let i = 0; i < 500; i++)
      metrics.request(`private-user-${i}:text`, true);
    const snapshot = metrics.snapshot(2, 1);
    expect(snapshot.counters).toMatchObject({
      connections: 1,
      socketRequests: 502,
      socketErrors: 501,
    });
    expect(snapshot.operations).toEqual({
      game: { requests: 2, errors: 1 },
      other: { requests: 500, errors: 500 },
    });
    expect(JSON.stringify(snapshot)).not.toContain("private-");
    snapshot.counters.connections = 100;
    snapshot.operations.game.requests = 100;
    expect(metrics.snapshot(0, 0).counters.connections).toBe(1);
    expect(metrics.snapshot(0, 0).operations.game.requests).toBe(2);
  });
});
