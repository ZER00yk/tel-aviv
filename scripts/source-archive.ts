import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "..");
const output = resolve(
  process.env.SOURCE_ARCHIVE_PATH ?? "/workspace/tell-aviv-backups",
);
if (output === root || output.startsWith(root + "/"))
  throw Error("Store source archives outside the checkout");
const excluded = new Set([
  ".git",
  ".local",
  ".next",
  ".next-dev",
  "node_modules",
  ".data",
  "test-results",
  "playwright-report",
]);
const files: string[] = [];
async function collect(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.startsWith("test-results"))
      continue;
    if (entry.name.startsWith(".env") && entry.name !== ".env.example")
      continue;
    if (entry.name.endsWith(".tsbuildinfo") || /\.(pem|key)$/.test(entry.name))
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) files.push(relative(root, path));
  }
}
await collect(root);
files.sort();
await mkdir(output, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const archive = join(output, `tell-aviv-source-${stamp}.tar.gz`);
const list = join(output, `.source-files-${stamp}`);
const hashes: Record<string, string> = {};
for (const file of files)
  hashes[file] = createHash("sha256")
    .update(await readFile(join(root, file)))
    .digest("hex");
await writeFile(list, files.join("\0") + "\0", { mode: 0o600 });
const run = promisify(execFile);
await run("tar", ["-czf", archive, "--null", "-T", list], { cwd: root });
const members = (
  await run("tar", ["-tzf", archive], { maxBuffer: 8 * 1024 * 1024 })
).stdout
  .trim()
  .split("\n");
if (
  members.length !== files.length ||
  files.some((file) => !members.includes(file))
)
  throw Error("Source archive membership mismatch");
// Verify archived bytes and ensure no file changed while this snapshot was made.
for (const file of files) {
  const archived = await run("tar", ["-xOzf", archive, file], {
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (
    createHash("sha256").update(archived.stdout).digest("hex") !== hashes[file]
  )
    throw Error(`Source changed while archiving: ${file}`);
}
const sha256 = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
await writeFile(
  archive + ".manifest.json",
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      archive,
      sha256,
      fileCount: files.length,
      files: hashes,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
await writeFile(archive + ".sha256", `${sha256}  ${archive}\n`, {
  mode: 0o600,
});
console.log(
  JSON.stringify({
    archive,
    sha256,
    fileCount: files.length,
    manifest: archive + ".manifest.json",
  }),
);
