import { describe, expect, it } from "vitest";
import {
  levelSchema,
  resourceData,
  scoreQuiz,
  starterLevel,
  type LevelData,
  type LevelObject,
} from "../packages/platform/src/classes/models";
import {
  doorIsOpen,
  initialPlayer,
  objectAtTime,
  stepPlayer,
  type PlayerState,
} from "../apps/web/components/creator/physics";
describe("school data validation", () => {
  it("grades short answers without case or whitespace differences", () => {
    const quiz = resourceData.quiz.parse({
      questions: [
        { prompt: "Capital?", type: "short-answer", answer: "Paris" },
        { prompt: "True?", type: "true-false", answer: "true" },
      ],
    });
    expect(scoreQuiz(quiz, [" PARIS ", "FALSE"])).toMatchObject({
      score: 1,
      total: 2,
    });
  });
  it("rejects executable or unexpected data and unsafe URLs", () => {
    expect(
      resourceData.note.safeParse({ markdown: "# Notes", script: "alert(1)" })
        .success,
    ).toBe(false);
    expect(
      resourceData.link.safeParse({ url: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(
      resourceData.assignment.safeParse({ links: ["data:text/html,hi"] })
        .success,
    ).toBe(false);
  });
  it("requires multiple choice answers to match available options", () => {
    expect(
      resourceData.quiz.safeParse({
        questions: [
          {
            prompt: "Q",
            type: "multiple-choice",
            options: ["A", "B"],
            answer: "C",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
describe("safe versioned creator levels", () => {
  it("rejects scripts, duplicate object IDs and outside-level objects", () => {
    const level = starterLevel();
    expect(levelSchema.safeParse({ ...level, script: "evil()" }).success).toBe(
      false,
    );
    expect(
      levelSchema.safeParse({
        ...level,
        objects: [level.objects[0], level.objects[0]],
      }).success,
    ).toBe(false);
    expect(
      levelSchema.safeParse({
        ...level,
        objects: [{ ...level.objects[0], x: 950 }],
      }).success,
    ).toBe(false);
  });
  it("validates the playable starter level and lands on terrain", () => {
    const level = levelSchema.parse(starterLevel());
    let player = initialPlayer(level);
    for (let i = 0; i < 120; i++)
      player = stepPlayer(level, player, new Set(), 1 / 60);
    expect(player.grounded).toBe(true);
    expect(player.y).toBe(472);
  });
  it("handles jumping, hazards, checkpoints and completion", () => {
    const level = starterLevel();
    let player = { ...initialPlayer(level), y: 472, grounded: true };
    player = stepPlayer(level, player, new Set([" "]), 1 / 60);
    expect(player.vy).toBeLessThan(0);
    expect(player.grounded).toBe(false);
    player = stepPlayer(
      level,
      { ...player, x: 885, y: 445 },
      new Set(),
      1 / 60,
    );
    expect(player.won).toBe(true);
    const hazard = {
      ...level,
      objects: [{ ...level.objects[1], type: "spikes" as const }],
    };
    player = stepPlayer(
      hazard,
      { ...initialPlayer(hazard), x: 885, y: 445 },
      new Set(),
      1 / 60,
    );
    expect(player.deaths).toBe(1);
    expect(player.x).toBe(hazard.spawn.x);
  });
});

const doorId = "00000000-0000-4000-8000-000000000010";
const buttonId = "00000000-0000-4000-8000-000000000011";
const movingId = "00000000-0000-4000-8000-000000000012";
function controlLevel(mode: "hold" | "toggle" = "hold"): LevelData {
  return {
    ...starterLevel(),
    objects: [
      starterLevel().objects[0],
      {
        id: doorId,
        type: "door",
        x: 300,
        y: 400,
        width: 40,
        height: 100,
        rotation: 0,
        layer: 0,
      },
      {
        id: buttonId,
        type: "button",
        x: 100,
        y: 480,
        width: 60,
        height: 20,
        rotation: 0,
        layer: 0,
        buttonMode: mode,
        targetIds: [doorId],
      },
    ],
  };
}
const movingPlatform: LevelObject = {
  id: movingId,
  type: "moving-platform",
  x: 100,
  y: 200,
  width: 120,
  height: 20,
  rotation: 0,
  layer: 0,
  motion: { axis: "x", distance: 160, periodSeconds: 4 },
};

describe("bounded creator motion and control connections", () => {
  it("accepts old schema-v1 levels and valid button-to-door connections", () => {
    expect(levelSchema.safeParse(starterLevel()).success).toBe(true);
    expect(levelSchema.safeParse(controlLevel()).success).toBe(true);
    expect(
      levelSchema.safeParse({ ...starterLevel(), objects: [movingPlatform] })
        .success,
    ).toBe(true);
  });
  it("rejects dangling, repeated, wrong-type and excessive control connections", () => {
    const level = controlLevel();
    const button = level.objects[2];
    const withButton = (patch: Partial<LevelObject>) => ({
      ...level,
      objects: [...level.objects.slice(0, 2), { ...button, ...patch }],
    });
    expect(
      levelSchema.safeParse(withButton({ targetIds: [movingId] })).success,
    ).toBe(false);
    expect(
      levelSchema.safeParse(withButton({ targetIds: [level.objects[0].id] }))
        .success,
    ).toBe(false);
    expect(
      levelSchema.safeParse(withButton({ targetIds: [doorId, doorId] }))
        .success,
    ).toBe(false);
    expect(
      levelSchema.safeParse(
        withButton({ targetIds: Array.from({ length: 17 }, () => doorId) }),
      ).success,
    ).toBe(false);
    expect(
      levelSchema.safeParse({
        ...level,
        objects: [
          { ...level.objects[0], targetIds: [doorId] },
          ...level.objects.slice(1),
        ],
      }).success,
    ).toBe(false);
  });
  it("checks the full movement path and allows only bounded built-in settings", () => {
    const test = (patch: Record<string, unknown>) =>
      levelSchema.safeParse({
        ...starterLevel(),
        objects: [{ ...movingPlatform, ...patch }],
      }).success;
    expect(test({ motion: undefined })).toBe(false);
    expect(
      test({ motion: { axis: "x", distance: 800, periodSeconds: 4 } }),
    ).toBe(false);
    expect(
      test({ motion: { axis: "y", distance: -201, periodSeconds: 4 } }),
    ).toBe(false);
    expect(
      test({ motion: { axis: "x", distance: 20, periodSeconds: 0.01 } }),
    ).toBe(false);
    expect(
      test({
        motion: { axis: "x", distance: 20, periodSeconds: 4, script: "run()" },
      }),
    ).toBe(false);
    expect(
      test({ motion: { axis: "y", distance: -100, periodSeconds: 2 } }),
    ).toBe(true);
  });
  it("moves out and back deterministically and carries a grounded player", () => {
    expect(objectAtTime(movingPlatform, 0).x).toBe(100);
    expect(objectAtTime(movingPlatform, 2).x).toBe(260);
    expect(objectAtTime(movingPlatform, 4).x).toBe(100);
    const level = {
      ...starterLevel(),
      spawn: { x: 110, y: 172 },
      objects: [movingPlatform],
    };
    let player: PlayerState = {
      ...initialPlayer(level),
      grounded: true,
      supportId: movingId,
    };
    for (let index = 0; index < 60; index++)
      player = stepPlayer(level, player, new Set(), 1 / 60);
    expect(player.x).toBeCloseTo(190, 5);
    expect(player.y).toBe(172);
    expect(player.grounded).toBe(true);
    expect(player.supportId).toBe(movingId);
  });
  it("opens a hold door only while its pressure plate is pressed", () => {
    const level = controlLevel();
    let player = stepPlayer(
      level,
      { ...initialPlayer(level), x: 110, y: 452 },
      new Set(),
      1 / 60,
    );
    expect(player.pressedButtons).toEqual([buttonId]);
    expect(doorIsOpen(level, doorId, player)).toBe(true);
    player = stepPlayer(level, { ...player, x: 200 }, new Set(), 1 / 60);
    expect(doorIsOpen(level, doorId, player)).toBe(false);
  });
  it("toggles once per new press and collides with closed doors", () => {
    const level = controlLevel("toggle");
    let player = stepPlayer(
      level,
      { ...initialPlayer(level), x: 110, y: 452 },
      new Set(),
      1 / 60,
    );
    player = stepPlayer(level, player, new Set(), 1 / 60);
    expect(doorIsOpen(level, doorId, player)).toBe(true);
    player = stepPlayer(level, { ...player, x: 200 }, new Set(), 1 / 60);
    expect(doorIsOpen(level, doorId, player)).toBe(true);
    player = stepPlayer(
      level,
      { ...player, x: 110, y: 452 },
      new Set(),
      1 / 60,
    );
    expect(doorIsOpen(level, doorId, player)).toBe(false);
    const blocked = stepPlayer(
      level,
      { ...initialPlayer(level), x: 280, y: 450 },
      new Set(["ArrowRight"]),
      1 / 60,
    );
    expect(blocked.x).toBe(280);
    const passing = stepPlayer(
      level,
      { ...blocked, toggledButtons: [buttonId] },
      new Set(["ArrowRight"]),
      1 / 60,
    );
    expect(passing.x).toBeGreaterThan(280);
  });
});
