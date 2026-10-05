/** Verify an existing HTTPS deployment through public HTTP, Chromium and WSS.
 * No development login, direct database writes or infrastructure changes.
 * E2E_BASE_URL selects the target. Only loopback accepts a local test CA.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type BrowserContext } from "@playwright/test";
import { io, type Socket } from "socket.io-client";

const target = new URL(process.env.E2E_BASE_URL ?? "https://localhost:3843");
assert.equal(
  target.protocol,
  "https:",
  "Deployment verification requires HTTPS",
);
assert.ok(
  !target.username && !target.password,
  "Do not put credentials in the target URL",
);
const origin = target.origin;
const localCA = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
const reportPath =
  process.env.DEPLOY_BROWSER_REPORT ??
  ".local/verification/deployed-browser-check-5.json";
const checks: Record<string, boolean> = {};
const pageErrors: string[] = [];
const cspViolations: string[] = [];
const sockets: Socket[] = [];
const accounts: {
  context: BrowserContext;
  username: string;
  password: string;
}[] = [];
const cleanupFailures: string[] = [];
let phase = "launch";
let failure: string | undefined;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const makeAccount = async () => {
  const account = {
    context: await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: localCA,
    }),
    username: `deploy_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    password: `${randomBytes(24).toString("base64url")} deployment 7!`,
  };
  accounts.push(account);
  return account;
};
function check(name: string, condition: unknown) {
  assert.ok(condition, `Deployment check failed: ${name}`);
  checks[name] = true;
}
async function nativeSocket(context: BrowserContext, requestOrigin: string) {
  const cookie = (await context.cookies(origin)).find(
    (value) => value.name === "ta_session",
  );
  assert.ok(cookie, "The native browser session is missing");
  const socket = io(origin, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 10000,
    rejectUnauthorized: !localCA,
    extraHeaders: {
      Origin: requestOrigin,
      Cookie: `ta_session=${cookie.value}`,
    },
  });
  sockets.push(socket);
  return socket;
}
async function connected(socket: Socket) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Deployment WebSocket timed out")),
      12000,
    );
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("connect_error", () => {
      clearTimeout(timeout);
      reject(new Error("Deployment WebSocket was rejected"));
    });
  });
}
async function ack(
  socket: Socket,
  event: string,
  input: Record<string, unknown>,
) {
  return new Promise<{ data?: unknown; error?: string }>((resolve, reject) => {
    socket
      .timeout(10000)
      .emit(
        event,
        input,
        (error: Error | null, response: { data?: unknown; error?: string }) => {
          if (error) reject(new Error(`Deployment ${event} timed out`));
          else resolve(response);
        },
      );
  });
}

try {
  const owner = await makeAccount();
  const page = await owner.context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", () => pageErrors.push("browser execution error"));
  await page.exposeFunction(
    "recordDeploymentCspViolation",
    (directive: string) => {
      cspViolations.push(directive.slice(0, 80));
    },
  );
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      void (
        window as unknown as {
          recordDeploymentCspViolation: (directive: string) => Promise<void>;
        }
      ).recordDeploymentCspViolation(event.violatedDirective);
    });
  });
  phase = "HTTPS and security headers";
  const first = await page.goto(origin);
  assert.ok(first);
  check("homepage200", first.status() === 200);
  const headers = await first.allHeaders();
  const csp = headers["content-security-policy"] ?? "";
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  check(
    "productionCsp",
    !!nonce &&
      csp.includes("'strict-dynamic'") &&
      !csp.includes("'unsafe-eval'"),
  );
  check(
    "securityHeaders",
    headers["strict-transport-security"] === "max-age=31536000" &&
      headers["x-frame-options"] === "DENY" &&
      headers["x-content-type-options"] === "nosniff",
  );
  check(
    "inlineScriptNonces",
    await page
      .locator("script")
      .evaluateAll(
        (nodes, expected) =>
          nodes
            .filter(
              (node) => !node.getAttribute("src") && node.textContent?.trim(),
            )
            .every((node) => (node as HTMLScriptElement).nonce === expected),
        nonce,
      ),
  );
  check(
    "health200",
    (await owner.context.request.get("/api/health")).status() === 200,
  );
  const status = await owner.context.request.get("/api/auth/status");
  const auth = (await status.json()).data;
  check(
    "nativeAuthWithoutDevLogin",
    status.status() === 200 &&
      auth.nativeAuthentication === true &&
      auth.developmentLogin === false,
  );
  phase = "native registration";
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Username", { exact: true }).fill(owner.username);
  await page.getByLabel("New password", { exact: true }).fill(owner.password);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(owner.password);
  await page
    .getByRole("button", { name: "Create Tell Aviv account", exact: true })
    .click();
  await page.getByRole("navigation", { name: "Main navigation" }).waitFor();
  const me = await owner.context.request.get("/api/me");
  check(
    "nativeRegistration",
    me.status() === 200 && (await me.json()).data.username === owner.username,
  );
  const cookie = (await owner.context.cookies(origin)).find(
    (value) => value.name === "ta_session",
  );
  check(
    "securePrivateSessionCookie",
    !!cookie?.secure && !!cookie.httpOnly && cookie.sameSite === "Lax",
  );
  const reloaded = await page.reload();
  assert.ok(reloaded);
  check(
    "freshRequestNonce",
    (await reloaded.allHeaders())["content-security-policy"]?.match(
      /'nonce-([^']+)'/,
    )?.[1] !== nonce,
  );
  const dev = await owner.context.request.post("/api/auth/dev", {
    headers: { Origin: origin },
    data: { username: "deployment_forbidden" },
  });
  check("developmentLogin404", dev.status() === 404);
  phase = "native login";
  const signedOut = await owner.context.request.post("/api/auth/logout", {
    headers: { Origin: origin },
    data: {},
  });
  check(
    "nativeLogout",
    signedOut.status() === 200 &&
      (await owner.context.request.get("/api/me")).status() === 401,
  );
  await page.goto(origin);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill(owner.username);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page
    .getByRole("button", { name: "Sign in to Tell Aviv", exact: true })
    .click();
  await page.getByRole("navigation", { name: "Main navigation" }).waitFor();
  check(
    "nativeLogin",
    (await owner.context.request.get("/api/me")).status() === 200,
  );
  phase = "Creator save";
  await page.goto(`${origin}/create`);
  await page.getByRole("button", { name: "+ New level", exact: true }).click();
  const title = `Deployment check ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Level title", { exact: true }).fill(title);
  await page
    .getByLabel("Description", { exact: true })
    .fill("Temporary deployment verification draft");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/creations") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const saveResponse = await saved;
  await page.getByText("Level saved", { exact: true }).waitFor();
  check(
    "creatorSave",
    saveResponse.status() === 200 &&
      (await page.getByLabel("Level title", { exact: true }).inputValue()) ===
        title,
  );
  phase = "private files";
  const classResponse = await owner.context.request.post("/api/classes", {
    headers: { Origin: origin },
    data: { name: "Temporary deployment verification" },
  });
  assert.equal(
    classResponse.status(),
    200,
    "Deployment private class creation failed",
  );
  const classId = (await classResponse.json()).data.id as string;
  const contents = `Private deployment fixture ${randomUUID()}`;
  const upload = await owner.context.request.post("/api/classes/files/upload", {
    headers: { Origin: origin },
    multipart: {
      classId,
      file: {
        name: "deployment-check.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(contents),
      },
    },
  });
  assert.equal(upload.status(), 201, "Deployment private file upload failed");
  const fileId = (await upload.json()).data.id as string;
  const filePath = `/api/classes/files/${fileId}`;
  const download = await owner.context.request.get(filePath);
  check(
    "privateFileOwnerDownload",
    download.status() === 200 &&
      (await download.text()) === contents &&
      download.headers()["cache-control"] === "private, no-store",
  );
  const outsider = await makeAccount();
  check(
    "privateFileAnonymousDenied",
    (await outsider.context.request.get(filePath)).status() === 401,
  );
  const registered = await outsider.context.request.post("/api/auth/register", {
    headers: { Origin: origin },
    data: {
      username: outsider.username,
      password: outsider.password,
      passwordConfirmation: outsider.password,
    },
  });
  assert.equal(
    registered.status(),
    200,
    "Deployment unrelated native account creation failed",
  );
  check(
    "privateFileUnrelatedUserDenied",
    (await outsider.context.request.get(filePath)).status() === 404,
  );
  phase = "authenticated WebSocket and Origin";
  const socket = await nativeSocket(owner.context, origin);
  await connected(socket);
  const listings = await ack(socket, "game:lobby:list", {
    gameId: "connect-four",
  });
  check(
    "authenticatedWebSocket",
    socket.io.engine.transport.name === "websocket" &&
      !listings.error &&
      Array.isArray(listings.data),
  );
  socket.disconnect();
  const rejected = await nativeSocket(
    owner.context,
    "https://blocked-origin.example.invalid",
  );
  const foreignOriginDenied = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 12000);
    rejected.once("connect", () => {
      clearTimeout(timeout);
      resolve(false);
    });
    rejected.once("connect_error", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
  rejected.disconnect();
  check("foreignWebSocketOriginDenied", foreignOriginDenied);
  phase = "Ego canvas and browser realtime";
  await page.goto(`${origin}/games/ego-trip/play`);
  await page
    .getByRole("button", { name: "Begin new run", exact: true })
    .click();
  await page.locator("canvas").first().waitFor();
  check("egoCanvas", await page.locator("canvas").first().isVisible());
  await page
    .getByRole("button", { name: "Private co-op", exact: true })
    .click();
  await page.getByText("Realtime connected", { exact: true }).waitFor();
  check("browserRealtimeUnderCsp", true);
  phase = "account security";
  await page.goto(`${origin}/settings`);
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Security", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Account Security", exact: true })
    .waitFor();
  check("nativeSecuritySettings", true);
  await page.waitForTimeout(200);
  check("noBrowserExecutionErrors", pageErrors.length === 0);
  check("noCspViolations", cspViolations.length === 0);
} catch {
  failure = phase;
} finally {
  for (const socket of sockets) socket.disconnect();
  for (const account of accounts.reverse()) {
    try {
      const me = await account.context.request.get("/api/me");
      if (me.status() === 401) continue;
      assert.equal(me.status(), 200, "Temporary account lookup failed");
      assert.equal(
        (await me.json()).data.username,
        account.username,
        "Refusing to clean up an unrelated account",
      );
      const proof = await account.context.request.post(
        "/api/auth/reauthenticate",
        {
          headers: { Origin: origin },
          data: { password: account.password },
        },
      );
      assert.equal(
        proof.status(),
        200,
        "Temporary account reauthentication failed",
      );
      const deleted = await account.context.request.post(
        "/api/account/delete",
        {
          headers: { Origin: origin },
          data: { confirmation: `DELETE ${account.username}` },
        },
      );
      assert.equal(deleted.status(), 200, "Temporary account deletion failed");
      assert.equal(
        (await account.context.request.get("/api/me")).status(),
        401,
        "Deleted account retained an authenticated session",
      );
    } catch {
      cleanupFailures.push("temporary native account cleanup failed");
    } finally {
      await account.context.close();
    }
  }
  await browser.close();
}
const report = {
  origin,
  time: new Date().toISOString(),
  localCertificateAuthority: localCA,
  checks,
  passed: Object.keys(checks).length,
  failure,
  cleanupVerified: cleanupFailures.length === 0,
  cleanupFailures,
  browserErrors: pageErrors.length,
  cspViolations,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (failure || cleanupFailures.length) process.exitCode = 1;
