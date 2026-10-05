import { randomUUID } from "node:crypto";
import { getSession, handleAuth } from "@tell-aviv/auth";
import { enforceAuthTransportRate } from "../../../../../packages/auth/src/rateLimit";
import { ApiError, fail } from "@tell-aviv/shared";
import { ZodError } from "zod";
import {
  recordApiRequest,
  apiErrorCode,
  recordApiFailure,
  apiWorkCategory,
  recordApiWorkFailure,
} from "../../../../../packages/platform/src/apiMetrics";
import { handleSocial } from "../../../../../packages/platform/src/social";
import {
  handleClasses,
  handleClassFile,
} from "../../../../../packages/platform/src/classes";
import { handleGames } from "../../../../../packages/platform/src/games";
import { handleAdmin } from "../../../../../packages/platform/src/admin";
import { handleAccount } from "../../../../../packages/platform/src/account";
import { handleInventory } from "../../../../../packages/platform/src/inventory";
import { handleSeasons } from "../../../../../packages/platform/src/seasons";
import { enforceAuthenticatedRequestRate } from "../../../../../packages/platform/src/rateLimit";
import { metricsResponse } from "../../../../../packages/platform/src/metricsExporter";
import {
  failureCode,
  safeSqlState,
} from "../../../../../packages/platform/src/safeFailure";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ path: string[] }> };
async function readJsonBody(
  request: Request,
  limit = 2_000_000,
): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      reader.releaseLock();
      fail(413, "Request too large");
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
  } catch {
    fail(400, "Use UTF-8 JSON");
  }
}
async function handleRoute(request: Request, context: RouteContext) {
  const correlationId = randomUUID();
  let workCategory: "upload" | "economy" | undefined;
  try {
    const { path } = await context.params;
    const method = request.method;
    if (path.join("/") === "metrics" && method === "GET")
      return metricsResponse(request);
    if (path.join("/") === "health" && method === "GET")
      return Response.json({
        data: { service: "Tell Aviv", status: "running" },
      });
    let input: Record<string, unknown> = {};
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      const origin = request.headers.get("origin"),
        expected = process.env.APP_URL ?? new URL(request.url).origin;
      if (!origin || origin !== new URL(expected).origin)
        fail(403, "Request origin is not allowed");
      if (path[0] === "auth")
        await enforceAuthTransportRate(request, path.slice(1).join("/"));
      const bodyLimit = path[0] === "auth" ? 16_384 : 2_000_000;
      if (request.headers.get("content-type")?.startsWith("application/json")) {
        if (Number(request.headers.get("content-length") ?? 0) > bodyLimit)
          fail(413, "Request too large");
        const text = await readJsonBody(request, bodyLimit);
        const parsed: unknown = text ? JSON.parse(text) : {};
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          fail(400, "Expected a JSON object");
        input = parsed as Record<string, unknown>;
      } else if (
        path[0] === "auth" ||
        !request.headers.get("content-type")?.startsWith("multipart/form-data")
      )
        fail(415, "Use JSON for this request");
    }
    workCategory = apiWorkCategory(path, method, input);
    const auth = await handleAuth(path, method, request, input);
    if (auth) return auth;
    const user = await getSession(request);
    if (!user) fail(401, "Sign in to Tell Aviv");
    await enforceAuthenticatedRequestRate(
      user.id,
      path,
      method,
      request.url,
      input,
    );
    if (path[0] === "classes" && path[1] === "files" && path[2])
      return await handleClassFile(request, user, path[2]);
    if (path.join("/") === "me" && method === "GET")
      return Response.json(
        { data: user },
        { headers: { "Cache-Control": "no-store" } },
      );
    const ctx = { user, request };
    for (const handler of [
      handleAccount,
      handleInventory,
      handleSocial,
      handleClasses,
      handleGames,
      handleSeasons,
      handleAdmin,
    ]) {
      const data = await handler(path, method, ctx, input);
      if (data instanceof Response) return data;
      if (data !== undefined)
        return Response.json(
          { data },
          { headers: { "Cache-Control": "no-store" } },
        );
    }
    fail(404, "Endpoint not found");
  } catch (error) {
    let status = 500,
      message = "Something went wrong. Please try again.";
    if (error instanceof ApiError) {
      status = error.status;
      message = error.message;
    } else if (error instanceof ZodError) {
      status = 400;
      message = error.issues[0]?.message ?? "Invalid input";
    } else if (error instanceof SyntaxError) {
      status = 400;
      message = "Invalid JSON";
    } else {
      const code = safeSqlState(error);
      if (code === "23505") {
        status = 409;
        message = "This already exists";
      } else if (code === "22P02" || code === "23503") {
        status = 400;
        message = "Invalid reference";
      }
    }
    if (workCategory) recordApiWorkFailure(workCategory);
    if (status === 500) {
      recordApiFailure(error);
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          component: "api",
          correlationId,
          fingerprint: failureCode(error),
          sqlState: safeSqlState(error),
        }),
      );
    }
    return Response.json(
      { error: message, code: apiErrorCode(status), correlationId },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          ...(status === 413 ? { Connection: "close" } : {}),
        },
      },
    );
  }
}
async function route(request: Request, context: RouteContext) {
  const started = performance.now();
  const response = await handleRoute(request, context);
  recordApiRequest(
    request.method,
    request.url,
    response.status,
    performance.now() - started,
  );
  return response;
}
export {
  route as GET,
  route as POST,
  route as PATCH,
  route as PUT,
  route as DELETE,
};
