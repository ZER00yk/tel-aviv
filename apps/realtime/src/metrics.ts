import { failureCode } from "../../../packages/platform/src/safeFailure";
export type RealtimeCounter =
  | "connections"
  | "disconnects"
  | "recoveredLobbies"
  | "socketRequests"
  | "socketErrors"
  | "tickErrors"
  | "databaseProbeFailures"
  | "redisProbeFailures";
const counterNames: RealtimeCounter[] = [
  "connections",
  "disconnects",
  "recoveredLobbies",
  "socketRequests",
  "socketErrors",
  "tickErrors",
  "databaseProbeFailures",
  "redisProbeFailures",
];
const operationNames = new Set(["presence", "room", "party", "game"]);
/** Fixed labels only; no account IDs, lobby codes, inputs, or error text. */
export function createRealtimeMetrics() {
  const startedAt = new Date().toISOString();
  const counters = Object.fromEntries(
    counterNames.map((name) => [name, 0]),
  ) as Record<RealtimeCounter, number>;
  const operations = new Map<string, { requests: number; errors: number }>();
  const failures = new Map<string, number>();
  return {
    failure(error: unknown) {
      const code = failureCode(error);
      failures.set(code, (failures.get(code) ?? 0) + 1);
    },
    increment(name: RealtimeCounter) {
      counters[name]++;
    },
    request(event: string, failed: boolean) {
      const prefix = event.split(":", 1)[0];
      const category = operationNames.has(prefix) ? prefix : "other";
      const count = operations.get(category) ?? { requests: 0, errors: 0 };
      count.requests++;
      if (failed) count.errors++;
      operations.set(category, count);
      counters.socketRequests++;
      if (failed) counters.socketErrors++;
    },
    snapshot(sockets: number, users: number) {
      return {
        scope: "current realtime process",
        startedAt,
        activeConnections: sockets,
        activeUsers: users,
        counters: { ...counters },
        failures: Object.fromEntries(failures),
        operations: Object.fromEntries(
          [...operations].map(([key, value]) => [key, { ...value }]),
        ),
      };
    },
  };
}
export type RealtimeMetricsSnapshot = ReturnType<
  ReturnType<typeof createRealtimeMetrics>["snapshot"]
>;
