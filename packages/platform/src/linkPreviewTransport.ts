import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";

export const MAX_PREVIEW_BYTES = 64 * 1024;
export const PREVIEW_TIMEOUT_MS = 4000;
export interface LinkMetadata {
  url: string;
  site: string;
  title: string;
  description: string;
}
export interface PinnedPreviewTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}
export interface PreviewResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: Buffer;
}
export interface PreviewTransport {
  resolve: (hostname: string) => Promise<{ address: string; family: number }[]>;
  request: (
    target: PinnedPreviewTarget,
    signal: AbortSignal,
  ) => Promise<PreviewResponse>;
}
export class PreviewUnavailable extends Error {
  constructor() {
    super("Link preview is unavailable for this address.");
  }
}
function unavailable(): never {
  throw new PreviewUnavailable();
}

// Allow ordinary public unicast only. This deliberately denies special-purpose
// ranges, including documentation, translated/mapped, transition and multicast.
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    const value = octets.reduce(
      (total, octet) => (total * 256 + octet) >>> 0,
      0,
    );
    const excluded: [number, number][] = [
      [0x00000000, 8],
      [0x0a000000, 8],
      [0x64400000, 10],
      [0x7f000000, 8],
      [0xa9fe0000, 16],
      [0xac100000, 12],
      [0xc0000000, 24],
      [0xc0000200, 24],
      [0xc0586300, 24],
      [0xc0a80000, 16],
      [0xc6120000, 15],
      [0xc6336400, 24],
      [0xcb007100, 24],
      [0xe0000000, 4],
      [0xf0000000, 4],
    ];
    if (address === "168.63.129.16") return false; // Azure platform/metadata service.
    return !excluded.some(([network, bits]) => {
      const mask = (0xffffffff << (32 - bits)) >>> 0;
      return (value & mask) >>> 0 === network;
    });
  }
  if (family !== 6 || address.includes("%") || address.includes("."))
    return false;
  const halves = address.toLowerCase().split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const words =
    halves.length === 1
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (words.length !== 8) return false;
  const value = words.reduce(
    (total, word) => (total << 16n) | BigInt(`0x${word}`),
    0n,
  );
  const inRange = (prefix: bigint, bits: number) =>
    value >> BigInt(128 - bits) === prefix >> BigInt(128 - bits);
  return (
    inRange(0x20000000000000000000000000000000n, 3) &&
    !inRange(0x20010000000000000000000000000000n, 23) &&
    !inRange(0x20010db8000000000000000000000000n, 32) &&
    !inRange(0x20020000000000000000000000000000n, 16) &&
    !inRange(0x3ffe0000000000000000000000000000n, 16) &&
    !inRange(0x3fff0000000000000000000000000000n, 20)
  );
}

export function previewUrl(value: string, base?: URL): URL {
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value))
    unavailable();
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return unavailable();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    unavailable();
  const hostname = url.hostname.toLowerCase();
  if (
    isIP(hostname.replace(/^\[|\]$/g, "")) ||
    hostname.endsWith(".") ||
    hostname.length > 253 ||
    !hostname.includes(".")
  )
    unavailable();
  if (
    !hostname
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    unavailable();
  if (
    /(?:^|\.)(?:localhost|local|internal|intranet|home|lan|test|invalid|example|onion)$/.test(
      hostname,
    )
  )
    unavailable();
  url.hash = "";
  return url;
}

function aborted(signal: AbortSignal) {
  if (signal.aborted) unavailable();
}
async function withAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(new PreviewUnavailable());
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
export async function resolvePreviewTarget(
  url: URL,
  resolve: PreviewTransport["resolve"],
  signal: AbortSignal,
): Promise<PinnedPreviewTarget> {
  const answers = await withAbort(resolve(url.hostname), signal);
  aborted(signal);
  if (
    !answers.length ||
    answers.length > 32 ||
    answers.some(
      (answer) =>
        !isPublicAddress(answer.address) ||
        isIP(answer.address) !== answer.family,
    )
  )
    unavailable();
  return {
    url,
    address: answers[0].address,
    family: answers[0].family as 4 | 6,
  };
}

// This callback never consults DNS. HTTPS still validates the original hostname
// through SNI and checkServerIdentity, while the socket uses this vetted address.
export function pinnedLookup(target: PinnedPreviewTarget): LookupFunction {
  return (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) {
      callback(null, [{ address: target.address, family: target.family }]);
    } else {
      callback(null, target.address, target.family);
    }
  };
}
export const requestPinnedPreview: PreviewTransport["request"] = (
  target,
  signal,
) =>
  new Promise((resolve, reject) => {
    aborted(signal);
    const req = request(
      target.url,
      {
        method: "GET",
        agent: false,
        lookup: pinnedLookup(target),
        servername: target.url.hostname,
        rejectUnauthorized: true,
        maxHeaderSize: 8192,
        signal,
        headers: {
          Accept: "text/html",
          "Accept-Encoding": "identity",
          "User-Agent": "TellAviv-LinkPreview/1.0",
        },
      },
      (response) => {
        response.on("aborted", () => reject(new PreviewUnavailable()));
        response.on("error", reject);
        const headers: Record<string, string | undefined> = {};
        for (const name of [
          "location",
          "content-type",
          "content-encoding",
          "content-length",
        ])
          headers[name] =
            typeof response.headers[name] === "string"
              ? response.headers[name]
              : undefined;
        const bad = () => {
          response.destroy(new PreviewUnavailable());
          req.destroy(new PreviewUnavailable());
        };
        if (
          (headers["content-encoding"] &&
            headers["content-encoding"].toLowerCase() !== "identity") ||
          (headers["content-length"] &&
            (!/^\d+$/.test(headers["content-length"]) ||
              Number(headers["content-length"]) > MAX_PREVIEW_BYTES))
        ) {
          bad();
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_PREVIEW_BYTES) bad();
          else chunks.push(chunk);
        });
        response.on("end", () => {
          if (!response.complete) reject(new PreviewUnavailable());
          else
            resolve({
              status: response.statusCode ?? 0,
              headers,
              body: Buffer.concat(chunks),
            });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
const defaultTransport: PreviewTransport = {
  resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  request: requestPinnedPreview,
};

function plainText(value: string, max: number) {
  const decoded = value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (_, entity: string) => {
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
      };
      if (entity[0] !== "#") return named[entity.toLowerCase()] ?? "";
      const code =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "";
    },
  );
  return decoded
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
export function parsePreviewHtml(html: string, url: URL): LinkMetadata {
  const head = html
    .split(/<\/head\s*>/i, 1)[0]
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "");
  let title = "",
    description = "",
    count = 0;
  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    if (++count > 256) break;
    const attrs: Record<string, string> = {};
    for (const attribute of match[0].matchAll(
      /([a-z][a-z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    ))
      attrs[attribute[1].toLowerCase()] =
        attribute[2] ?? attribute[3] ?? attribute[4];
    const name = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (!title && name === "og:title")
      title = plainText(attrs.content ?? "", 160);
    if (!description && (name === "description" || name === "og:description"))
      description = plainText(attrs.content ?? "", 320);
  }
  if (!title)
    title = plainText(
      head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "",
      160,
    );
  return {
    url: url.href,
    site: url.hostname,
    title: title || url.hostname,
    description,
  };
}
export async function fetchLinkMetadata(
  value: string,
  transport: PreviewTransport = defaultTransport,
): Promise<LinkMetadata> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);
  try {
    let url = previewUrl(value);
    for (let hop = 0; hop <= 3; hop++) {
      const target = await resolvePreviewTarget(
        url,
        transport.resolve,
        controller.signal,
      );
      const response = await withAbort(
        transport.request(target, controller.signal),
        controller.signal,
      );
      aborted(controller.signal);
      if (
        response.body.length > MAX_PREVIEW_BYTES ||
        (response.headers["content-encoding"] &&
          response.headers["content-encoding"].toLowerCase() !== "identity")
      )
        unavailable();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (hop === 3 || !response.headers.location) unavailable();
        url = previewUrl(response.headers.location, url);
        continue;
      }
      if (
        response.status !== 200 ||
        !/^text\/html(?:\s*;|$)/i.test(response.headers["content-type"] ?? "")
      )
        unavailable();
      const charset = response.headers["content-type"]?.match(
        /charset\s*=\s*["']?([^\s;"']+)/i,
      )?.[1];
      if (charset && !/^(?:utf-8|utf8|us-ascii)$/i.test(charset)) unavailable();
      if (
        response.headers["content-length"] &&
        Number(response.headers["content-length"]) !== response.body.length
      )
        unavailable();
      let html: string;
      try {
        html = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
      } catch {
        return unavailable();
      }
      return parsePreviewHtml(html, url);
    }
    return unavailable();
  } finally {
    clearTimeout(timeout);
  }
}
