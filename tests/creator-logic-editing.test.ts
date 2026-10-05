import { describe, expect, it } from "vitest";
import {
  levelSchema,
  normalizeLevel,
  starterLevel,
  type LogicBlock,
} from "../packages/platform/src/classes/models";
import {
  logicReferenceErrors,
  objectLabel,
  renameVariable,
} from "../apps/web/components/creator/logicEditing";

describe("visual logic editing preserves references", () => {
  function fixture() {
    const level = normalizeLevel(starterLevel());
    level.variables = [{ name: "score", type: "number", initial: 0 }];
    const block: LogicBlock = {
      id: "00000000-0000-4000-8000-000000000010",
      label: "Progress gate",
      event: { type: "variable-reaches", variable: "score", value: 2 },
      condition: {
        type: "and",
        conditions: [
          { type: "variable", variable: "score", operator: "gte", value: 2 },
          {
            type: "or",
            conditions: [
              { type: "variable", variable: "score", operator: "eq", value: 3 },
            ],
          },
        ],
      },
      actions: [
        { type: "add-variable", variable: "score", amount: 1 },
        { type: "set-variable", variable: "score", value: 4 },
        { type: "enable", objectId: level.objects[0].id },
      ],
    };
    level.logic = [block];
    return level;
  }

  it("renames a variable and nested references in one reversible level snapshot", () => {
    const original = fixture();
    const renamed = renameVariable(original, "score", "keys_found");
    expect(levelSchema.safeParse(renamed).success).toBe(true);
    expect(JSON.stringify(renamed)).not.toContain('"score"');
    expect(original.variables[0].name).toBe("score");
    expect(renameVariable(renamed, "keys_found", "score")).toEqual(original);
    expect(renamed.logic?.[0].actions[2]).toEqual(original.logic[0].actions[2]);
  });

  it("identifies a deleted scene object and variable inside nested logic for repair", () => {
    const original = fixture();
    const broken = {
      ...original,
      variables: [],
      objects: original.objects.slice(1),
    };
    const errors = logicReferenceErrors(broken);
    expect(
      errors.some((error) => error.message.includes("Missing scene object")),
    ).toBe(true);
    expect(errors.some((error) => error.message.includes("score"))).toBe(true);
    expect(new Set(errors.map((error) => error.blockId))).toEqual(
      new Set([original.logic[0].id]),
    );
    expect(logicReferenceErrors(original)).toEqual([]);
    expect(levelSchema.safeParse(broken).success).toBe(false);
  });

  it("uses meaningful labels and coordinates for scene references", () => {
    const level = fixture();
    expect(
      objectLabel({ ...level.objects[0], label: "Ground" }, level.objects),
    ).toBe("Ground · 0, 500");
    expect(objectLabel(level.objects[1], level.objects)).toBe(
      "finish 1 · 880, 440",
    );
  });
});
