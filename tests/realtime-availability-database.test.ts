import { afterAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { closeDatabase, db } from "@tell-aviv/database";
import {
  catalogGameId,
  disabledMultiplayerGames,
  requireMultiplayerAvailable,
} from "../apps/realtime/src/availability";
import type { MultiplayerGameId } from "../apps/realtime/src/engines";

it("maps lobby modes to the catalog switches users see", () => {
  expect(catalogGameId("connect-four")).toBe("board-games");
  for (const id of ["trivia", "reaction", "drawing"] as const)
    expect(catalogGameId(id)).toBe("party-games");
  expect(catalogGameId("ego-trip")).toBe("ego-trip");
  expect(catalogGameId("social-deduction")).toBe("social-deduction");
});

describe.skipIf(process.env.RUN_DB_TESTS !== "true")(
  "multiplayer availability SQL",
  () => {
    afterAll(closeDatabase);
    it("reads disabled aliases and re-enabled games without committing global flags", async () => {
      const rollback = new Error("ROLLBACK_ONLY_FIXTURE");
      await expect(
        db.begin(async (transaction) => {
          const tx = transaction as unknown as Sql;
          for (const gameId of [
            "board-games",
            "party-games",
            "ego-trip",
            "social-deduction",
          ]) {
            await tx`INSERT INTO platform_flags(key,enabled) VALUES(${`games.${gameId}`},false) ON CONFLICT(key) DO UPDATE SET enabled=false`;
          }
          for (const mode of [
            "connect-four",
            "trivia",
            "reaction",
            "drawing",
            "ego-trip",
            "social-deduction",
          ] as MultiplayerGameId[]) {
            await expect(requireMultiplayerAvailable(mode, tx)).rejects.toThrow(
              "temporarily disabled",
            );
          }
          const disabled = await disabledMultiplayerGames(tx);
          expect(disabled.has("board-games")).toBe(true);
          expect(disabled.has("ego-trip")).toBe(true);
          await tx`UPDATE platform_flags SET enabled=true WHERE key='games.ego-trip'`;
          await expect(
            requireMultiplayerAvailable("ego-trip", tx),
          ).resolves.toBeUndefined();
          expect((await disabledMultiplayerGames(tx)).has("ego-trip")).toBe(
            false,
          );
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    });
  },
);
