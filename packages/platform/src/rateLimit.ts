import { db } from "@tell-aviv/database";
import { fail } from "@tell-aviv/shared";

export interface RateBucket {
  bucket: string;
  max: number;
  seconds: number;
}

/** One durable, atomic window per authenticated user/bucket, across web instances.
 * Call outside the domain transaction so rejected/failed work still consumes a
 * request budget. Saturated counters stop growing and do not prolong the window.
 */
export async function consumeRateLimit(
  userId: string,
  bucket: string,
  max: number,
  seconds: number,
) {
  if (
    !/^[a-zA-Z0-9:_-]{1,80}$/.test(bucket) ||
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > 10000 ||
    !Number.isSafeInteger(seconds) ||
    seconds < 1 ||
    seconds > 86400
  )
    throw new Error("Invalid internal rate bucket");
  const accepted = await db`
    WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS observed_at)
    INSERT INTO social_rate_windows(user_id,bucket,window_start,count)
    SELECT ${userId},${bucket},observed_at,1 FROM moment
    ON CONFLICT(user_id,bucket) DO UPDATE SET
      window_start=CASE WHEN social_rate_windows.window_start <= (SELECT observed_at FROM moment)-make_interval(secs=>${seconds})
        THEN (SELECT observed_at FROM moment) ELSE social_rate_windows.window_start END,
      count=CASE WHEN social_rate_windows.window_start <= (SELECT observed_at FROM moment)-make_interval(secs=>${seconds})
        THEN 1 ELSE social_rate_windows.count+1 END
    WHERE social_rate_windows.window_start <= (SELECT observed_at FROM moment)-make_interval(secs=>${seconds})
      OR social_rate_windows.count < ${max}
    RETURNING count`;
  if (!accepted.length)
    fail(
      429,
      "Too many requests. Try again after this request window expires.",
    );
}

const publish = { bucket: "http:creator_publish", max: 20, seconds: 60 };
const discovery = { bucket: "http:creator_discovery", max: 60, seconds: 60 };
const search = { bucket: "http:search", max: 60, seconds: 60 };
const offerCreate = {
  bucket: "http:market_offer_create",
  max: 20,
  seconds: 60,
};
const listing = { bucket: "http:market_list", max: 30, seconds: 60 };
const tradeMutation = { bucket: "http:market_mutation", max: 120, seconds: 60 };
const marketMutations = new Set([
  "marketplace.buy",
  "marketplace.cancel",
  "marketplace.offer.accept",
  "marketplace.offer.reject",
  "marketplace.offer.cancel",
  "collect.transfer",
]);

/** Deliberately selects expensive HTTP actions, never all game input traffic. */
export function authenticatedRequestBucket(
  path: readonly string[],
  method: string,
  url: string,
  input: Record<string, unknown> = {},
): RateBucket | undefined {
  if (path[0] === "creations") {
    if (["POST", "DELETE"].includes(method) &&
      (["rating", "report", "collaborators"].includes(path[2]) && path[3] !== "presence" || path[1] === "creators" && path[3] === "follow"))
      return { bucket: "http:creator_community", max: 30, seconds: 60 };
    if (method === "POST" && path.length === 3 && path[2] === "publish")
      return publish;
    if (method === "GET" && path.length === 1) return discovery;
  }
  if (
    method === "POST" &&
    path.length === 3 &&
    path[0] === "games" &&
    path[1] === "casino" &&
    path[2] === "action"
  ) {
    if (input.action === "marketplace.offer.create") return offerCreate;
    if (input.action === "marketplace.list") return listing;
    if (typeof input.action === "string" && marketMutations.has(input.action))
      return tradeMutation;
  }
  if (method !== "GET") return;
  if (path.length === 1 && path[0] === "users") return search;
  if (path.length === 2 && path[0] === "servers" && path[1] === "discover")
    return search;
  if (
    path[0] === "chat" &&
    new URL(url).searchParams.get("q")?.trim() &&
    ((path.length === 3 && path[2] === "messages") ||
      (path.length === 4 && path[2] === "threads"))
  )
    return search;
}

/** Invoke once after authentication and before dispatch to application handlers. */
export async function enforceAuthenticatedRequestRate(
  userId: string,
  path: readonly string[],
  method: string,
  url: string,
  input: Record<string, unknown> = {},
) {
  const spec = authenticatedRequestBucket(path, method, url, input);
  if (spec) await consumeRateLimit(userId, spec.bucket, spec.max, spec.seconds);
}
