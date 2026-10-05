import { createHash } from "node:crypto";
import Redis from "ioredis";
import { z } from "zod";
import { fail, type User } from "../../shared/src/index";
import { fetchLinkMetadata, type LinkMetadata } from "./linkPreviewTransport";

export interface LinkPreviewDeps {
  /** Checks view + embed permissions, membership, blocks, deletion and room identity. */
  readMessage: (
    userId: string,
    roomId: string,
    messageId: string,
  ) => Promise<string>;
}
export interface LinkPreviewResult {
  preview: LinkMetadata | null;
  message?: string;
}
export function firstPreviewLink(content: string): string | null {
  const match = content.slice(0, 4000).match(/https:\/\/[^\s<>"`]+/i);
  return match ? match[0].replace(/[),.!?;:]+$/, "") : null;
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
let redis: Redis | undefined;
async function takeBudget(userId: string) {
  if (!process.env.REDIS_URL)
    fail(503, "Link previews are temporarily unavailable.");
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      commandTimeout: 1000,
    });
    redis.on("error", () => undefined);
  }
  const script = `local u=redis.call('INCR',KEYS[1]); if u==1 then redis.call('EXPIRE',KEYS[1],60) end; if u>10 then return {u,0} end; local g=redis.call('INCR',KEYS[2]); if g==1 then redis.call('EXPIRE',KEYS[2],60) end; return {u,g}`;
  let counters: unknown;
  try {
    counters = await redis.eval(
      script,
      2,
      `tell-aviv:preview-rate:${digest(userId)}`,
      "tell-aviv:preview-rate:global",
    );
  } catch {
    fail(503, "Link previews are temporarily unavailable.");
  }
  if (!Array.isArray(counters) || counters.length !== 2)
    fail(503, "Link previews are temporarily unavailable.");
  if (Number(counters[0]) > 10 || Number(counters[1]) > 200)
    fail(429, "Link preview limit reached. Try again in a minute.");
}

export class LinkPreviewService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; preview: LinkMetadata }
  >();
  constructor(
    private readonly fetchMetadata: (
      value: string,
    ) => Promise<LinkMetadata> = fetchLinkMetadata,
    private readonly budget: (userId: string) => Promise<void> = takeBudget,
    private readonly now: () => number = Date.now,
  ) {}
  async preview(
    userId: string,
    roomId: string,
    messageId: string,
    deps: LinkPreviewDeps,
  ): Promise<LinkPreviewResult> {
    const content = await deps.readMessage(userId, roomId, messageId);
    const link = firstPreviewLink(content);
    if (!link) return { preview: null };
    await this.budget(userId);
    const key = digest(JSON.stringify([userId, roomId, messageId, content]));
    const cached = this.cache.get(key);
    let metadata: LinkMetadata | undefined;
    if (cached && cached.expiresAt > this.now()) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      metadata = cached.preview;
    } else {
      this.cache.delete(key);
      try {
        metadata = await this.fetchMetadata(link);
      } catch {
        /* Never return DNS/network details or URLs in an error. */
      }
    }
    const current = await deps.readMessage(userId, roomId, messageId);
    if (current !== content)
      fail(409, "Message changed. Load its preview again.");
    if (!metadata)
      return { preview: null, message: "This link has no available preview." };
    if (!cached || cached.expiresAt <= this.now()) {
      const now = this.now();
      for (const [cacheKey, entry] of this.cache)
        if (entry.expiresAt <= now) this.cache.delete(cacheKey);
      if (this.cache.size >= 256)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { expiresAt: now + 5 * 60_000, preview: metadata });
    }
    return { preview: metadata };
  }
}
const service = new LinkPreviewService();
export async function handleLinkPreview(
  path: string[],
  method: string,
  user: User,
  input: unknown,
  deps: LinkPreviewDeps,
) {
  if (path.join("/") !== "chat/link-preview" || method !== "POST")
    return undefined;
  const result = z
    .object({ roomId: z.string().uuid(), messageId: z.string().uuid() })
    .strict()
    .safeParse(input);
  if (!result.success) fail(400, "Choose a chat message to preview.");
  return service.preview(
    user.id,
    result.data.roomId,
    result.data.messageId,
    deps,
  );
}
