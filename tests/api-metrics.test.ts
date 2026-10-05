import { it, expect } from "vitest";
import {
  apiMetricLabel,
  recordApiRequest,
  apiMetricsSnapshot,
  apiErrorCode,
  apiWorkCategory,
  recordApiWorkFailure,
  recordApiFailure,
} from "../packages/platform/src/apiMetrics";

it("keeps private URLs and arbitrary methods out of metric labels", () => {
  for (let i = 0; i < 1000; i++) {
    expect(
      apiMetricLabel(
        "GET",
        `https://fixture.test/api/chat/private-room-${i}/messages?q=private-text&token=secret`,
      ),
    ).toBe("GET chat");
    expect(
      apiMetricLabel(`PRIVATE-${i}`, `https://fixture.test/api/private-${i}`),
    ).toBe("OTHER other");
  }
});
it("counts fixed upload/economy failure buckets without persisting command inputs", () => {
  expect(apiWorkCategory(["chat", "private-room", "files"], "POST", {})).toBe(
    "upload",
  );
  expect(apiWorkCategory(["classes", "files", "upload"], "POST", {})).toBe(
    "upload",
  );
  expect(
    apiWorkCategory(["games", "casino", "action"], "POST", {
      action: "marketplace.buy",
      payload: { secret: "not-retained" },
    }),
  ).toBe("economy");
  expect(
    apiWorkCategory(["games", "casino", "action"], "POST", {
      action: "private-input",
    }),
  ).toBeUndefined();
  recordApiWorkFailure("upload");
  recordApiWorkFailure("economy");
  recordApiFailure({ code: "40001", query: "not-retained" });
  const snapshot = apiMetricsSnapshot();
  expect(snapshot.workFailures).toMatchObject({ upload: 1, economy: 1 });
  expect(snapshot.failures).toMatchObject({ postgres_40001: 1 });
  expect(JSON.stringify(snapshot)).not.toContain("not-retained");
});
it("distinguishes rejected work and server failures, bounds nonfinite latency, and returns independent snapshots", () => {
  const url = "https://fixture.test/api/errors/private-id";
  recordApiRequest("PUT", url, 200, 50);
  recordApiRequest("PUT", url, 403, 800);
  recordApiRequest("PUT", url, 503, Number.POSITIVE_INFINITY);
  const snapshot = apiMetricsSnapshot();
  const entry = snapshot.routes.find((route) => route.route === "PUT errors")!;
  expect(entry).toMatchObject({
    requests: 3,
    errors: 2,
    serverErrors: 1,
    averageMs: 283,
    maxMs: 800,
    latencyBuckets: [2, 0, 1, 0, 0],
  });
  expect(JSON.stringify(snapshot)).not.toContain("private-id");
  entry.latencyBuckets[0] = 100;
  expect(
    apiMetricsSnapshot().routes.find((route) => route.route === "PUT errors")!
      .latencyBuckets[0],
  ).toBe(2);
  expect(apiErrorCode(429)).toBe("rate_limited");
  expect(apiErrorCode(500)).toBe("internal_error");
});
