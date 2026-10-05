import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  readFile,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "..");
const baseImage = process.env.RELEASE_BASE_IMAGE;
if (!baseImage || !/^tell-aviv:[A-Za-z0-9_.-]+$/.test(baseImage))
  throw new Error(
    "Set RELEASE_BASE_IMAGE to the verified local Tell Aviv image",
  );
const destination = resolve(
  root,
  ".local/deploy",
  `release-context-${randomUUID()}`,
);
const app = join(destination, "app");
const excluded = new Set([
  ".git",
  ".local",
  ".next",
  ".next-dev",
  "node_modules",
  ".data",
  "test-results",
  "playwright-report",
  ".npmrc",
]);
const sourceFiles: string[] = [];
const compiledFiles: string[] = [];
const hashes: Record<string, string> = {};
const run = promisify(execFile);

async function digest(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile())
      throw new Error("Expected a regular file");
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false }))
      hash.update(chunk);
    return hash.digest("hex");
  } finally {
    await file.close();
  }
}

async function collect(directory: string, compiled: boolean) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      (compiled &&
        directory === join(root, "apps/web/.next") &&
        entry.name === "cache") ||
      (!compiled && excluded.has(entry.name)) ||
      entry.name.startsWith("test-results") ||
      (entry.name.startsWith(".env") && entry.name !== ".env.example") ||
      /\.(pem|key|tsbuildinfo|log)$/.test(entry.name)
    )
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path, compiled);
    else if (entry.isFile())
      (compiled ? compiledFiles : sourceFiles).push(relative(root, path));
    else throw new Error("Release contexts reject symlinks and special files");
  }
}

await collect(root, false);
const compiledRoot = join(root, "apps/web/.next");
const buildId = (await readFile(join(compiledRoot, "BUILD_ID"), "utf8")).trim();
if (!buildId) throw new Error("A completed production build is required");
await collect(compiledRoot, true);
sourceFiles.sort();
compiledFiles.sort();

const lockSha256 = await digest(join(root, "pnpm-lock.yaml"));
const baseLock = await run("docker", [
  "image",
  "inspect",
  baseImage,
  "--format",
  "{{.Id}}",
]);
const baseId = baseLock.stdout.trim();
const baseTag = `tell-aviv:release-base-${baseId.replace(/^sha256:/, "")}`;
// Read the base image without creating another VFS container snapshot. The
// currently deployed web container must still use exactly this verified base.
const baseContainer = process.env.RELEASE_BASE_CONTAINER;
if (!baseContainer || !/^[A-Za-z0-9_.-]+$/.test(baseContainer))
  throw new Error(
    "Set RELEASE_BASE_CONTAINER to the matching running web service",
  );
const containerImage = await run("docker", [
  "inspect",
  baseContainer,
  "--format",
  "{{.Image}}",
]);
if (containerImage.stdout.trim() !== baseId)
  throw new Error("Base container and image differ");
const baseHash = await run("docker", [
  "exec",
  baseContainer,
  "node",
  "-e",
  "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('/app/pnpm-lock.yaml')).digest('hex'))",
]);
if (baseHash.stdout.trim() !== lockSha256)
  throw new Error(
    "Dependency lockfile changed; a complete frozen rebuild is required",
  );

await mkdir(app, { recursive: true, mode: 0o700 });
for (const file of [...sourceFiles, ...compiledFiles]) {
  const source = join(root, file),
    target = join(app, file);
  hashes[file] = await digest(source);
  await mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 });
  await copyFile(source, target, constants.COPYFILE_EXCL);
  if (
    (await digest(target)) !== hashes[file] ||
    (await digest(source)) !== hashes[file]
  )
    throw new Error(`Source changed during release preparation: ${file}`);
}
const sourceSha256 = createHash("sha256")
  .update(sourceFiles.map((file) => `${file}\0${hashes[file]}\n`).join(""))
  .digest("hex");
const compiledSha256 = createHash("sha256")
  .update(compiledFiles.map((file) => `${file}\0${hashes[file]}\n`).join(""))
  .digest("hex");
// BuildKit resolves FROM by image reference, rather than Docker's image ID.
// Give the already verified base a unique digest-derived local alias.
await run("docker", ["image", "tag", baseId, baseTag]);
await writeFile(
  join(destination, "Dockerfile"),
  `FROM ${baseTag}\nCOPY app/ /app/\nLABEL org.tell-aviv.base-image="${baseId}" org.tell-aviv.source-sha256="${sourceSha256}" org.tell-aviv.build-sha256="${compiledSha256}" org.tell-aviv.build-id="${buildId}"\n`,
  { mode: 0o600 },
);
await writeFile(
  join(destination, "manifest.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      baseImage: baseId,
      lockSha256,
      sourceSha256,
      compiledSha256,
      buildId,
      sourceFiles: sourceFiles.length,
      compiledFiles: compiledFiles.length,
      files: hashes,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({ destination, sourceSha256, compiledSha256, buildId }),
);
