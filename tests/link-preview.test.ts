import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  fetchLinkMetadata,
  isPublicAddress,
  MAX_PREVIEW_BYTES,
  parsePreviewHtml,
  pinnedLookup,
  previewUrl,
  requestPinnedPreview,
  type PreviewTransport,
} from "../packages/platform/src/linkPreviewTransport";
import {
  firstPreviewLink,
  LinkPreviewService,
  handleLinkPreview,
} from "../packages/platform/src/linkPreview";
import { ApiError, type User } from "../packages/shared/src/index";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("node:https", () => ({ request: requestMock }));
const safe = { address: "93.184.216.34", family: 4 };
const result = {
  url: "https://public.org/article",
  site: "public.org",
  title: "Public title",
  description: "Description",
};
function adapter(html = "<title>Public title</title>"): PreviewTransport {
  return {
    resolve: vi.fn(async () => [safe]),
    request: vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: Buffer.from(html),
    })),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe("SSRF-resistant HTTPS link metadata", () => {
  it("denies literal IPs, credentials, unsupported ports/protocols and local/internal names before DNS", async () => {
    const transport = adapter();
    for (const url of [
      "http://public.org/",
      "file:///etc/passwd",
      "https://u:p@public.org/",
      "https://public.org:8443/",
      "https://127.0.0.1/",
      "https://2130706433/",
      "https://0177.0.0.1/",
      "https://0x7f000001/",
      "https://[::1]/",
      "https://public.org./",
      "https://localhost/",
      "https://api.internal/",
      "https://app.local/",
      "https://metadata.google.internal/",
      "https://public.org/a\\b",
      "https://public.org/\nsecret",
    ])
      await expect(fetchLinkMetadata(url, transport)).rejects.toThrow(
        /unavailable/,
      );
    expect(transport.resolve).not.toHaveBeenCalled();
    expect(transport.request).not.toHaveBeenCalled();
    expect(previewUrl("https://public.org:443/article#local").href).toBe(
      "https://public.org/article",
    );
  });
  it("rejects private, reserved, mapped and transition IPv4/IPv6 destinations", () => {
    for (const address of [
      "0.1.2.3",
      "10.1.2.3",
      "100.100.100.200",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.1.2",
      "192.168.1.1",
      "192.0.0.192",
      "192.0.2.1",
      "192.88.99.1",
      "198.19.1.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.1.1.1",
      "255.255.255.255",
      "168.63.129.16",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "fc00::1",
      "fd00:ec2::254",
      "fe80::1",
      "ff02::1",
      "64:ff9b::a00:1",
      "2001::1",
      "2001:db8::1",
      "2002:a00:1::",
      "3ffe::1",
      "3fff::1",
      "fe80::1%lo0",
    ])
      expect(isPublicAddress(address), address).toBe(false);
    for (const address of [
      "93.184.216.34",
      "8.8.8.8",
      "2001:4860:4860::8888",
      "2606:4700:4700::1111",
    ])
      expect(isPublicAddress(address), address).toBe(true);
  });
  it("rejects every mixed DNS answer, not only its first public record", async () => {
    for (const answer of [
      { address: "10.0.0.7", family: 4 },
      { address: "::1", family: 6 },
      { address: "fd00::7", family: 6 },
      { address: "93.184.216.34", family: 6 },
    ]) {
      const transport = adapter();
      transport.resolve = vi.fn(async () => [safe, answer]);
      await expect(
        fetchLinkMetadata("https://public.org", transport),
      ).rejects.toThrow(/unavailable/);
      expect(transport.request).not.toHaveBeenCalled();
    }
  });
  it("pins the resolved address and checks each redirect again, defeating DNS rebinding", async () => {
    const transport = adapter();
    const resolver = vi
      .fn()
      .mockResolvedValueOnce([safe])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    transport.resolve = resolver;
    transport.request = vi.fn(async (target) => {
      expect(target.address).toBe(safe.address);
      const callback = vi.fn();
      pinnedLookup(target)(target.url.hostname, { all: true }, callback);
      expect(callback).toHaveBeenCalledWith(null, [safe]);
      expect(resolver).toHaveBeenCalledTimes(1); // Lookup is pinned, never a second DNS lookup.
      return {
        status: 302,
        headers: { location: "/next" },
        body: Buffer.alloc(0),
      };
    });
    await expect(
      fetchLinkMetadata("https://public.org/article", transport),
    ).rejects.toThrow(/unavailable/);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(transport.request).toHaveBeenCalledTimes(1);
    for (const location of [
      "https://169.254.169.254/latest",
      "https://metadata.internal/",
      "http://public.org/",
    ]) {
      const redirected = adapter();
      redirected.request = vi.fn(async () => ({
        status: 302,
        headers: { location },
        body: Buffer.alloc(0),
      }));
      await expect(
        fetchLinkMetadata("https://public.org/", redirected),
      ).rejects.toThrow();
      expect(redirected.request).toHaveBeenCalledTimes(1);
    }
  });
  it("allows at most three public redirects and strips metadata markup without fetching images/scripts", async () => {
    const transport = adapter();
    transport.request = vi.fn(async () => ({
      status: 302,
      headers: { location: "/loop" },
      body: Buffer.alloc(0),
    }));
    await expect(
      fetchLinkMetadata("https://public.org/", transport),
    ).rejects.toThrow();
    expect(transport.request).toHaveBeenCalledTimes(4);
    const parsed = parsePreviewHtml(
      `<head><script><title>script injection</title></script><title>Fallback</title><meta property='og:title' content='Hello &amp; &lt;b&gt;world&lt;/b&gt;'><meta name='description' content='${"x".repeat(400)}'><meta property='og:image' content='http://127.0.0.1/secret'></head><title>body title</title>`,
      new URL("https://public.org/article"),
    );
    expect(parsed).toEqual({
      url: "https://public.org/article",
      site: "public.org",
      title: "Hello & world",
      description: "x".repeat(320),
    });
    expect(Object.keys(parsed)).toEqual([
      "url",
      "site",
      "title",
      "description",
    ]);
  });
  it("rejects excessive, compressed, truncated, wrong-type and malformed UTF-8 bodies", async () => {
    for (const response of [
      {
        body: Buffer.alloc(MAX_PREVIEW_BYTES + 1),
        headers: { "content-type": "text/html" },
      },
      {
        body: Buffer.from("small"),
        headers: { "content-type": "text/html", "content-encoding": "gzip" },
      },
      {
        body: Buffer.from("truncated"),
        headers: { "content-type": "text/html", "content-length": "100" },
      },
      {
        body: Buffer.from("data"),
        headers: { "content-type": "application/json" },
      },
      { body: Buffer.from([0xff]), headers: { "content-type": "text/html" } },
    ]) {
      const transport = adapter();
      transport.request = vi.fn(async () => ({ status: 200, ...response }));
      await expect(
        fetchLinkMetadata("https://public.org/", transport),
      ).rejects.toThrow();
    }
  });
  it("applies one four-second deadline including stalled DNS and response streams", async () => {
    vi.useFakeTimers();
    for (const stalled of ["resolve", "request"] as const) {
      const transport = adapter();
      if (stalled === "resolve")
        transport.resolve = vi.fn(() => new Promise<never>(() => undefined));
      else transport.request = vi.fn(() => new Promise<never>(() => undefined));
      const pending = fetchLinkMetadata("https://public.org/", transport);
      const rejection = expect(pending).rejects.toThrow(/unavailable/);
      await vi.advanceTimersByTimeAsync(4001);
      await rejection;
      if (stalled === "resolve")
        expect(transport.request).not.toHaveBeenCalled();
    }
  });
  it("production HTTPS adapter preserves TLS hostname, sends no cookies/referrer and cancels oversized streams", async () => {
    let options: Record<string, unknown> = {};
    requestMock.mockImplementation((_url, providedOptions, callback) => {
      options = providedOptions;
      const request = new EventEmitter() as EventEmitter & {
        end: () => void;
        destroy: (error: Error) => void;
      };
      request.destroy = (error) => {
        queueMicrotask(() => request.emit("error", error));
      };
      request.end = () =>
        queueMicrotask(() => {
          const response = new PassThrough() as PassThrough & {
            headers: Record<string, string | undefined>;
            statusCode: number;
            complete: boolean;
          };
          response.headers = { "content-type": "text/html" };
          response.statusCode = 200;
          response.complete = true;
          callback(response);
          response.end(Buffer.alloc(MAX_PREVIEW_BYTES + 1));
        });
      return request;
    });
    await expect(
      requestPinnedPreview(
        { url: new URL("https://public.org/article"), ...safe, family: 4 },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/unavailable/);
    expect(options).toMatchObject({
      servername: "public.org",
      rejectUnauthorized: true,
      agent: false,
      maxHeaderSize: 8192,
    });
    expect(options.headers).toEqual({
      Accept: "text/html",
      "Accept-Encoding": "identity",
      "User-Agent": "TellAviv-LinkPreview/1.0",
    });
    const callback = vi.fn();
    (options.lookup as ReturnType<typeof pinnedLookup>)(
      "public.org",
      { all: false },
      callback,
    );
    expect(callback).toHaveBeenCalledWith(null, safe.address, 4);
  });
  it("production adapter refuses a truncated native response even without a content-length header", async () => {
    requestMock.mockImplementation((_url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & {
        end: () => void;
        destroy: (error: Error) => void;
      };
      request.destroy = (error) => {
        queueMicrotask(() => request.emit("error", error));
      };
      request.end = () =>
        queueMicrotask(() => {
          const response = new PassThrough() as PassThrough & {
            headers: Record<string, string>;
            statusCode: number;
            complete: boolean;
          };
          response.headers = { "content-type": "text/html" };
          response.statusCode = 200;
          response.complete = false;
          callback(response);
          response.end("<title>Incomplete");
        });
      return request;
    });
    await expect(
      requestPinnedPreview(
        { url: new URL("https://public.org/article"), ...safe, family: 4 },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/unavailable/);
  });
  it.each([
    { "content-encoding": "gzip" },
    { "content-length": String(MAX_PREVIEW_BYTES + 1) },
    { "content-length": "not-a-length" },
  ])(
    "production adapter rejects unsafe response headers without an unhandled stream error: %j",
    async (headers) => {
      requestMock.mockImplementation((_url, _options, callback) => {
        const request = new EventEmitter() as EventEmitter & {
          end: () => void;
          destroy: (error: Error) => void;
        };
        request.destroy = (error) => {
          queueMicrotask(() => request.emit("error", error));
        };
        request.end = () =>
          queueMicrotask(() => {
            const response = new PassThrough() as PassThrough & {
              headers: Record<string, string | undefined>;
              statusCode: number;
              complete: boolean;
            };
            response.headers = { "content-type": "text/html", ...headers };
            response.statusCode = 200;
            response.complete = false;
            callback(response);
          });
        return request;
      });
      await expect(
        requestPinnedPreview(
          { url: new URL("https://public.org/article"), ...safe, family: 4 },
          new AbortController().signal,
        ),
      ).rejects.toThrow(/unavailable/);
    },
  );
});

describe("private message authorization, cache and request budgets", () => {
  it("checks membership before budget/network and rechecks after fetch or cache hits", async () => {
    const fetcher = vi.fn(async () => result),
      budget = vi.fn(async () => undefined);
    const service = new LinkPreviewService(fetcher, budget);
    const readMessage = vi.fn(async (): Promise<string> => {
      throw new ApiError(403, "Membership required");
    });
    await expect(
      service.preview("u", "r", "m", { readMessage }),
    ).rejects.toMatchObject({ status: 403 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(budget).not.toHaveBeenCalled();
    readMessage.mockImplementation(async () => "https://public.org/article");
    await service.preview("u", "r", "m", { readMessage });
    await service.preview("u", "r", "m", { readMessage });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(readMessage).toHaveBeenCalledTimes(5);
    readMessage.mockRejectedValueOnce(new ApiError(403, "Membership revoked"));
    await expect(
      service.preview("u", "r", "m", { readMessage }),
    ).rejects.toMatchObject({ status: 403 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not return or cache metadata after a membership revoke, message delete/edit or rate rejection", async () => {
    const fetcher = vi.fn(async () => result),
      budget = vi.fn(async () => undefined);
    const service = new LinkPreviewService(fetcher, budget);
    const readMessage = vi
      .fn()
      .mockResolvedValueOnce("https://public.org/article")
      .mockRejectedValueOnce(new ApiError(403, "Revoked"));
    await expect(
      service.preview("u", "r", "m", { readMessage }),
    ).rejects.toMatchObject({ status: 403 });
    readMessage.mockResolvedValue("https://public.org/article");
    await service.preview("u", "r", "m", { readMessage });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const edited = vi
      .fn()
      .mockResolvedValueOnce("https://public.org/article")
      .mockResolvedValueOnce("changed");
    await expect(
      service.preview("u", "r", "other", { readMessage: edited }),
    ).rejects.toMatchObject({ status: 409 });
    budget.mockRejectedValueOnce(new ApiError(429, "Limited"));
    await expect(
      service.preview("u", "r", "m", { readMessage }),
    ).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("isolates users/rooms/messages/content, expires metadata and caps its LRU at 256 entries", async () => {
    let now = 1000;
    const fetcher = vi.fn(async () => result),
      readMessage = vi.fn(async () => "https://public.org/article");
    const service = new LinkPreviewService(
      fetcher,
      async () => undefined,
      () => now,
    );
    for (const [u, r, m] of [
      ["a", "r", "m"],
      ["b", "r", "m"],
      ["a", "other", "m"],
      ["a", "r", "other"],
    ])
      await service.preview(u, r, m, { readMessage });
    expect(fetcher).toHaveBeenCalledTimes(4);
    now += 300001;
    await service.preview("a", "r", "m", { readMessage });
    expect(fetcher).toHaveBeenCalledTimes(5);
    for (let i = 0; i < 256; i++)
      await service.preview("a", "r", "m" + i, { readMessage });
    await service.preview("a", "r", "m", { readMessage });
    expect(fetcher).toHaveBeenCalledTimes(262);
    readMessage.mockResolvedValue("https://public.org/changed");
    await service.preview("a", "r", "m", { readMessage });
    expect(fetcher).toHaveBeenCalledTimes(263);
  });
  it("accepts only room/message IDs, sends generic network failures and never fetches plaintext", async () => {
    const user = { id: "u" } as User;
    await expect(
      handleLinkPreview(
        ["chat", "link-preview"],
        "POST",
        user,
        { roomId: "r", messageId: "m", url: "https://evil.org" },
        { readMessage: vi.fn() },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      firstPreviewLink(
        "read https://public.org/article). then https://other.org",
      ),
    ).toBe("https://public.org/article");
    const fetcher = vi.fn(async () => {
      throw new Error("private DNS answer SECRET_PROVIDER_KEY");
    });
    const service = new LinkPreviewService(fetcher, async () => undefined);
    expect(
      await service.preview("u", "r", "m", {
        readMessage: async () => "plain text",
      }),
    ).toEqual({ preview: null });
    expect(fetcher).not.toHaveBeenCalled();
    const unavailable = await service.preview("u", "r", "m", {
      readMessage: async () => "https://public.org/article",
    });
    expect(unavailable).toEqual({
      preview: null,
      message: "This link has no available preview.",
    });
    expect(JSON.stringify(unavailable)).not.toContain("SECRET_PROVIDER_KEY");
  });
});
