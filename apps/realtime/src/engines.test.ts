import { describe, expect, it } from "vitest";
import {
  applyGameAction,
  createLobby,
  lobbyView,
  startGame,
  tickGame,
  triviaQuestions,
  type DeductionState,
  type DrawingState,
  type MultiplayerGameId,
  type ReactionState,
  type TriviaState,
} from "./engines";

const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
];
function playing(gameId: MultiplayerGameId, count = 2) {
  const lobby = createLobby(
    { id: ids[0], username: "Ada" },
    gameId,
    "private",
    "ABC234",
    1000,
  );
  lobby.players = ids.slice(0, count).map((id, i) => ({
    id,
    username: `player${i}`,
    ready: true,
    connected: true,
  }));
  startGame(lobby, 1000);
  return lobby;
}
describe("authoritative multiplayer engines", () => {
  it("validates readiness, player count and connection before starting", () => {
    const lobby = createLobby(
      { id: ids[0], username: "Ada" },
      "social-deduction",
      "private",
      "ABC234",
    );
    expect(() => startGame(lobby)).toThrow("needs 4");
    lobby.players = ids.map((id) => ({
      id,
      username: "test",
      ready: true,
      connected: true,
    }));
    lobby.players[1].ready = false;
    expect(() => startGame(lobby)).toThrow("ready");
  });
  it("enforces turn order, rejects outsiders and detects four connected", () => {
    const lobby = playing("connect-four");
    expect(() =>
      applyGameAction(lobby, ids[1], { type: "drop", column: 0 }, 2000),
    ).toThrow("turn");
    expect(() =>
      applyGameAction(lobby, ids[2], { type: "drop", column: 0 }, 2000),
    ).toThrow("Join");
    for (let turn = 0; turn < 7; turn++)
      applyGameAction(
        lobby,
        ids[turn % 2],
        { type: "drop", column: turn % 2 === 0 ? 0 : 1 },
        2000 + turn,
      );
    expect(lobby.status).toBe("finished");
    expect(lobby.state?.result?.winners).toEqual([ids[0]]);
    expect(() =>
      applyGameAction(lobby, ids[1], { type: "drop", column: 3 }),
    ).toThrow("not running");
  });
  it("does not expose future quiz answers and permits only one answer per round", () => {
    const lobby = playing("trivia"),
      state = lobby.state as TriviaState;
    const view = lobbyView(lobby, ids[0], 1000).state as Record<
      string,
      unknown
    >;
    expect(view).not.toHaveProperty("questions");
    expect(view).not.toHaveProperty("correct");
    const correct = triviaQuestions[state.questions[0]].correct;
    applyGameAction(lobby, ids[0], { type: "answer", answer: correct }, 2000);
    expect(() =>
      applyGameAction(lobby, ids[0], { type: "answer", answer: correct }, 2001),
    ).toThrow("already");
    applyGameAction(
      lobby,
      ids[1],
      { type: "answer", answer: (correct + 1) % 4 },
      2002,
    );
    tickGame(lobby, 2003);
    expect(state.round).toBe(1);
    expect(state.previous?.correct).toBe(correct);
    expect(state.scores[ids[0]]).toBeGreaterThan(state.scores[ids[1]]);
  });
  it("keeps the reaction signal time secret and penalizes early presses", () => {
    const lobby = playing("reaction"),
      state = lobby.state as ReactionState;
    const view = lobbyView(lobby, ids[0], 1001).state as Record<
      string,
      unknown
    >;
    expect(view).not.toHaveProperty("signalAt");
    expect(view.deadline).toBeUndefined();
    expect(view.signal).toBe(false);
    applyGameAction(
      lobby,
      ids[0],
      { type: "react", elapsed: 0 },
      state.signalAt - 100,
    );
    expect(state.scores[ids[0]]).toBe(-50);
    applyGameAction(lobby, ids[1], { type: "react" }, state.signalAt + 50);
    expect(state.scores[ids[1]]).toBe(98);
  });
  it("only sends the drawing word to the drawer and validates canvas mutations", () => {
    const lobby = playing("drawing"),
      state = lobby.state as DrawingState;
    expect(
      (lobbyView(lobby, ids[0]).state as Record<string, unknown>).word,
    ).toBe(state.word);
    expect(
      (lobbyView(lobby, ids[1]).state as Record<string, unknown>).word,
    ).toBeUndefined();
    expect(() =>
      applyGameAction(
        lobby,
        ids[1],
        { type: "stroke", points: [{ x: 1, y: 2 }], color: "#ffffff" },
        2000,
      ),
    ).toThrow("drawer");
    expect(() =>
      applyGameAction(
        lobby,
        ids[0],
        { type: "stroke", points: [{ x: 900, y: 2 }], color: "#ffffff" },
        2000,
      ),
    ).toThrow();
    applyGameAction(lobby, ids[1], { type: "guess", text: state.word }, 2000);
    expect(state.scores[ids[1]]).toBeGreaterThan(100);
  });
  it("partitions hidden roles and votes, checks proximity and movement speed", () => {
    const lobby = playing("social-deduction", 4),
      state = lobby.state as DeductionState;
    const hostileId = Object.keys(state.players).find(
      (id) => state.players[id].role === "hostile",
    )!;
    const crewId = Object.keys(state.players).find(
      (id) => state.players[id].role === "crew",
    )!;
    const crewView = lobbyView(lobby, crewId).state as {
      players: Record<string, unknown>[];
      allies: string[];
      self: Record<string, unknown>;
    };
    expect(
      crewView.players.every((p) => !("role" in p) && !("tasks" in p)),
    ).toBe(true);
    expect(crewView.allies).toEqual([]);
    expect(crewView.self.role).toBe("crew");
    const hostileView = lobbyView(lobby, hostileId).state as {
      allies: string[];
    };
    expect(hostileView.allies).toContain(hostileId);
    expect(() => lobbyView(lobby, "outsider")).toThrow("Join");
    expect(() =>
      applyGameAction(lobby, crewId, { type: "sabotage" }, 20_000),
    ).toThrow("hostile");
    expect(() =>
      applyGameAction(
        lobby,
        crewId,
        { type: "task", taskId: state.players[crewId].tasks[0] },
        20_000,
      ),
    ).toThrow("near");
    applyGameAction(lobby, crewId, { type: "move", dx: 1, dy: 1 }, 20_000);
    expect(() =>
      applyGameAction(lobby, crewId, { type: "move", dx: 1, dy: 1 }, 20_001),
    ).toThrow("frequent");
    state.players[crewId].x = 50;
    state.players[crewId].y = 50;
    applyGameAction(lobby, crewId, { type: "meeting" }, 21_000);
    applyGameAction(
      lobby,
      hostileId,
      { type: "vote", targetId: crewId },
      21_100,
    );
    const meetingView = lobbyView(lobby, crewId).state as Record<
      string,
      unknown
    >;
    expect(meetingView).not.toHaveProperty("votes");
    expect(meetingView.yourVote).toBeUndefined();
    expect(() =>
      applyGameAction(
        lobby,
        hostileId,
        { type: "vote", targetId: "skip" },
        21_101,
      ),
    ).toThrow("already");
  });
  it("resolves meeting ties and sabotage expiry on server time", () => {
    const lobby = playing("social-deduction", 4),
      state = lobby.state as DeductionState;
    state.phase = "meeting";
    state.meetingUntil = 2000;
    state.votes = { [ids[0]]: ids[1], [ids[1]]: ids[0] };
    tickGame(lobby, 2001);
    expect(state.lastMeeting?.ejectedId).toBeNull();
    expect(state.phase).toBe("running");
    state.sabotageUntil = 3000;
    tickGame(lobby, 3001);
    expect(lobby.status).toBe("finished");
    expect(state.result?.reason).toBe("Beacon failed");
  });
});
