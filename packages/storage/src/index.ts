import { constants, existsSync, realpathSync } from "node:fs";
import { mkdir, open, opendir, unlink } from "node:fs/promises";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { dirname, resolve, sep, join } from "node:path";
import { ApiError } from "@tell-aviv/shared";

const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const configuredLimit = Number(
  process.env.MAX_FILE_BYTES ??
    process.env.MAX_UPLOAD_BYTES ??
    DEFAULT_MAX_FILE_BYTES,
);
export const MAX_FILE_BYTES =
  Number.isSafeInteger(configuredLimit) && configuredLimit > 0
    ? configuredLimit
    : DEFAULT_MAX_FILE_BYTES;

export interface FileMetadata {
  name: string;
  type: string;
  size: number;
}
export interface StorageProvider {
  put(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<StorageObject | null>;
  list(options?: { cursor?: string; limit?: number }): Promise<StoragePage>;
}
export interface StorageObject {
  key: string;
  size: number;
  modifiedAt: string;
}
export interface StoragePage {
  objects: StorageObject[];
  nextCursor: string | null;
}

const fileTypes: Record<string, readonly string[]> = {
  pdf: ["application/pdf"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  csv: ["text/csv", "application/csv"],
  txt: ["text/plain"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  gif: ["image/gif"],
  mp3: ["audio/mpeg"],
  wav: ["audio/wav", "audio/x-wav"],
  webm: ["audio/webm", "video/webm"],
  m4a: ["audio/mp4"],
  mp4: ["video/mp4", "audio/mp4"],
};

function startsWith(bytes: Uint8Array, values: readonly number[]) {
  return (
    bytes.length >= values.length &&
    values.every((value, index) => bytes[index] === value)
  );
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return Buffer.from(bytes.subarray(start, start + length)).toString("ascii");
}

// Inspect the ZIP directory instead of accepting any ZIP renamed to an Office document.
function hasOfficeEntries(bytes: Uint8Array, extension: string) {
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return false;
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let directoryEnd = -1;
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset--) {
    if (
      data.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + data.readUInt16LE(offset + 20) === bytes.length
    ) {
      directoryEnd = offset;
      break;
    }
  }
  if (
    directoryEnd < 0 ||
    data.readUInt16LE(directoryEnd + 4) !== 0 ||
    data.readUInt16LE(directoryEnd + 6) !== 0
  )
    return false;
  const entryCount = data.readUInt16LE(directoryEnd + 10);
  const directorySize = data.readUInt32LE(directoryEnd + 12);
  let cursor = data.readUInt32LE(directoryEnd + 16);
  const directoryStart = cursor;
  if (entryCount === 0 || cursor + directorySize !== directoryEnd) return false;
  const officeDocuments: Record<string, string> = {
    docx: "word/document.xml",
    pptx: "ppt/presentation.xml",
    xlsx: "xl/workbook.xml",
  };
  const expectedDocument = officeDocuments[extension];
  let contentTypes = false;
  let document = false;
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > directoryEnd || data.readUInt32LE(cursor) !== 0x02014b50)
      return false;
    const filenameSize = data.readUInt16LE(cursor + 28);
    const extraSize = data.readUInt16LE(cursor + 30);
    const commentSize = data.readUInt16LE(cursor + 32);
    const next = cursor + 46 + filenameSize + extraSize + commentSize;
    if (next > directoryEnd || (data.readUInt16LE(cursor + 8) & 1) !== 0)
      return false;
    const name = data
      .subarray(cursor + 46, cursor + 46 + filenameSize)
      .toString("utf8");
    if (
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..") ||
      /vbaProject\.bin$/i.test(name)
    )
      return false;
    contentTypes ||= name === "[Content_Types].xml";
    document ||= name === expectedDocument;
    cursor = next;
  }
  return contentTypes && document && cursor - directoryStart === directorySize;
}

function matchesSignature(extension: string, bytes: Uint8Array) {
  switch (extension) {
    case "pdf":
      return ascii(bytes, 0, 5) === "%PDF-";
    case "png":
      return startsWith(
        bytes,
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      );
    case "jpg":
    case "jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "gif":
      return ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6));
    case "webp":
      return (
        bytes.length >= 12 &&
        ascii(bytes, 0, 4) === "RIFF" &&
        ascii(bytes, 8, 4) === "WEBP"
      );
    case "wav":
      return (
        bytes.length >= 12 &&
        ascii(bytes, 0, 4) === "RIFF" &&
        ascii(bytes, 8, 4) === "WAVE"
      );
    case "mp3":
      return (
        bytes.length >= 4 &&
        (ascii(bytes, 0, 3) === "ID3" ||
          (bytes[0] === 0xff &&
            (bytes[1] & 0xe0) === 0xe0 &&
            (bytes[1] & 0x18) !== 0x08 &&
            (bytes[1] & 0x06) !== 0 &&
            (bytes[2] & 0xf0) !== 0xf0))
      );
    case "webm":
      return (
        startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]) &&
        Buffer.from(bytes.subarray(0, 4096)).includes(Buffer.from("webm"))
      );
    case "m4a":
    case "mp4":
      return (
        bytes.length >= 16 &&
        ascii(bytes, 4, 4) === "ftyp" &&
        ["isom", "iso2", "mp41", "mp42", "M4A ", "M4V ", "qt  "].includes(
          ascii(bytes, 8, 4),
        )
      );
    case "docx":
    case "pptx":
    case "xlsx":
      return hasOfficeEntries(bytes, extension);
    case "csv":
    case "txt": {
      try {
        const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(decoded);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/** Validate metadata and, when provided, content before storing a private upload. */
export function validateFile(file: FileMetadata, bytes?: Uint8Array): void {
  if (
    !file ||
    typeof file.name !== "string" ||
    file.name.length === 0 ||
    file.name.length > 255 ||
    /[/\\\u0000-\u001f\u007f]/.test(file.name)
  ) {
    throw new ApiError(400, "Invalid filename");
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime =
    typeof file.type === "string"
      ? file.type.toLowerCase().trim().split(";")[0].trim()
      : "";
  if (
    !file.name.includes(".") ||
    !Object.hasOwn(fileTypes, extension) ||
    !fileTypes[extension].includes(mime)
  ) {
    throw new ApiError(
      415,
      "File extension and MIME type must match a supported format",
    );
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0)
    throw new ApiError(400, "File must not be empty");
  if (file.size > MAX_FILE_BYTES)
    throw new ApiError(
      413,
      `File exceeds the ${MAX_FILE_BYTES} byte upload limit`,
    );
  if (
    bytes &&
    (bytes.byteLength !== file.size || !matchesSignature(extension, bytes))
  ) {
    throw new ApiError(415, "File contents do not match the declared format");
  }
}

const safeKeyPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function assertSafeKey(key: string) {
  if (typeof key !== "string" || !safeKeyPattern.test(key))
    throw new ApiError(400, "Invalid storage key");
}
export function storageKeyIsValid(key: string) {
  return safeKeyPattern.test(key);
}
function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

class LocalStorageProvider implements StorageProvider {
  private root: string;
  private checkout: string;
  constructor() {
    this.root = resolve(
      process.env.STORAGE_LOCAL_PATH || "/workspace/tell-aviv-data/uploads",
    );
    let checkout = resolve(process.env.APP_ROOT || process.cwd());
    if (!process.env.APP_ROOT) {
      while (
        dirname(checkout) !== checkout &&
        !existsSync(join(checkout, "pnpm-workspace.yaml"))
      )
        checkout = dirname(checkout);
      if (dirname(checkout) === checkout) checkout = resolve(process.cwd());
    }
    this.checkout = realpathSync(checkout);
    if (this.root === checkout || this.root.startsWith(`${checkout}${sep}`)) {
      throw new ApiError(
        503,
        "Upload storage must be outside the application checkout",
      );
    }
  }
  private path(key: string) {
    assertSafeKey(key);
    return resolve(this.root, key);
  }
  async put(key: string, bytes: Uint8Array) {
    const path = this.path(key);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const actualRoot = realpathSync(this.root);
    if (
      actualRoot === this.checkout ||
      actualRoot.startsWith(`${this.checkout}${sep}`)
    )
      throw new ApiError(
        503,
        "Upload storage must be outside the application checkout",
      );
    const file = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(bytes);
    } catch (error) {
      await file.close();
      await unlink(path).catch(() => undefined);
      throw error;
    }
    await file.close();
  }
  async read(key: string) {
    let file;
    try {
      file = await open(
        this.path(key),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      if (isMissing(error)) throw new ApiError(404, "File not found");
      throw error;
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new ApiError(404, "File not found");
      return new Uint8Array(await file.readFile());
    } finally {
      await file.close();
    }
  }
  async delete(key: string) {
    try {
      await unlink(this.path(key));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  async head(key: string): Promise<StorageObject | null> {
    let file;
    try {
      file = await open(
        this.path(key),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    try {
      const info = await file.stat();
      if (!info.isFile())
        throw new ApiError(503, "Storage object is not a regular file");
      return { key, size: info.size, modifiedAt: info.mtime.toISOString() };
    } finally {
      await file.close();
    }
  }
  async list(
    options: { cursor?: string; limit?: number } = {},
  ): Promise<StoragePage> {
    const offset = options.cursor === undefined ? 0 : Number(options.cursor);
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new ApiError(400, "Invalid storage cursor");
    const limit = Math.max(1, Math.min(1000, Math.trunc(options.limit ?? 200)));
    if (!Number.isFinite(limit))
      throw new ApiError(400, "Invalid storage batch size");
    let directory;
    try {
      const actualRoot = realpathSync(this.root);
      if (
        actualRoot === this.checkout ||
        actualRoot.startsWith(`${this.checkout}${sep}`)
      )
        throw new ApiError(
          503,
          "Upload storage must be outside the application checkout",
        );
      directory = await opendir(this.root);
    } catch (error) {
      if (isMissing(error)) return { objects: [], nextCursor: null };
      throw error;
    }
    const objects: StorageObject[] = [];
    let index = 0,
      read = 0,
      ended = false;
    try {
      while (index < offset) {
        if (!(await directory.read())) {
          ended = true;
          break;
        }
        index++;
      }
      while (!ended && read < limit) {
        const entry = await directory.read();
        if (!entry) {
          ended = true;
          break;
        }
        read++;
        index++;
        if (!entry.isFile() || !storageKeyIsValid(entry.name)) continue;
        const object = await this.head(entry.name);
        if (object) objects.push(object);
      }
      if (!ended && !(await directory.read())) ended = true;
      return { objects, nextCursor: ended ? null : String(index) };
    } finally {
      await directory.close();
    }
  }
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
function hmac(key: string | Uint8Array, value: string) {
  return createHmac("sha256", key).update(value).digest();
}
function awsEncode(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

class S3StorageProvider implements StorageProvider {
  private endpoint: URL;
  private bucket: string;
  private region: string;
  private accessKey: string;
  private secretKey: string;
  private sessionToken: string | undefined;
  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    this.bucket = process.env.S3_BUCKET ?? "";
    this.region = process.env.S3_REGION || "us-east-1";
    this.accessKey =
      process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "";
    this.secretKey =
      process.env.S3_SECRET_ACCESS_KEY ||
      process.env.AWS_SECRET_ACCESS_KEY ||
      "";
    this.sessionToken =
      process.env.S3_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN;
    if (!endpoint || !this.bucket || !this.accessKey || !this.secretKey)
      throw new ApiError(503, "S3 storage is not configured");
    try {
      this.endpoint = new URL(endpoint);
    } catch {
      throw new ApiError(503, "S3 endpoint is invalid");
    }
    if (
      this.endpoint.protocol !== "https:" ||
      this.endpoint.username ||
      this.endpoint.password ||
      this.endpoint.search ||
      this.endpoint.hash
    ) {
      throw new ApiError(
        503,
        "S3 endpoint must be an HTTPS URL without embedded credentials or query parameters",
      );
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(this.bucket))
      throw new ApiError(503, "S3 bucket is invalid");
  }
  private async request(
    method: "PUT" | "GET" | "DELETE" | "HEAD",
    key: string | null,
    bytes?: Uint8Array,
    query: Record<string, string> = {},
  ) {
    if (key !== null) assertSafeKey(key);
    const url = new URL(this.endpoint);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${awsEncode(this.bucket)}${key === null ? "" : `/${key}`}`;
    const canonicalQuery = Object.entries(query)
      .map(([name, value]) => [awsEncode(name), awsEncode(value)])
      .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
      .map(([name, value]) => `${name}=${value}`)
      .join("&");
    url.search = canonicalQuery;
    const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = timestamp.slice(0, 8);
    const payloadHash = sha256(bytes ?? new Uint8Array());
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": timestamp,
    };
    if (this.sessionToken) headers["x-amz-security-token"] = this.sessionToken;
    if (method === "PUT") headers["content-type"] = "application/octet-stream";
    const headerNames = Object.keys(headers).sort();
    const signedHeaders = headerNames.join(";");
    const canonicalHeaders = headerNames
      .map((name) => `${name}:${headers[name].trim()}\n`)
      .join("");
    const canonicalUri = url.pathname
      .split("/")
      .map((segment) => awsEncode(decodeURIComponent(segment)))
      .join("/");
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const scope = `${date}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      timestamp,
      scope,
      sha256(canonicalRequest),
    ].join("\n");
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${this.secretKey}`, date), this.region), "s3"),
      "aws4_request",
    );
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(signingKey, stringToSign).toString("hex")}`;
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: bytes ? new Uint8Array(bytes).buffer : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
    } catch {
      throw new ApiError(503, "Private object storage is unavailable");
    }
    if ((method === "GET" || method === "HEAD") && response.status === 404)
      throw new ApiError(404, "File not found");
    if (!response.ok && !(method === "DELETE" && response.status === 404)) {
      await response.body?.cancel();
      throw new ApiError(503, "Private object storage rejected the request");
    }
    return response;
  }
  async put(key: string, bytes: Uint8Array) {
    const response = await this.request("PUT", key, bytes);
    await response.body?.cancel();
  }
  async read(key: string) {
    return new Uint8Array(await (await this.request("GET", key)).arrayBuffer());
  }
  async delete(key: string) {
    const response = await this.request("DELETE", key);
    await response.body?.cancel();
  }
  async head(key: string): Promise<StorageObject | null> {
    try {
      const response = await this.request("HEAD", key);
      const size = Number(response.headers.get("content-length"));
      const modifiedAt = new Date(response.headers.get("last-modified") ?? "");
      await response.body?.cancel();
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        !Number.isFinite(modifiedAt.getTime())
      )
        throw new ApiError(503, "Object storage returned invalid metadata");
      return { key, size, modifiedAt: modifiedAt.toISOString() };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }
  async list(
    options: { cursor?: string; limit?: number } = {},
  ): Promise<StoragePage> {
    if (options.cursor && options.cursor.length > 2048)
      throw new ApiError(400, "Invalid storage cursor");
    const limit = Math.max(1, Math.min(1000, Math.trunc(options.limit ?? 200)));
    if (!Number.isFinite(limit))
      throw new ApiError(400, "Invalid storage batch size");
    const response = await this.request("GET", null, undefined, {
      "list-type": "2",
      "max-keys": String(limit),
      ...(options.cursor ? { "continuation-token": options.cursor } : {}),
    });
    const reader = response.body?.getReader();
    if (!reader)
      throw new ApiError(503, "Object storage returned an empty inventory");
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new ApiError(503, "Object storage inventory exceeds its limit");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const xml = Buffer.concat(chunks).toString("utf8");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new ApiError(503, "Object storage inventory is invalid");
    const decode = (text: string) =>
      text.replace(
        /&(?:amp|lt|gt|quot|apos);/g,
        (entity) =>
          ({
            "&amp;": "&",
            "&lt;": "<",
            "&gt;": ">",
            "&quot;": '"',
            "&apos;": "'",
          })[entity] ?? entity,
      );
    const tag = (source: string, name: string) =>
      decode(
        source.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1] ??
          "",
      );
    const objects: StorageObject[] = [];
    for (const block of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = tag(block[1], "Key");
      if (!storageKeyIsValid(key)) continue;
      const size = Number(tag(block[1], "Size")),
        date = new Date(tag(block[1], "LastModified"));
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        !Number.isFinite(date.getTime())
      )
        throw new ApiError(503, "Object storage inventory is invalid");
      objects.push({ key, size, modifiedAt: date.toISOString() });
      if (objects.length > limit)
        throw new ApiError(
          503,
          "Object storage inventory exceeds its requested limit",
        );
    }
    const nextCursor = tag(xml, "NextContinuationToken") || null;
    if (nextCursor && nextCursor.length > 2048)
      throw new ApiError(503, "Object storage cursor is invalid");
    if (tag(xml, "IsTruncated") === "true" && !nextCursor)
      throw new ApiError(503, "Object storage inventory omitted its cursor");
    return { objects, nextCursor };
  }
}

export function getStorageProvider(): StorageProvider {
  const provider = process.env.STORAGE_PROVIDER || "local";
  if (provider === "s3") return new S3StorageProvider();
  if (provider === "local") return new LocalStorageProvider();
  throw new ApiError(503, "Unknown storage provider");
}

/** Returns an opaque internal key, never a public URL. The caller owns authorization. */
export async function storeFile(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength === 0) throw new ApiError(400, "File must not be empty");
  if (bytes.byteLength > MAX_FILE_BYTES)
    throw new ApiError(413, "File exceeds upload limit");
  const key = randomUUID();
  try {
    await getStorageProvider().put(key, bytes);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "Private file storage is unavailable");
  }
  return key;
}
export async function readFile(key: string): Promise<Uint8Array> {
  assertSafeKey(key);
  try {
    return await getStorageProvider().read(key);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "Private file storage is unavailable");
  }
}
export async function deleteFile(key: string): Promise<void> {
  assertSafeKey(key);
  try {
    await getStorageProvider().delete(key);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "Private file storage is unavailable");
  }
}
