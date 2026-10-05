import { db } from "@tell-aviv/database";
import { getStorageProvider } from "../../storage/src/index";
import { storageOperationsHealth } from "./storageReconciliation";
import { apiMetricsSnapshot } from "./apiMetrics";
import type { RealtimeMetricsSnapshot } from "../../../apps/realtime/src/metrics";
import { backupOperationsStatus } from "./backupStatus";

/** Administrator-only aggregate health: no object keys, private state or provider credentials. */
export async function operationalStatus() {
  let storage = "unavailable",
    realtime = "unavailable";
  let realtimeMetrics: RealtimeMetricsSnapshot | null = null;
  const tasks = await Promise.allSettled([
    Promise.resolve()
      .then(() => getStorageProvider().list({ limit: 1 }))
      .then(() => {
        storage = "healthy";
      }),
    fetch(process.env.REALTIME_HEALTH_URL ?? "http://127.0.0.1:3001/health", {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    }).then(async (response) => {
      const result = (await response.json()) as {
        ok?: boolean;
        metrics?: RealtimeMetricsSnapshot;
      };
      if (response.ok && result.ok === true) {
        realtime = "healthy";
        realtimeMetrics = result.metrics ?? null;
      }
    }),
    storageOperationsHealth(),
    db`SELECT count(*)::int AS recoverable_matches,min(updated_at) AS oldest_checkpoint FROM multiplayer_checkpoints WHERE namespace=${process.env.REALTIME_NAMESPACE ?? "tell-aviv"} AND expires_at>now()`,
    db`SELECT name,jsonb_strip_nulls(jsonb_build_object('status',case when name='ops-worker:v1' then 'Recorded' else null end,'lastFailures',case when data->>'lastFailures'~'^[0-9]{1,6}$' then (data->>'lastFailures')::integer else null end,'lastRunAt',case when data->>'lastRunAt'~'^[0-9TZ:.-]{20,30}$' then data->>'lastRunAt' else null end)) AS data,updated_at FROM operation_state WHERE name='ops-worker:v1' ORDER BY name LIMIT 30`,
    backupOperationsStatus(),
  ]);
  const value = (index: number) =>
    tasks[index].status === "fulfilled"
      ? (tasks[index] as PromiseFulfilledResult<unknown>).value
      : null;
  return {
    api: apiMetricsSnapshot(),
    storage: {
      provider: process.env.STORAGE_PROVIDER ?? "local",
      status: storage,
    },
    realtime,
    realtimeMetrics,
    storageOperations: value(2),
    recovery: (value(3) as unknown[])?.[0] ?? null,
    maintenance: value(4) ?? [],
    backups: value(5),
  };
}
