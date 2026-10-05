/** Local production/TLS fixture. Requires a matching production build; never deploys. */
import assert from "node:assert/strict";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:https";
import { request as httpRequest } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { db, closeDatabase } from "@tell-aviv/database";
const run = promisify(execFile);
const origin = "https://localhost:3643";
const namespace = `production-check-${randomUUID()}`;
const directory = await mkdtemp("/tmp/tell-aviv-production-");
const processes: ChildProcess[] = [];
let accountId: string | undefined;
let fixtureUsername: string | undefined;
let checks = 0;
const proof = randomBytes(32).toString("hex");
const config: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production",
  DEV_AUTH: "false",
  APP_URL: origin,
  NEXT_PUBLIC_REALTIME_URL: origin,
  REALTIME_HEALTH_URL: "http://localhost:3601/health",
  REALTIME_PORT: "3601",
  REALTIME_NAMESPACE: namespace,
  AUTH_TRUSTED_PROXY_SECRET: proof,
};
function child(args: string[]) {
  const process = spawn(globalThis.process.execPath, args, {
    cwd: resolve("."),
    env: config,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Retain only status on output: provider/session/credential contents never go to fixture logs.
  processes.push(process);
  process.stdout?.resume();
  process.stderr?.resume();
  return process;
}
async function ready(url: string) {
  const end = Date.now() + 45_000;
  while (Date.now() < end) {
    if (processes.some((child) => child.exitCode !== null))
      throw Error("Production fixture process exited before readiness");
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* retry a cold start */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Error("Production fixture did not become ready");
}
await run("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  join(directory, "key.pem"),
  "-out",
  join(directory, "cert.pem"),
  "-days",
  "1",
  "-subj",
  "/CN=localhost",
  "-addext",
  "subjectAltName=DNS:localhost",
]);
const proxy = createServer(
  {
    key: await readFile(join(directory, "key.pem")),
    cert: await readFile(join(directory, "cert.pem")),
  },
  (request, response) => {
    const port = request.url?.startsWith("/socket.io") ? 3601 : 3600;
    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: request.url,
        method: request.method,
        headers: {
          ...request.headers,
          host: "localhost:3643",
          "x-forwarded-proto": "https",
          "x-tell-aviv-proxy-secret": proof,
          "x-tell-aviv-client-ip": "127.0.0.1",
        },
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  },
);
proxy.on("upgrade", (request, socket, head) => {
  const upstream = httpRequest({
    hostname: "127.0.0.1",
    port: 3601,
    path: request.url,
    headers: {
      ...request.headers,
      host: "localhost:3643",
      "x-forwarded-proto": "https",
    },
  });
  upstream.on("upgrade", (response, target, targetHead) => {
    socket.write(
      `HTTP/1.1 ${response.statusCode} Switching Protocols\r\n${Object.entries(
        response.headers,
      )
        .map(([key, value]) => `${key}: ${value}`)
        .join("\r\n")}\r\n\r\n`,
    );
    if (targetHead.length) socket.write(targetHead);
    if (head.length) target.write(head);
    target.pipe(socket);
    socket.pipe(target);
    target.on("error", () => socket.destroy());
    socket.on("error", () => target.destroy());
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  child([
    "node_modules/next/dist/bin/next",
    "start",
    "apps/web",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3600",
  ]);
  child(["--import", "tsx", "apps/realtime/src/index.ts"]);
  await Promise.all([
    ready("http://localhost:3600/api/health"),
    ready("http://localhost:3601/health"),
  ]);
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(3643, "127.0.0.1", resolve);
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors: string[] = [];
  const failedRequests: { path: string; status: number; code?: string }[] = [];
  page.on("response", async (response) => {
    if (response.status() < 400) return;
    const entry: { path: string; status: number; code?: string } = {
      path: new URL(response.url()).pathname,
      status: response.status(),
    };
    try {
      const body = await response.json();
      if (typeof body.code === "string") entry.code = body.code.slice(0, 80);
    } catch {
      /* non-JSON failures */
    }
    failedRequests.push(entry);
  });
  const policyViolations: {
    directive: string;
    blocked: string;
    sourcePath: string;
    pagePath: string;
    line: number;
    column: number;
  }[] = [];
  await page.exposeFunction("recordFixtureViolation", (violation: typeof policyViolations[number]) => {
    policyViolations.push(violation);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    (window as unknown as { violations: string[] }).violations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { violations: string[] }).violations.push(
        event.violatedDirective,
      );
      void (
        window as unknown as {
          recordFixtureViolation: (violation: {
            directive: string;
            blocked: string;
            sourcePath: string;
            pagePath: string;
            line: number;
            column: number;
          }) => Promise<void>;
        }
      ).recordFixtureViolation({
        directive: event.violatedDirective,
        blocked: event.blockedURI.includes(":")
          ? new URL(event.blockedURI).pathname
          : event.blockedURI,
        sourcePath: event.sourceFile ? new URL(event.sourceFile).pathname : "",
        pagePath: location.pathname,
        line: event.lineNumber,
        column: event.columnNumber,
      });
    });
  });
  const first = await page.goto(origin);
  assert.ok(first);
  const headers = await first.allHeaders();
  const csp = headers["content-security-policy"];
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  assert.ok(csp.includes("'strict-dynamic'"));
  assert.ok(!csp.includes("'unsafe-eval'"));
  checks++;
  assert.equal(headers["strict-transport-security"], "max-age=31536000");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["x-content-type-options"], "nosniff");
  checks++;
  assert.ok(
    await page
      .locator("script")
      .evaluateAll(
        (nodes, value) =>
          nodes
            .filter(
              (node) => !node.getAttribute("src") && node.textContent?.trim(),
            )
            .every((node) => (node as HTMLScriptElement).nonce === value),
        nonce,
      ),
  );
  checks++;
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const username = `tls_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  fixtureUsername = username;
  const password = "Local production fixture passphrase 47!";
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create Tell Aviv account", exact: true })
    .click();
  await page.getByRole("navigation", { name: "Main navigation" }).waitFor();
  const me = await page.request.get(`${origin}/api/me`);
  assert.equal(me.status(), 200);
  accountId = (await me.json()).data.id as string;
  checks++;
  const cookie = (await context.cookies()).find(
    (cookie) => cookie.name === "ta_session",
  );
  assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === "Lax");
  checks++;
  const second = await page.reload();
  assert.ok(second);
  assert.notEqual(
    (await second.allHeaders())["content-security-policy"].match(
      /'nonce-([^']+)'/,
    )?.[1],
    nonce,
  );
  checks++;
  const dev = await page.request.post(`${origin}/api/auth/dev`, {
    headers: { Origin: origin },
    data: { username: "forbidden_fixture" },
  });
  assert.equal(dev.status(), 404);
  checks++;
  await page.goto(`${origin}/create`);
  await page.getByRole("button", { name: "+ New level", exact: true }).click();
  await page
    .getByLabel("Level title", { exact: true })
    .fill("Production CSP Creator");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByText("Level saved", { exact: true })
    .waitFor()
    .catch(async (error) => {
      console.log(
        JSON.stringify({
          fixtureFailure: "Creator save",
          failedRequests,
          status: await page.getByRole("status").allTextContents(),
        }),
      );
      throw error;
    });
  checks++;
  await page.goto(`${origin}/games/ego-trip/play`);
  await page
    .getByRole("button", { name: "Begin new run", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Begin new run", exact: true })
    .click();
  await page.locator("canvas").first().waitFor();
  checks++;
  await page.goto(`${origin}/settings`);
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Security", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Account Security", exact: true })
    .waitFor();
  checks++;
  assert.deepEqual(errors, []);
  assert.deepEqual(policyViolations, []);
  assert.deepEqual(
    await page.evaluate(
      () => (window as unknown as { violations: string[] }).violations,
    ),
    [],
  );
  checks++;
  console.log(
    `PASS: ${checks} local production HTTPS/browser checks; native secure cookies, request nonces, Creator, Ego canvas and security settings. Self-signed fixture only; no public TLS/deployment claim.`,
  );
} finally {
  await browser?.close();
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
  for (const child of processes)
    if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.all(
    processes.map((child) =>
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            child.once("exit", () => resolve());
            setTimeout(() => {
              child.kill("SIGKILL");
              resolve();
            }, 5000).unref();
          }),
    ),
  );
  const keys =
    await db`SELECT user_id FROM multiplayer_checkpoint_members WHERE namespace=${namespace}`;
  if (keys.length)
    throw Error("Production fixture unexpectedly retained a lobby");
  await db`DELETE FROM multiplayer_checkpoints WHERE namespace=${namespace}`;
  await db`DELETE FROM realtime_worker_epochs WHERE namespace=${namespace}`;
  await db`DELETE FROM operational_metric_snapshots WHERE namespace=${namespace}`;
  if (accountId) await db`DELETE FROM users WHERE id=${accountId}`;
  else if (fixtureUsername)
    await db`DELETE FROM users WHERE username=${fixtureUsername}`;
  await closeDatabase();
  await rm(directory, { recursive: true, force: true });
}
