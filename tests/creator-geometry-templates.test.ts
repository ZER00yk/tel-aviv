import { describe, expect, it } from "vitest";
import {
  levelTemplate,
  templateChoices,
} from "../apps/web/components/creator/templates";
import { levelSchema } from "../packages/creator-runtime/src/schema";
import { replayInputs } from "../packages/creator-runtime/src/physics";
describe("Creator playable geometry templates", () => {
  it("keeps all six editable templates valid", () => {
    expect(templateChoices).toHaveLength(6);
    for (const template of templateChoices)
      expect(levelSchema.safeParse(levelTemplate(template.id)).success).toBe(
        true,
      );
  });
  it("traverses the geometry course with real movement and jumps", () => {
    const value = levelTemplate("geometry");
    const state = replayInputs(value, [
      { keys: ["ArrowRight", " "], ticks: 300 },
      { keys: ["ArrowRight", " "], ticks: 300 },
    ]);
    expect(state.won).toBe(true);
    expect(state.deaths).toBe(0);
  });
  it("drives the rail cart, waits for contact chains, breaks the wall and reaches the finish", () => {
    const value = levelTemplate("cart-blast");
    const state = replayInputs(value, [
      { keys: ["e"], ticks: 1 },
      { keys: ["ArrowRight"], ticks: 300 },
      { keys: ["ArrowRight"], ticks: 180 },
    ]);
    expect(state.won).toBe(true);
    expect(state.vehicleId).not.toBeNull();
    expect(state.deaths).toBe(0);
    expect(state.health).toBe(80);
    expect(state.destroyed).toContain(
      value.objects.find((object) => object.type === "destructible")!.id,
    );
    expect(
      value.objects
        .filter((object) => object.type === "explosive")
        .every((object) => state.destroyed.includes(object.id)),
    ).toBe(true);
  });
});
