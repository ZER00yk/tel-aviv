import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  readFile as readLocalFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  deleteFile,
  getStorageProvider,
  MAX_FILE_BYTES,
  readFile,
  storeFile,
  validateFile,
} from "../packages/storage/src/index";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function localDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "tell-aviv-storage-"));
  temporaryDirectories.push(directory);
  vi.stubEnv("STORAGE_PROVIDER", "local");
  vi.stubEnv("STORAGE_LOCAL_PATH", directory);
  return directory;
}

function officeDirectory(names: string[]) {
  const local = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const entries = names.map((name) => {
    const filename = Buffer.from(name);
    const entry = Buffer.alloc(46 + filename.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(filename.length, 28);
    filename.copy(entry, 46);
    return entry;
  });
  const directory = Buffer.concat(entries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, directory, end]);
}

describe("upload validation", () => {
  it("checks audio/video container signatures before accepting media uploads", () => {
    const fixtures = [
      {
        name: "voice.wav",
        type: "audio/wav",
        bytes: Buffer.from("RIFF0000WAVEpayload"),
      },
      { name: "voice.mp3", type: "audio/mpeg", bytes: Buffer.from("ID3audio") },
      {
        name: "voice.webm",
        type: "audio/webm",
        bytes: Buffer.concat([
          Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
          Buffer.from("webm"),
        ]),
      },
      {
        name: "clip.mp4",
        type: "video/mp4",
        bytes: Buffer.concat([
          Buffer.from([0, 0, 0, 24]),
          Buffer.from("ftypisom00000000"),
        ]),
      },
    ];
    for (const fixture of fixtures) {
      expect(() =>
        validateFile(
          {
            name: fixture.name,
            type: fixture.type,
            size: fixture.bytes.length,
          },
          fixture.bytes,
        ),
      ).not.toThrow();
      const forged = Buffer.from("not media");
      expect(() =>
        validateFile(
          { name: fixture.name, type: fixture.type, size: forged.length },
          forged,
        ),
      ).toThrow();
    }
  });
  it("accepts supported signatures and UTF-8 documents", () => {
    const bytes = Buffer.from("Hello תלמידים\n");
    expect(() =>
      validateFile(
        { name: "notes.txt", type: "text/plain", size: bytes.length },
        bytes,
      ),
    ).not.toThrow();
    const pdf = Buffer.from("%PDF-1.7\n");
    expect(() =>
      validateFile(
        { name: "homework.PDF", type: "application/pdf", size: pdf.length },
        pdf,
      ),
    ).not.toThrow();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() =>
      validateFile(
        { name: "picture.png", type: "image/png", size: png.length },
        png,
      ),
    ).not.toThrow();
  });
  it("rejects executable formats, mismatched MIME, bad sizes, and forged bytes", () => {
    for (const name of [
      "script.html",
      "image.svg",
      "program.exe",
      "../notes.txt",
      "folder\\notes.txt",
    ]) {
      expect(() =>
        validateFile({ name, type: "text/plain", size: 5 }),
      ).toThrow();
    }
    expect(() =>
      validateFile({ name: "image.png", type: "text/plain", size: 5 }),
    ).toThrow();
    expect(() =>
      validateFile({ name: "notes.txt", type: "text/plain", size: 0 }),
    ).toThrow();
    expect(() =>
      validateFile({
        name: "notes.txt",
        type: "text/plain",
        size: MAX_FILE_BYTES + 1,
      }),
    ).toThrow();
    expect(() =>
      validateFile({ name: "notes.txt", type: "text/plain", size: 0.5 }),
    ).toThrow();
    expect(() =>
      validateFile(
        { name: "image.png", type: "image/png", size: 5 },
        Buffer.from("hello"),
      ),
    ).toThrow();
    expect(() =>
      validateFile(
        { name: "notes.txt", type: "text/plain", size: 2 },
        Buffer.from([0, 255]),
      ),
    ).toThrow();
    expect(() =>
      validateFile(
        { name: "notes.txt", type: "text/plain", size: 3 },
        Buffer.from("hi"),
      ),
    ).toThrow();
  });
  it("requires the correct Office package entries and rejects macros or path traversal", () => {
    const metadata = {
      name: "notes.docx",
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    for (const names of [
      ["[Content_Types].xml", "word/document.xml"],
      ["[Content_Types].xml", "xl/workbook.xml"],
      ["[Content_Types].xml", "word/document.xml", "word/vbaProject.bin"],
      ["[Content_Types].xml", "word/document.xml", "../script.exe"],
    ]) {
      const bytes = officeDirectory(names);
      if (names.length === 2 && names[1] === "word/document.xml") {
        expect(() =>
          validateFile({ ...metadata, size: bytes.length }, bytes),
        ).not.toThrow();
      } else
        expect(() =>
          validateFile({ ...metadata, size: bytes.length }, bytes),
        ).toThrow();
    }
    expect(() =>
      validateFile({ ...metadata, size: 4 }, Buffer.from("PK\x03\x04")),
    ).toThrow();
  });
});

describe("private local file storage", () => {
  it("stores opaque keys with private permissions and supports read/delete", async () => {
    const directory = await localDirectory();
    const bytes = Buffer.from("Private class notes");
    const key = await storeFile(bytes);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect((await stat(join(directory, key))).mode & 0o777).toBe(0o600);
    expect(Buffer.from(await readFile(key))).toEqual(bytes);
    await deleteFile(key);
    await expect(readFile(key)).rejects.toMatchObject({ status: 404 });
    await expect(deleteFile(key)).resolves.toBeUndefined();
  });
  it("rejects unsafe keys, checkout directories, and symlink reads", async () => {
    const directory = await localDirectory();
    for (const key of ["../secret", "/etc/passwd", "public/name.png", ""]) {
      await expect(readFile(key)).rejects.toMatchObject({ status: 400 });
      await expect(deleteFile(key)).rejects.toMatchObject({ status: 400 });
    }
    const secret = join(directory, "secret.txt");
    await writeFile(secret, "private");
    const key = randomUUID();
    await symlink(secret, join(directory, key));
    await expect(readFile(key)).rejects.toMatchObject({ status: 503 });
    await deleteFile(key);
    expect(await readLocalFile(secret, "utf8")).toBe("private");
    vi.stubEnv("STORAGE_LOCAL_PATH", process.cwd());
    expect(() => getStorageProvider()).toThrow(
      "outside the application checkout",
    );
  });
});

describe("S3-compatible private storage", () => {
  function configure() {
    vi.stubEnv("STORAGE_PROVIDER", "s3");
    vi.stubEnv("S3_ENDPOINT", "https://objects.example.test");
    vi.stubEnv("S3_BUCKET", "school-private");
    vi.stubEnv("S3_REGION", "us-east-1");
    vi.stubEnv("S3_ACCESS_KEY_ID", "test-access");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret");
  }
  it("signs HTTPS requests and returns only generated object keys", async () => {
    configure();
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    const bytes = Buffer.from("private");
    const key = await storeFile(bytes);
    const [url, options] = mockFetch.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(`https://objects.example.test/school-private/${key}`);
    const headers = options.headers as Record<string, string>;
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=test-access\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=/,
    );
    expect(headers["x-amz-content-sha256"]).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(headers["x-amz-acl"]).toBeUndefined();
    expect(options.redirect).toBe("error");
  });
  it("rejects insecure endpoints and redacts upstream errors", async () => {
    configure();
    vi.stubEnv("S3_ENDPOINT", "http://objects.example.test");
    expect(() => getStorageProvider()).toThrow("HTTPS");
    vi.stubEnv("S3_ENDPOINT", "https://objects.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("test-secret", { status: 403 })),
    );
    await expect(storeFile(Buffer.from("private"))).rejects.toMatchObject({
      status: 503,
      message: "Private object storage rejected the request",
    });
  });
});
