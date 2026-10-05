import { z } from "zod";
import { db } from "../../database/src/index";
import { fail, type User } from "../../shared/src/index";
import { validateFile } from "../../storage/src/index";
import { storageUsage } from "./storageQuota";
import { publishEvent } from "../../../apps/realtime/src/events";

const uuid = z.string().uuid();
const emojiName = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9_]{2,32}$/,
    "Emoji names use 2–32 lowercase letters, numbers or underscores",
  );
export const MAX_EMOJI_BYTES = 256 * 1024;
export const MAX_SERVER_EMOJIS = 50;
const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
export function validateEmojiImage(
  file: { name: string; type: string; size: number },
  bytes: Uint8Array,
) {
  validateFile(file, bytes);
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0;
  if (file.type === "image/png" && bytes.length >= 24) {
    width = data.getUint32(16);
    height = data.getUint32(20);
  }
  if (file.type === "image/gif" && bytes.length >= 10) {
    width = data.getUint16(6, true);
    height = data.getUint16(8, true);
  }
  if (file.type === "image/webp" && bytes.length >= 25) {
    const kind = new TextDecoder().decode(bytes.subarray(12, 16));
    if (kind === "VP8X" && bytes.length >= 30) {
      width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    } else if (kind === "VP8L" && bytes[20] === 0x2f) {
      const bits = data.getUint32(21, true);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >>> 14) & 0x3fff);
    } else if (
      kind === "VP8 " &&
      bytes.length >= 30 &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      width = data.getUint16(26, true) & 0x3fff;
      height = data.getUint16(28, true) & 0x3fff;
    }
  }
  if (file.type === "image/jpeg") {
    for (let offset = 2; offset + 4 < bytes.length;) {
      if (bytes[offset++] !== 0xff) break;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = data.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 7
      ) {
        height = data.getUint16(offset + 3);
        width = data.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (width < 1 || height < 1 || width > 512 || height > 512)
    fail(
      415,
      "Emoji images need valid dimensions no larger than 512 × 512 pixels",
    );
}
type MediaDeps = {
  serverAccess: (userId: string, serverId: string) => Promise<unknown>;
};
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    fail(400, result.error.issues.map((issue) => issue.message).join("; "));
  return result.data;
}

async function multipart(request: Request) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("multipart/form-data"))
    fail(415, "Use multipart form data");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "Upload is empty");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_EMOJI_BYTES + 64 * 1024) {
        await reader.cancel();
        fail(413, "Emoji upload exceeds 256 KB plus form headers");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return await new Request(request.url, {
      method: "POST",
      headers: { "content-type": type },
      body: bytes.buffer,
    }).formData();
  } catch {
    fail(400, "Invalid multipart upload");
  }
}

export async function handleServerEmoji(
  path: string[],
  method: string,
  user: User,
  request: Request,
  deps: MediaDeps,
) {
  const [, serverId, segment, emojiId, action] = path;
  if (segment !== "emojis" || !serverId) return undefined;
  parse(uuid, serverId);
  await deps.serverAccess(user.id, serverId);
  if (method === "GET" && !emojiId)
    return db`SELECT id,name,mime,bytes,created_at AS "createdAt" FROM server_emojis WHERE server_id=${serverId} ORDER BY name,id`;
  if (method === "GET" && emojiId && action === "file") {
    parse(uuid, emojiId);
    const [emoji] =
      await db`SELECT mime,data FROM server_emojis WHERE id=${emojiId} AND server_id=${serverId}`;
    if (!emoji) fail(404, "Emoji was deleted");
    return new Response(new Uint8Array(emoji.data), {
      headers: {
        "Content-Type": emoji.mime,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
      },
    });
  }
  if (!(
    (method === "POST" && !emojiId) ||
    (method === "DELETE" && emojiId && !action)
  ))
    return undefined;
  let name: string | undefined,
    file: File | undefined,
    bytes: Uint8Array | undefined;
  if (method === "POST") {
    const form = await multipart(request);
    name = parse(emojiName, form.get("name"));
    const upload = form.get("file");
    if (!(upload instanceof File)) fail(400, "Choose an emoji image");
    file = upload;
    if (file.size > MAX_EMOJI_BYTES)
      fail(413, "Emoji images must be at most 256 KB");
    if (!imageTypes.has(file.type))
      fail(415, "Emoji supports PNG, JPEG, GIF or WebP; SVG is not supported");
    bytes = new Uint8Array(await file.arrayBuffer());
    validateEmojiImage(
      { name: file.name, type: file.type, size: file.size },
      bytes,
    );
  }
  const deleteId = method === "DELETE" ? parse(uuid, emojiId) : null;
  const result = await db.begin(async (tx) => {
    await tx`SELECT id FROM users WHERE id=${user.id} FOR UPDATE`;
    const [server] =
      await tx`SELECT s.id,s.owner_id FROM servers s JOIN server_members m ON m.server_id=s.id AND m.user_id=${user.id} WHERE s.id=${serverId} FOR UPDATE OF s`;
    if (!server) fail(403, "Server membership required");
    if (
      server.owner_id !== user.id &&
      !(
        await tx`SELECT r.id FROM server_roles r WHERE r.server_id=${serverId} AND 'manage_server'=ANY(r.permissions) AND (r.is_default OR EXISTS(SELECT 1 FROM server_member_roles mr WHERE mr.role_id=r.id AND mr.server_id=${serverId} AND mr.user_id=${user.id}))`
      ).length
    )
      fail(403, "Manage server permission required");
    if (method === "DELETE") {
      const removed =
        await tx`DELETE FROM server_emojis WHERE server_id=${serverId} AND id=${deleteId} RETURNING id`;
      if (!removed.length) fail(404, "Emoji not found");
      return { ok: true };
    }
    if (!file || !bytes || name === undefined)
      fail(400, "Emoji upload is incomplete");
    if (
      Number(
        (
          await tx`SELECT count(*)::int AS count FROM server_emojis WHERE server_id=${serverId}`
        )[0].count,
      ) >= MAX_SERVER_EMOJIS
    )
      fail(409, "This server has reached its 50 emoji limit");
    const usage = await storageUsage(tx, user.id);
    if (usage.usageBytes + file.size > usage.quotaBytes)
      fail(413, "Your storage quota is full");
    if (
      (
        await tx`SELECT id FROM server_emojis WHERE server_id=${serverId} AND name=${name}`
      ).length
    )
      fail(409, "This server already has an emoji with that name");
    return (
      await tx`INSERT INTO server_emojis(server_id,owner_id,name,mime,bytes,data) VALUES(${serverId},${user.id},${name},${file.type},${file.size},${Buffer.from(bytes)}) RETURNING id,name,mime,bytes`
    )[0];
  });
  const members =
    await db`SELECT user_id FROM server_members WHERE server_id=${serverId}`;
  await publishEvent({
    type: "server:emoji:update",
    userIds: members.map((member) => String(member.user_id)),
    payload: { serverId },
  });
  return result;
}

export interface GifResult {
  id: string;
  title: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
  sourceUrl: string;
}
export interface GifSearch {
  configured: boolean;
  provider: string | null;
  results: GifResult[];
  message?: string;
}
export interface GifProvider {
  name: string;
  search: (query: string) => Promise<GifResult[]>;
}
function providerUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "giphy.com" || url.hostname.endsWith(".giphy.com")) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function configuredGifProvider(
  env: Record<string, string | undefined> = process.env,
): GifProvider | undefined {
  if (env.GIF_PROVIDER !== "giphy" || !env.GIPHY_API_KEY?.trim())
    return undefined;
  const key = env.GIPHY_API_KEY;
  return {
    name: "GIPHY",
    search: async (query) => {
      const url = new URL("https://api.giphy.com/v1/gifs/search");
      url.searchParams.set("api_key", key);
      url.searchParams.set("q", query);
      url.searchParams.set("limit", "12");
      url.searchParams.set("rating", "g");
      let response: Response;
      try {
        response = await fetch(url, {
          signal: AbortSignal.timeout(5000),
          redirect: "error",
          headers: { Accept: "application/json" },
        });
      } catch {
        fail(503, "GIF search provider is temporarily unavailable");
      }
      if (!response.ok)
        fail(503, "GIF search provider is temporarily unavailable");
      const reader = response.body?.getReader();
      if (!reader) fail(503, "GIF search provider returned an empty response");
      let body = "",
        size = 0;
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 512 * 1024) {
            await reader.cancel();
            fail(503, "GIF search provider response was too large");
          }
          body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
      } finally {
        reader.releaseLock();
      }
      let data: unknown;
      try {
        data = JSON.parse(body);
      } catch {
        fail(503, "GIF search provider response was invalid");
      }
      const parsed = z
        .object({
          data: z
            .array(
              z
                .object({
                  id: z.string().max(160),
                  title: z.string().max(300).optional(),
                  url: z.string().optional(),
                  images: z.record(
                    z.string(),
                    z
                      .object({
                        url: z.string().optional(),
                        width: z.string().optional(),
                        height: z.string().optional(),
                      })
                      .passthrough(),
                  ),
                })
                .passthrough(),
            )
            .max(100),
        })
        .safeParse(data);
      if (!parsed.success)
        fail(503, "GIF search provider response was invalid");
      return parsed.data.data.slice(0, 12).flatMap((gif) => {
        const image = gif.images.fixed_width ?? gif.images.original,
          preview = gif.images.fixed_width_small ?? image;
        const imageUrl = providerUrl(image?.url),
          previewUrl = providerUrl(preview?.url),
          sourceUrl = providerUrl(gif.url);
        if (!imageUrl || !previewUrl || !sourceUrl) return [];
        return [
          {
            id: gif.id,
            title: gif.title ?? "GIF",
            url: imageUrl,
            previewUrl,
            width: Math.max(1, Math.min(2048, Number(image.width) || 200)),
            height: Math.max(1, Math.min(2048, Number(image.height) || 200)),
            sourceUrl,
          },
        ];
      });
    },
  };
}
export async function searchGifs(
  url: URL,
  provider: GifProvider | undefined = configuredGifProvider(),
): Promise<GifSearch> {
  if (!provider)
    return {
      configured: false,
      provider: null,
      results: [],
      message: "GIF search is unavailable until a provider key is configured.",
    };
  const query = (url.searchParams.get("q") ?? "").trim();
  if (query.length > 120) fail(400, "GIF search is limited to 120 characters");
  return {
    configured: true,
    provider: provider.name,
    results: query ? await provider.search(query) : [],
  };
}
