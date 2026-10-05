import { describe, expect, it } from "vitest";
import { newCampaignWorld } from "../ego-trip/engine";
import {
  actEgoRanked,
  newEgoRanked,
  neutralRankedInput,
  rankedStatistics,
} from "./ego-ranked";

describe("authoritative ranked forty-room campaign", () => {
  it("rejects skipped rooms, invented routes, event outcomes and duplicate transitions", () => {
    const state = newEgoRanked(
      "pulse",
      81,
      1000,
      "standard",
      [],
      null,
      "campaign",
    );
    expect(state.world.enemies.length).toBeGreaterThan(0);
    expect(() =>
      actEgoRanked(state, "route", { id: "39:boss:0" }, 1050),
    ).toThrow("offered");
    expect(() =>
      actEgoRanked(state, "event", { choice: "safe", completion: true }, 1050),
    ).toThrow("unavailable");
    expect(() => actEgoRanked(state, "continue", {}, 1050)).toThrow("Finish");
    state.world.campaign!.roomIndex = 39;
    expect(() =>
      actEgoRanked(state, "input", { ...neutralRankedInput }, 1050),
    ).toThrow("inconsistent");
  });

  it("requires all forty canonical room transitions and eight boss defeats for restored compact runs", () => {
    const state = newEgoRanked(
      "pulse",
      481,
      1000,
      "standard",
      [],
      null,
      "campaign",
    );
    expect(state.world.campaign!.pacingVersion).toBe(1);
    // Restore the compact checkpoint format this transition contract predates.
    // Paced combat/traversal gates are exercised by the journey engine tests.
    state.world = newCampaignWorld("pulse", 481, { pacingVersion: null });
    let now = 1000;
    for (
      let safety = 0;
      safety < 250 && state.world.stage !== "won";
      safety++
    ) {
      const stage = state.world.stage;
      if (stage === "fight") {
        // This fixture shortens only server-owned targets. Kills, route and rewards still come from the engine.
        state.world.boss.hp = 0;
        if (state.world.campaign?.objective)
          state.world.campaign.objective.progress =
            state.world.campaign.objective.target;
        for (const enemy of state.world.enemies) {
          enemy.hp = 0;
          enemy.spawned = true;
        }
        actEgoRanked(state, "input", { ...neutralRankedInput }, (now += 100));
      } else if (stage === "choice")
        actEgoRanked(
          state,
          "mod",
          { id: state.world.offered[0] },
          (now += 100),
        );
      else if (stage === "route") {
        const id = state.world.campaign!.routes[0].id;
        actEgoRanked(state, "route", { id }, (now += 100));
        expect(() => actEgoRanked(state, "route", { id }, (now += 1))).toThrow(
          "offered",
        );
      } else if (stage === "shop")
        actEgoRanked(state, "continue", {}, (now += 100));
      else if (stage === "event")
        actEgoRanked(state, "event", { choice: "safe" }, (now += 100));
      else throw new Error(`Unexpected ${stage}`);
    }
    expect(state.world.stage).toBe("won");
    expect(state.world.kills).toBe(8);
    expect(state.world.campaign!.cleared).toBe(40);
    expect(state.world.campaign!.path).toHaveLength(40);
    expect(rankedStatistics(state)).toMatchObject({
      mode: "campaign",
      roomsCleared: 40,
      deaths: 0,
    });
  });

  it("freezes campaign reconnects and removes helper grants in a no-helper challenge", () => {
    const state = newEgoRanked(
      "pulse",
      481,
      1000,
      "standard",
      ["no-helper"],
      null,
      "campaign",
    );
    actEgoRanked(state, "input", { ...neutralRankedInput, attack: true }, 1050);
    const snapshot = JSON.stringify(state.world);
    actEgoRanked(state, "input", { ...neutralRankedInput }, 5000);
    expect(JSON.stringify(state.world)).toBe(snapshot);
    expect(state.idleMs).toBe(3950);
    const c = state.world.campaign!;
    c.room.kind = "helper";
    c.path[0] = "helper";
    state.world.stage = "event";
    expect(() =>
      actEgoRanked(state, "event", { choice: "medic" }, 5100),
    ).toThrow("unavailable");
    actEgoRanked(state, "event", { choice: "safe" }, 5100);
    expect(state.world.helper).toBeNull();
    expect(c.cleared).toBe(1);
  });
});
