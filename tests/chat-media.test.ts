import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configuredGifProvider,
  searchGifs,
  validateEmojiImage,
} from "../packages/platform/src/chatMedia";
import { emojiPng } from "./emoji-fixture";

afterEach(() => vi.unstubAllGlobals());
describe("bounded chat media", () => {
  it("accepts a real tiny PNG and rejects mismatched, truncated and excessive dimensions", () => {
    const metadata = {
      name: "pink.png",
      type: "image/png",
      size: emojiPng.length,
    };
    expect(() => validateEmojiImage(metadata, emojiPng)).not.toThrow();
    expect(() =>
      validateEmojiImage({ ...metadata, name: "pink.jpg" }, emojiPng),
    ).toThrow();
    expect(() =>
      validateEmojiImage({ ...metadata, size: 8 }, emojiPng.subarray(0, 8)),
    ).toThrow();
    const huge = Buffer.from(emojiPng);
    huge.writeUInt32BE(100_000, 16);
    expect(() => validateEmojiImage(metadata, huge)).toThrow(/512/);
    const zero = Buffer.from(emojiPng);
    zero.writeUInt32BE(0, 20);
    expect(() => validateEmojiImage(metadata, zero)).toThrow(/dimensions/);
  });
  it("checks dimensions on GIF, lossless WebP and JPEG rather than signature alone", () => {
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    );
    const test = (name: string, type: string, bytes: Buffer) =>
      validateEmojiImage({ name, type, size: bytes.length }, bytes);
    expect(() => test("small.gif", "image/gif", gif)).not.toThrow();
    gif.writeUInt16LE(513, 6);
    expect(() => test("large.gif", "image/gif", gif)).toThrow(/512/);
    const webp = Buffer.alloc(25);
    webp.write("RIFF", 0);
    webp.write("WEBPVP8L", 8);
    webp[20] = 0x2f;
    expect(() => test("small.webp", "image/webp", webp)).not.toThrow();
    webp.writeUInt32LE(512, 21);
    expect(() => test("large.webp", "image/webp", webp)).toThrow(/512/);
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0, 7, 8, 0, 1, 0, 1, 0xff, 0xd9,
    ]);
    expect(() => test("small.jpg", "image/jpeg", jpeg)).not.toThrow();
    jpeg.writeUInt16BE(513, 9);
    expect(() => test("large.jpg", "image/jpeg", jpeg)).toThrow(/512/);
  });
  it("reports unavailable without a configured provider and never fetches placeholder results", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(configuredGifProvider({ GIF_PROVIDER: "giphy" })).toBeUndefined();
    expect(
      configuredGifProvider({
        GIF_PROVIDER: "unknown",
        GIPHY_API_KEY: "fixture",
      }),
    ).toBeUndefined();
    const result = await searchGifs(
      new URL("http://localhost/gifs?q=hello"),
      configuredGifProvider({}),
    );
    expect(result).toMatchObject({ configured: false, results: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requests only the configured provider with redirects disabled and excludes unsafe image URLs", async () => {
    const gif = (id: string, imageUrl: string) => ({
      id,
      title: "Greeting",
      url: "https://giphy.com/gifs/hello",
      images: { fixed_width: { url: imageUrl, width: "200", height: "150" } },
    });
    const fetcher = vi.fn(async () =>
      Response.json({
        data: [
          gif("valid", "https://media.giphy.com/hello.gif"),
          gif("private", "http://127.0.0.1/private.gif"),
          gif("lookalike", "https://giphy.com.evil.test/image.gif"),
          gif("credentials", "https://u:p@media.giphy.com/image.gif"),
        ],
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const provider = configuredGifProvider({
      GIF_PROVIDER: "giphy",
      GIPHY_API_KEY: "fixture-not-a-secret",
    })!;
    const result = await searchGifs(
      new URL("http://localhost/gifs?q=hello"),
      provider,
    );
    expect(result.results).toMatchObject([
      { id: "valid", width: 200, height: 150 },
    ]);
    expect(result.results).toHaveLength(1);
    const [url, options] = fetcher.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.origin).toBe("https://api.giphy.com");
    expect(url.searchParams.get("q")).toBe("hello");
    expect(options.redirect).toBe("error");
    await searchGifs(new URL("http://localhost/gifs"), provider);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      searchGifs(
        new URL("http://localhost/gifs?q=" + "a".repeat(121)),
        provider,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("bounds provider responses and reports provider failure without exposing its credential", async () => {
    const provider = configuredGifProvider({
      GIF_PROVIDER: "giphy",
      GIPHY_API_KEY: "fixture-not-a-secret",
    })!;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(512 * 1024 + 1))),
    );
    await expect(provider.search("hello")).rejects.toMatchObject({
      status: 503,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("private provider credential");
      }),
    );
    await expect(provider.search("hello")).rejects.toMatchObject({
      status: 503,
      message: "GIF search provider is temporarily unavailable",
    });
  });
});
