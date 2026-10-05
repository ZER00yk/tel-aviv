import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import {
  createCheckers,
  legalCheckersMoves,
  moveCheckers,
  sideOf,
  type CheckerPiece,
} from "./checkers";
import {
  applyBoardGameAction,
  boardGameView,
  createBoardGame,
  restoreChess,
  type BoardGameState,
} from "./host";
import {
  createLobby,
  startGame,
  applyGameAction,
  lobbyView,
  playerLimits,
} from "../../apps/realtime/src/engines";
const ids = ["white", "black"];
const index = (s: string) => (8 - Number(s[1])) * 8 + s.charCodeAt(0) - 97;
function setupCheckers(pieces: Record<string, CheckerPiece>) {
  const s = createCheckers();
  s.board = Array(64).fill(0);
  for (const [square, piece] of Object.entries(pieces))
    s.board[index(square)] = piece;
  return s;
}
function chessPosition(fen: string) {
  const s = createBoardGame("chess", ids);
  if (s.kind === "chess") s.position = { initialFen: fen, moves: [], fen };
  return s;
}
function move(s: BoardGameState, from: string, to: string, promotion?: string) {
  const view = boardGameView(s, ids[0]);
  applyBoardGameAction(s, view.turn, {
    type: "board:move",
    from,
    to,
    ...(promotion ? { promotion } : {}),
  });
}
describe("reusable board rules and authoritative host", () => {
  it("starts checkers with twelve pieces each and seven forward legal opening moves", () => {
    const s = createCheckers();
    expect(s.board.filter((p) => sideOf(p) === 1)).toHaveLength(12);
    expect(s.board.filter((p) => sideOf(p) === 2)).toHaveLength(12);
    expect(legalCheckersMoves(s)).toHaveLength(7);
    const next = moveCheckers(s, index("c3"), index("d4"));
    expect(next.turn).toBe(2);
    expect(next.board[index("d4")]).toBe(1);
    expect(s.board[index("c3")]).toBe(1);
  });
  it("requires captures and the same piece across a multi-jump", () => {
    const s = setupCheckers({ c3: 1, h2: 1, d4: 2, f6: 2, h8: 2 });
    expect(legalCheckersMoves(s)).toEqual([
      { from: index("c3"), to: index("e5"), captured: index("d4") },
    ]);
    expect(() => moveCheckers(s, index("h2"), index("g3"))).toThrow(
      "mandatory",
    );
    const chain = moveCheckers(s, index("c3"), index("e5"));
    expect(chain.turn).toBe(1);
    expect(chain.forcedFrom).toBe(index("e5"));
    expect(chain.board[index("d4")]).toBe(0);
    expect(() => moveCheckers(chain, index("h2"), index("g3"))).toThrow(
      "chain",
    );
    const end = moveCheckers(chain, index("e5"), index("g7"));
    expect(end.turn).toBe(2);
    expect(end.forcedFrom).toBeNull();
    expect(end.board[index("f6")]).toBe(0);
  });
  it("men cannot jump backwards, kings can, and promotion stops the jump sequence", () => {
    const backward = setupCheckers({ e5: 1, d4: 2, h8: 2 });
    expect(legalCheckersMoves(backward).some((m) => m.to === index("c3"))).toBe(
      false,
    );
    backward.board[index("e5")] = 3;
    expect(legalCheckersMoves(backward).some((m) => m.to === index("c3"))).toBe(
      true,
    );
    const promotion = setupCheckers({ b6: 1, c7: 2, e7: 2, h8: 2 });
    const king = moveCheckers(promotion, index("b6"), index("d8"));
    expect(king.board[index("d8")]).toBe(3);
    expect(king.turn).toBe(2);
    expect(king.forcedFrom).toBeNull();
  });
  it("detects elimination, blocked positions and repeat-position draws", () => {
    const s = setupCheckers({ c3: 1, d4: 2 });
    expect(moveCheckers(s, index("c3"), index("e5")).outcome?.winner).toBe(1);
    const repeated = setupCheckers({ a1: 3, h8: 4 });
    let current = repeated;
    for (let cycle = 0; cycle < 3 && !current.outcome; cycle++)
      for (const [from, to] of [
        ["a1", "b2"],
        ["h8", "g7"],
        ["b2", "a1"],
        ["g7", "h8"],
      ]) {
        current = moveCheckers(current, index(from), index(to));
        if (current.outcome) break;
      }
    expect(current.outcome?.reason).toBe("Threefold repetition");
  });
  it("rejects wrong-turn players, invalid coordinates, forged outcomes and illegal chess moves", () => {
    const s = createBoardGame("chess", ids);
    expect(() =>
      applyBoardGameAction(s, "outsider", { type: "board:resign" }),
    ).toThrow("Join");
    expect(() =>
      applyBoardGameAction(s, "black", {
        type: "board:move",
        from: "e7",
        to: "e5",
      }),
    ).toThrow("turn");
    expect(() =>
      applyBoardGameAction(s, "white", {
        type: "board:move",
        from: "e2",
        to: "e5",
      }),
    ).toThrow("legal");
    expect(() =>
      applyBoardGameAction(s, "white", {
        type: "board:move",
        from: "e2",
        to: "e4",
        score: 999,
      }),
    ).toThrow();
    expect(() =>
      applyBoardGameAction(s, "white", {
        type: "board:move",
        from: "e2",
        to: "z99",
      }),
    ).toThrow();
    move(s, "e2", "e4");
    expect(boardGameView(s, "white").legalMoves).toEqual([]);
    expect(boardGameView(s, "black").legalMoves.length).toBeGreaterThan(0);
  });
  it("implements legal castling and rejects castling through an attacked square", () => {
    const s = chessPosition("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    move(s, "e1", "g1");
    if (s.kind !== "chess") throw new Error();
    const chess = restoreChess(s.position);
    expect(chess.get("g1")?.type).toBe("k");
    expect(chess.get("f1")?.type).toBe("r");
    const attacked = chessPosition("r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1");
    expect(() => move(attacked, "e1", "g1")).toThrow("legal");
  });
  it("preserves en passant and explicit underpromotion", () => {
    const s = createBoardGame("chess", ids);
    for (const [from, to] of [
      ["e2", "e4"],
      ["a7", "a6"],
      ["e4", "e5"],
      ["d7", "d5"],
      ["e5", "d6"],
    ])
      move(s, from, to);
    if (s.kind !== "chess") throw new Error();
    expect(restoreChess(s.position).get("d5")).toBeUndefined();
    expect(restoreChess(s.position).get("d6")?.type).toBe("p");
    const promoted = chessPosition("7k/P7/8/8/8/8/8/7K w - - 0 1");
    move(promoted, "a7", "a8", "n");
    if (promoted.kind !== "chess") throw new Error();
    expect(restoreChess(promoted.position).get("a8")?.type).toBe("n");
    expect(promoted.result?.reason).toBe("Insufficient material");
  });
  it("records checkmate and restores exact repetition history from a JSON snapshot", () => {
    const mate = createBoardGame("chess", ids);
    for (const [from, to] of [
      ["f2", "f3"],
      ["e7", "e5"],
      ["g2", "g4"],
      ["d8", "h4"],
    ])
      move(mate, from, to);
    expect(mate.result?.winners).toEqual(["black"]);
    expect(mate.result?.reason).toBe("Checkmate");
    let repetition = createBoardGame("chess", ids);
    for (let loop = 0; loop < 2; loop++) {
      for (const [from, to] of [
        ["g1", "f3"],
        ["g8", "f6"],
        ["f3", "g1"],
        ["f6", "g8"],
      ])
        move(repetition, from, to);
      repetition = JSON.parse(JSON.stringify(repetition)) as BoardGameState;
    }
    expect(repetition.result?.reason).toBe("Threefold repetition");
  });
  it("requires two accounts to agree a draw and permits resignation", () => {
    const s = createBoardGame("checkers", ids);
    applyBoardGameAction(s, "white", { type: "board:draw" });
    expect(s.result).toBeUndefined();
    expect(() =>
      applyBoardGameAction(s, "white", { type: "board:draw" }),
    ).toThrow("pending");
    applyBoardGameAction(s, "black", { type: "board:draw" });
    expect(s.result?.winners).toEqual([]);
    expect(s.result?.reason).toBe("Draw agreed by both players");
    const resigned = createBoardGame("chess", ids);
    applyBoardGameAction(resigned, "white", { type: "board:resign" });
    expect(resigned.result?.winners).toEqual(["black"]);
  });
  it("registers both variants in existing two-account lobby and outcome pipeline", () => {
    for (const kind of ["chess", "checkers"] as const) {
      expect(playerLimits(kind)).toEqual({ min: 2, max: 2 });
      const lobby = createLobby(
        { id: "white", username: "White" },
        kind,
        "private",
        "ABC234",
        1000,
      );
      lobby.players = [
        { id: "white", username: "White", ready: true, connected: true },
        { id: "black", username: "Black", ready: true, connected: true },
      ];
      startGame(lobby, 1000);
      const view = lobbyView(lobby, "white").state as { kind: string };
      expect(view.kind).toBe(kind);
      applyGameAction(lobby, "black", { type: "board:resign" }, 1001);
      expect(lobby.status).toBe("finished");
      expect(lobby.state?.result?.winners).toEqual(["white"]);
    }
    expect(new Chess().moves()).toHaveLength(20);
  });
});
