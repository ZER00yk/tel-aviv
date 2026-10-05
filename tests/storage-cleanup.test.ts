import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ remove: vi.fn(), queue: vi.fn() }));
vi.mock("@tell-aviv/database", () => ({ db: backend.queue }));
vi.mock("../packages/storage/src/index", () => ({
  deleteFile: backend.remove,
}));

import { removeUncommittedFile } from "../packages/platform/src/storageCleanup";

describe("failed upload storage rollback", () => {
  beforeEach(() => {
    backend.remove.mockReset();
    backend.queue.mockReset();
  });

  it("does not queue bytes that were successfully deleted", async () => {
    backend.remove.mockResolvedValue(undefined);
    await removeUncommittedFile("c5b9a7b0-70bf-4cc8-bfdd-472e8988c5c3");
    expect(backend.remove).toHaveBeenCalledOnce();
    expect(backend.queue).not.toHaveBeenCalled();
  });

  it("preserves the exact key durably when physical deletion fails", async () => {
    backend.remove.mockRejectedValue(new Error("Storage unavailable"));
    backend.queue.mockResolvedValue([]);
    const key = "c5b9a7b0-70bf-4cc8-bfdd-472e8988c5c3";
    await expect(removeUncommittedFile(key)).resolves.toBeUndefined();
    expect(backend.queue).toHaveBeenCalledOnce();
    expect(backend.queue.mock.calls[0][1]).toBe(key);
  });

  it("exposes a failed retry-record write instead of silently losing the key", async () => {
    backend.remove.mockRejectedValue(new Error("Storage unavailable"));
    const databaseError = new Error("Database unavailable");
    backend.queue.mockRejectedValue(databaseError);
    await expect(
      removeUncommittedFile("c5b9a7b0-70bf-4cc8-bfdd-472e8988c5c3"),
    ).rejects.toBe(databaseError);
  });
});
