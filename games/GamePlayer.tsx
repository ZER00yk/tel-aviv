"use client";
import { lazy, Suspense, useMemo } from "react";
import { GameSDK } from "@tell-aviv/game-sdk";
import { GameShell, type GamePreferences } from "@tell-aviv/game-runtime";
import { gameById } from "./catalog";
const clients = {
  incremental: lazy(() => import("./incremental/client")),
  "tower-defense": lazy(() => import("./tower-defense/client")),
  "party-games": lazy(() => import("./party-games/client")),
  casino: lazy(() => import("./casino/client")),
  tycoon: lazy(() => import("./tycoon/client")),
  "deck-roguelike": lazy(() => import("./deck-roguelike/client")),
  "ego-trip": lazy(() => import("./ego-trip/client")),
  "physics-sandbox": lazy(() => import("./physics-sandbox/client")),
  "social-deduction": lazy(() => import("./social-deduction/client")),
  "board-games": lazy(() => import("./board-games/client")),
};
export function GamePlayer({
  gameId,
  preferences,
}: {
  gameId: string;
  preferences?: GamePreferences;
}) {
  const sdk = useMemo(
    () => (gameById(gameId) ? new GameSDK(gameId) : null),
    [gameId],
  );
  const Client = clients[gameId as keyof typeof clients];
  if (!sdk || !Client) return <p>This game is unavailable.</p>;
  return (
    <GameShell key={gameId} sdk={sdk} preferences={preferences}>
      {(settings) => (
        <Suspense fallback={<p>Loading game…</p>}>
          <Client sdk={sdk} {...settings} />
        </Suspense>
      )}
    </GameShell>
  );
}
export default GamePlayer;
