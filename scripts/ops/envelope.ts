import { constants } from "node:fs";
import {
  open,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  link,
  unlink,
  realpath,
} from "node:fs/promises";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join, resolve, sep, dirname } from "node:path";
import { verifyBackup, checksumFile, type BackupManifest } from "./backup";
import { storageKeyIsValid } from "../../packages/storage/src/index";

const MAGIC = Buffer.from("TAVBKE01"),
  PACK_MAGIC = Buffer.from("TAVPKV01");
const MAX_METADATA = 4096,
  MAX_FILES = 1_000_002;
const DEFAULT_MAX_BYTES = 256 * 1024 ** 3;
const ENVELOPE_NAME = /^tell-aviv-envelope-[0-9a-f-]{36}\.tae$/;
const uint32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};
type File = Awaited<ReturnType<typeof open>>;
async function writeAll(file: File, bytes: Buffer) {
  let written = 0;
  while (written < bytes.length) {
    const result = await file.write(bytes, written, bytes.length - written);
    if (!result.bytesWritten) throw Error("Backup write did not complete");
    written += result.bytesWritten;
  }
}
function fileWriter(file: File) {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      writeAll(file, chunk).then(() => callback(), callback);
    },
  });
}
async function* fileChunks(file: File, start = 0, length?: number) {
  const end = start + (length ?? (await file.stat()).size);
  for (let position = start; position < end;) {
    const chunk = await readExact(
      file,
      Math.min(65536, end - position),
      position,
    );
    position += chunk.length;
    yield chunk;
  }
}
function assertKey(key: Uint8Array) {
  if (key.byteLength !== 32)
    throw Error("Backup encryption requires a 32-byte key");
}
function assertLimit(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw Error("Invalid encrypted backup byte limit");
}
export function encryptedBackupKeyIsValid(value: string) {
  return ENVELOPE_NAME.test(value);
}

/** Read an operator-managed raw key file. Keys never enter manifests, filenames, logs or SQL. */
export async function readBackupEncryptionKey(
  path: string,
  forbiddenRoots: readonly string[] = [],
) {
  const canonical = await realpath(path);
  for (const root of forbiddenRoots) {
    const boundary = await realpath(root).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return resolve(root);
        throw error;
      },
    );
    if (canonical === boundary || canonical.startsWith(boundary + sep))
      throw Error(
        "Keep the encryption key outside source and backup directories",
      );
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== 32 || (stat.mode & 0o077) !== 0)
      throw Error("Encryption key must be a private regular 32-byte file");
    return await file.readFile();
  } finally {
    await file.close();
  }
}

async function* pack(
  directory: string,
  manifest: BackupManifest,
  manifestChecksum: string,
) {
  const checksums = new Map(
    manifest.uploads.map((entry) => [entry.key, entry.sha256]),
  );
  const names = [
    "manifest.json",
    "database.dump",
    ...manifest.uploads.map(({ key }) => `uploads/${key}`).sort(),
  ];
  if (names.length > MAX_FILES) throw Error("Backup has too many files");
  yield PACK_MAGIC;
  yield uint32(names.length);
  for (const name of names) {
    const handle = await open(
      join(directory, name),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw Error("Backup member must be a regular file");
      const expected =
        name === "database.dump"
          ? manifest.databaseChecksum
          : name.startsWith("uploads/")
            ? checksums.get(name.slice(8))
            : manifestChecksum;
      const metadata = Buffer.from(
        JSON.stringify({ name, size: stat.size, sha256: expected }),
      );
      if (metadata.length > MAX_METADATA)
        throw Error("Backup member metadata exceeds its limit");
      yield uint32(metadata.length);
      yield metadata;
      const hash = createHash("sha256");
      let copied = 0;
      for await (const chunk of fileChunks(handle)) {
        copied += chunk.length;
        hash.update(chunk);
        yield chunk;
      }
      if (copied !== stat.size || hash.digest("hex") !== expected)
        throw Error("Backup changed during encryption");
    } finally {
      await handle.close();
    }
  }
}

/** Creates a new envelope without modifying or deleting the verified v2 snapshot. */
export async function encryptBackup(
  directory: string,
  options: { key: Uint8Array; root: string; now?: Date; maxBytes?: number },
) {
  assertKey(options.key);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  assertLimit(maxBytes);
  const manifest = await verifyBackup(directory);
  if (manifest.version !== 2)
    throw Error("Only complete v2 backups can be encrypted");
  const manifestFile = await open(
    join(directory, "manifest.json"),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let manifestChecksum: string;
  try {
    const bytes = await manifestFile.readFile();
    if (
      JSON.stringify(JSON.parse(bytes.toString("utf8"))) !==
      JSON.stringify(manifest)
    )
      throw Error("Backup manifest changed before encryption");
    manifestChecksum = createHash("sha256").update(bytes).digest("hex");
  } finally {
    await manifestFile.close();
  }
  if (
    manifest.databaseBytes +
      manifest.uploads.reduce((sum, file) => sum + file.size, 0) +
      (await lstat(join(directory, "manifest.json"))).size >
    maxBytes
  )
    throw Error("Backup exceeds the encrypted backup byte limit");
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw Error("Invalid encryption date");
  const root = resolve(options.root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw Error("Encrypted backup output must be a regular directory");
  const nonce = randomBytes(12),
    key = `tell-aviv-envelope-${randomUUID()}.tae`,
    target = join(root, key),
    temporary = join(root, `.in-progress-${key}`);
  const header = Buffer.from(
    JSON.stringify({
      version: 1,
      algorithm: "AES-256-GCM",
      nonce: nonce.toString("base64url"),
      createdAt: now.toISOString(),
    }),
  );
  const prefix = Buffer.concat([MAGIC, uint32(header.length), header]);
  const cipher = createCipheriv("aes-256-gcm", options.key, nonce);
  cipher.setAAD(prefix);
  const output = await open(temporary, "wx", 0o600);
  const outputStream = fileWriter(output);
  try {
    await writeAll(output, prefix);
    await pipeline(
      Readable.from(pack(resolve(directory), manifest, manifestChecksum)),
      cipher,
      outputStream,
    );
    outputStream.destroy();
    await writeAll(output, cipher.getAuthTag());
    await output.sync();
    await output.close();
    await link(temporary, target);
    await unlink(temporary);
    return {
      path: target,
      key,
      bytes: (await lstat(target)).size,
      sha256: await checksumFile(target),
      algorithm: "AES-256-GCM" as const,
    };
  } catch (error) {
    outputStream.destroy();
    await output.close().catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  }
}

async function readExact(
  file: Awaited<ReturnType<typeof open>>,
  length: number,
  position: number,
) {
  const result = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const chunk = await file.read(result, read, length - read, position + read);
    if (!chunk.bytesRead) throw Error("Encrypted backup is truncated");
    read += chunk.bytesRead;
  }
  return result;
}

/** Authentication must finish before any plaintext member is parsed or published. */
export async function decryptBackup(
  envelope: string,
  options: { key: Uint8Array; root: string; maxBytes?: number },
) {
  assertKey(options.key);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  assertLimit(maxBytes);
  const root = resolve(options.root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw Error("Decrypted backup output must be a regular directory");
  const scratch = await mkdtemp(join(root, ".decrypting-"));
  const packedPath = join(scratch, "authenticated.pack"),
    staged = join(scratch, "snapshot");
  let input: Awaited<ReturnType<typeof open>> | undefined;
  try {
    input = await open(envelope, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await input.stat();
    if (
      !stat.isFile() ||
      stat.size < 40 ||
      stat.size > maxBytes + MAX_FILES * (MAX_METADATA + 4) + 65536
    )
      throw Error("Encrypted backup size is invalid");
    const first = await readExact(input, 12, 0);
    if (!first.subarray(0, 8).equals(MAGIC))
      throw Error("Encrypted backup format is invalid");
    const size = first.readUInt32BE(8);
    if (size < 1 || size > MAX_METADATA || stat.size <= 12 + size + 16)
      throw Error("Encrypted backup header is invalid");
    const headerBytes = await readExact(input, size, 12),
      prefix = Buffer.concat([first, headerBytes]);
    let header: {
      version: number;
      algorithm: string;
      nonce: string;
      createdAt: string;
    };
    try {
      header = JSON.parse(headerBytes.toString("utf8"));
    } catch {
      throw Error("Encrypted backup header is invalid");
    }
    if (
      header.version !== 1 ||
      header.algorithm !== "AES-256-GCM" ||
      !/^[A-Za-z0-9_-]{16}$/.test(header.nonce) ||
      !Number.isFinite(new Date(header.createdAt).getTime())
    )
      throw Error("Encrypted backup header is invalid");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      options.key,
      Buffer.from(header.nonce, "base64url"),
    );
    decipher.setAAD(prefix);
    decipher.setAuthTag(await readExact(input, 16, stat.size - 16));
    const packed = await open(packedPath, "wx", 0o600);
    const cipherStream = Readable.from(
      fileChunks(input, prefix.length, stat.size - prefix.length - 16),
    );
    const packedStream = fileWriter(packed);
    try {
      await pipeline(cipherStream, decipher, packedStream);
    } catch {
      throw Error("Encrypted backup authentication failed");
    } finally {
      cipherStream.destroy();
      packedStream.destroy();
      await packed.close();
    }
    await mkdir(staged, { mode: 0o700 });
    await mkdir(join(staged, "uploads"), { mode: 0o700 });
    const contents = await open(
      packedPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const preamble = await readExact(contents, 12, 0);
      if (!preamble.subarray(0, 8).equals(PACK_MAGIC))
        throw Error("Encrypted backup contents are invalid");
      const count = preamble.readUInt32BE(8);
      if (count < 2 || count > MAX_FILES)
        throw Error("Encrypted backup member count is invalid");
      let position = 12,
        total = 0;
      const names = new Set<string>();
      for (let index = 0; index < count; index++) {
        const length = (await readExact(contents, 4, position)).readUInt32BE();
        position += 4;
        if (length < 1 || length > MAX_METADATA)
          throw Error("Encrypted backup member metadata is invalid");
        const member = JSON.parse(
          (await readExact(contents, length, position)).toString("utf8"),
        ) as { name: string; size: number; sha256: string };
        position += length;
        if (
          typeof member.name !== "string" ||
          !(
            ["manifest.json", "database.dump"].includes(member.name) ||
            (member.name.startsWith("uploads/") &&
              storageKeyIsValid(member.name.slice(8)))
          ) ||
          names.has(member.name) ||
          !Number.isSafeInteger(member.size) ||
          member.size <= 0 ||
          !/^[a-f0-9]{64}$/.test(member.sha256)
        )
          throw Error("Encrypted backup member is invalid");
        names.add(member.name);
        total += member.size;
        if (
          total > maxBytes ||
          position + member.size > (await contents.stat()).size
        )
          throw Error("Encrypted backup contents exceed their limit");
        const output = await open(join(staged, member.name), "wx", 0o600),
          hash = createHash("sha256");
        try {
          for await (const chunk of fileChunks(
            contents,
            position,
            member.size,
          )) {
            hash.update(chunk);
            await writeAll(output, chunk);
          }
        } finally {
          await output.close();
        }
        if (hash.digest("hex") !== member.sha256)
          throw Error("Decrypted backup member checksum verification failed");
        position += member.size;
      }
      if (position !== (await contents.stat()).size)
        throw Error("Encrypted backup has unlisted trailing contents");
    } finally {
      await contents.close();
    }
    const manifest = await verifyBackup(staged);
    if (manifest.version !== 2)
      throw Error("Decrypted backup must have a complete v2 manifest");
    const directory = join(root, `tell-aviv-decrypted-${randomUUID()}`);
    // The destination is generated and absent; rename publishes only verified bytes.
    const { rename } = await import("node:fs/promises");
    await rename(staged, directory);
    return { directory, manifest };
  } finally {
    await input?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

export interface BackupDestination {
  readonly kind: string;
  put(
    key: string,
    source: string,
    expectedChecksum: string,
  ): Promise<{ bytes: number; sha256: string }>;
  retrieve(
    key: string,
    target: string,
    expectedChecksum: string,
  ): Promise<void>;
}

/** Mount a separately administered volume to use this adapter off host; local fixtures prove only I/O. */
export class FilesystemBackupDestination implements BackupDestination {
  readonly kind = "filesystem";
  constructor(private readonly root: string) {}
  private async path(key: string) {
    if (!encryptedBackupKeyIsValid(key))
      throw Error("Invalid encrypted backup destination key");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("Backup destination must be a regular directory");
    return join(await realpath(this.root), key);
  }
  async put(key: string, source: string, expectedChecksum: string) {
    const target = await this.path(key);
    await copyVerified(source, target, expectedChecksum);
    return {
      bytes: (await lstat(target)).size,
      sha256: await checksumFile(target),
    };
  }
  async retrieve(key: string, target: string, expectedChecksum: string) {
    await copyVerified(await this.path(key), resolve(target), expectedChecksum);
  }
}

async function copyVerified(
  source: string,
  target: string,
  expectedChecksum: string,
) {
  if (!/^[a-f0-9]{64}$/.test(expectedChecksum))
    throw Error("Invalid encrypted backup checksum");
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(target), `.transferring-${randomUUID()}`),
    input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW),
    output = await open(temporary, "wx", 0o600);
  const inputStream = Readable.from(fileChunks(input)),
    outputStream = fileWriter(output);
  try {
    if (!(await input.stat()).isFile())
      throw Error("Backup transfer input must be a regular file");
    await pipeline(inputStream, outputStream);
    inputStream.destroy();
    outputStream.destroy();
    await output.sync();
    await output.close();
    await input.close();
    if ((await checksumFile(temporary)) !== expectedChecksum)
      throw Error("Transferred backup checksum verification failed");
    await link(temporary, target);
    await unlink(temporary);
    if ((await checksumFile(target)) !== expectedChecksum)
      throw Error("Published backup checksum verification failed");
  } finally {
    inputStream.destroy();
    outputStream.destroy();
    await input.close().catch(() => undefined);
    await output.close().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}
