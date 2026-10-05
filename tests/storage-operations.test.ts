import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getStorageProvider, storeFile } from "../packages/storage/src/index";
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
describe("bounded provider operations", () => {
  it("lists only app-owned regular objects with private metadata and paginates small local batches", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ta-storage-ops-"));
    directories.push(directory);
    vi.stubEnv("STORAGE_PROVIDER", "local");
    vi.stubEnv("STORAGE_LOCAL_PATH", directory);
    const keys = [
      await storeFile(new TextEncoder().encode("First")),
      await storeFile(new TextEncoder().encode("Second")),
    ];
    await writeFile(join(directory, "unknown.txt"), "Do not touch");
    const linked = randomUUID();
    await symlink(join(directory, keys[0]), join(directory, linked));
    const provider = getStorageProvider();
    expect(await provider.head(keys[0])).toMatchObject({
      key: keys[0],
      size: 5,
    });
    expect(await provider.head(randomUUID())).toBeNull();
    await expect(provider.head(linked)).rejects.toBeDefined();
    const found: string[] = [];
    let cursor: string | undefined;
    for (let n = 0; n < 10; n++) {
      const page = await provider.list({ limit: 1, cursor });
      found.push(...page.objects.map((object) => object.key));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(found.sort()).toEqual(keys.sort());
    expect(found).not.toContain(linked);
    expect(found).not.toContain("unknown.txt");
  });
  it("signs S3 HEAD and ListObjectsV2 requests, retains cursor encoding and ignores keys outside the app format", async () => {
    vi.stubEnv("STORAGE_PROVIDER", "s3");
    vi.stubEnv("S3_ENDPOINT", "https://objects.example.test/private");
    vi.stubEnv("S3_BUCKET", "tellaviv-private");
    vi.stubEnv("S3_ACCESS_KEY_ID", "test-access");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret");
    const key = randomUUID(),
      calls: { url: URL; method: string; headers: Record<string, string> }[] =
        [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL, init: RequestInit) => {
        const url = new URL(input);
        calls.push({
          url,
          method: init.method!,
          headers: init.headers as Record<string, string>,
        });
        if (init.method === "HEAD")
          return new Response(null, {
            headers: {
              "content-length": "10",
              "last-modified": "Fri, 02 Oct 2026 00:00:00 GMT",
            },
          });
        return new Response(
          `<ListBucketResult><Contents><Key>${key}</Key><Size>10</Size><LastModified>2026-10-02T00:00:00Z</LastModified></Contents><Contents><Key>other-user-unowned-file</Key><Size>1</Size><LastModified>2026-10-02T00:00:00Z</LastModified></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>page+2==</NextContinuationToken></ListBucketResult>`,
        );
      }),
    );
    const provider = getStorageProvider();
    expect(await provider.head(key)).toMatchObject({ size: 10 });
    const first = await provider.list({ limit: 10 });
    expect(first.objects.map((object) => object.key)).toEqual([key]);
    expect(first.nextCursor).toBe("page+2==");
    await provider.list({ limit: 10, cursor: first.nextCursor! });
    expect(calls[0].method).toBe("HEAD");
    expect(calls[1].url.searchParams.get("list-type")).toBe("2");
    expect(calls[2].url.search).toContain("continuation-token=page%2B2%3D%3D");
    expect(calls[1].headers.authorization).toMatch(/^AWS4-HMAC-SHA256/);
    expect(calls[2].headers.authorization).not.toBe(
      calls[1].headers.authorization,
    );
  });
  it("rejects hostile or oversized remote inventories instead of expanding XML entities", async () => {
    vi.stubEnv("STORAGE_PROVIDER", "s3");
    vi.stubEnv("S3_ENDPOINT", "https://objects.example.test");
    vi.stubEnv("S3_BUCKET", "tellaviv-private");
    vi.stubEnv("S3_ACCESS_KEY_ID", "test-access");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            '<!DOCTYPE a [<!ENTITY secret SYSTEM "file:///etc/passwd">]><ListBucketResult/>',
          ),
      ),
    );
    await expect(getStorageProvider().list()).rejects.toMatchObject({
      status: 503,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(2 * 1024 * 1024 + 1))),
    );
    await expect(getStorageProvider().list()).rejects.toMatchObject({
      status: 503,
    });
  });
});
