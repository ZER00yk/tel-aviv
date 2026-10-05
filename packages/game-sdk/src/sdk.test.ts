import { afterEach, it, expect, vi } from "vitest";
import { GameSDK } from "./index";
afterEach(() => vi.unstubAllGlobals());
it("restricts the identity exposed to games", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              id: "id",
              username: "friend",
              displayName: "Friend",
              avatar: null,
              role: "owner",
              privateSchoolDocuments: ["secret"],
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  expect(await new GameSDK("ego-trip").user()).toEqual({
    id: "id",
    username: "friend",
    displayName: "Friend",
    avatar: null,
  });
});
it("enforces manifest write permissions before making a request", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(new GameSDK("casino").save({ credits: 10000 })).rejects.toThrow(
    "permission denied",
  );
  expect(fetch).not.toHaveBeenCalled();
});
it("namespaces cloud saves and carries the loaded optimistic revision", async () => {
  const fetch = vi.fn(
    async (_url: string, options: RequestInit) =>
      new Response(
        JSON.stringify({
          data: {
            data: { score: 2 },
            schemaVersion: 1,
            revision: options.method === "POST" ? 8 : 7,
            updatedAt: null,
            authoritative: false,
          },
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const sdk = new GameSDK("ego-trip");
  await sdk.load();
  await sdk.save({ score: 3 });
  expect(fetch.mock.calls[0][0]).toBe("/api/games/ego-trip/save");
  expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toEqual({
    data: { score: 3 },
    schemaVersion: 1,
    expectedRevision: 7,
  });
});
it("propagates a save conflict and preserves the old revision", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Save conflict" }), {
          status: 409,
        }),
    ),
  );
  await expect(
    new GameSDK("physics-sandbox").save({ version: 1 }),
  ).rejects.toThrow("Save conflict");
});
