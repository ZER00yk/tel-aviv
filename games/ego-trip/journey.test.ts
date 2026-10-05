import { describe, expect, it } from "vitest";
import { arenaFor } from "./arena";
import {
  JOURNEY_RULES,
  journeyStageCount,
  journeyStageDefinition,
  type JourneyEnemyKind,
  type JourneyPoint,
} from "./journey";

describe("shared journey encounter definitions", () => {
  it("keeps every district's visible checkpoints reachable outside solid cover with substantial crossings", () => {
    const kinds = ["battle", "elite", "challenge", "environment", "survival", "protect", "trial", "miniboss", "boss"];
    for (let district = 0; district < 8; district++)
      for (const roomKind of kinds)
        for (let stage = 0; stage < journeyStageCount(roomKind, district); stage++) {
          const definition = journeyStageDefinition(roomKind, district, stage, 3);
          for (const point of definition.checkpoints) {
            expect(point.x).toBeGreaterThanOrEqual(20);
            expect(point.x).toBeLessThanOrEqual(880);
            expect(point.y).toBeGreaterThanOrEqual(20);
            expect(point.y).toBeLessThanOrEqual(540);
            for (const terrain of arenaFor(district).terrain)
              if (terrain.kind === "cover")
                expect(Math.hypot(point.x - terrain.x, point.y - terrain.y))
                  .toBeGreaterThan(terrain.radius + 24);
          }
          for (let checkpoint = 1; checkpoint < definition.checkpoints.length; checkpoint++) {
            const before = definition.checkpoints[checkpoint - 1];
            const next = definition.checkpoints[checkpoint];
            expect(Math.hypot(next.x - before.x, next.y - before.y)).toBeGreaterThanOrEqual(400);
          }
          expect(definition.squad.length).toBeGreaterThanOrEqual(8);
          expect(definition.squad.length).toBeLessThanOrEqual(10);
          expect(new Set(definition.squad).size).toBe(6);
        }
  });

  it("changes mission purposes and protects shared rules from mutation by saved encounter state", () => {
    const original = JSON.stringify(JOURNEY_RULES);
    const first = journeyStageDefinition("battle", 0, 0);
    const second = journeyStageDefinition("battle", 0, 1);
    expect(first.kind).not.toBe(second.kind);
    expect(first.checkpoints).not.toEqual(second.checkpoints);
    const fresh = journeyStageDefinition("battle", 0, 0);
    (first.checkpoints as JourneyPoint[])[0].x = 450;
    (first.squad as JourneyEnemyKind[]).pop();
    expect(journeyStageDefinition("battle", 0, 0)).toEqual(fresh);
    expect(JSON.stringify(JOURNEY_RULES)).toBe(original);
  });

  it("bounds corrupt or out-of-range itinerary indexes without creating invalid coordinates or unbounded squads", () => {
    for (const bad of [NaN, Infinity, -Infinity, -100, 1000000]) {
      const definition = journeyStageDefinition("unknown", bad, bad, bad);
      expect(definition.checkpoints.length).toBeGreaterThanOrEqual(3);
      expect(definition.checkpoints.length).toBeLessThanOrEqual(4);
      expect(definition.squad.length).toBeLessThanOrEqual(JOURNEY_RULES.maximumSquadSize);
      expect(definition.checkpoints.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    }
  });
});
