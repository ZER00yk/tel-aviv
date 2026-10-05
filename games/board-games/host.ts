import {
  Chess,
  type Square,
  type PieceSymbol,
  DEFAULT_POSITION,
} from "chess.js";
import { z } from "zod";
import {
  BoardRuleError,
  createCheckers,
  legalCheckersMoves,
  moveCheckers,
  checkerSquare,
  sideOf,
  isKing,
  type CheckersPosition,
  type CheckerSide,
} from "./checkers";
export const boardVariants = ["checkers", "chess"] as const;
export type BoardVariant = (typeof boardVariants)[number];
interface ChessMove {
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
}
export interface ChessPosition {
  initialFen: string;
  moves: ChessMove[];
  fen: string;
}
interface BoardResult {
  winners: string[];
  scores: Record<string, number>;
  reason: string;
}
export type BoardGameState =
  | {
      kind: "checkers";
      players: [string, string];
      position: CheckersPosition;
      drawOffer?: string;
      result?: BoardResult;
    }
  | {
      kind: "chess";
      players: [string, string];
      position: ChessPosition;
      drawOffer?: string;
      result?: BoardResult;
    };
export interface BoardCell {
  square: string;
  piece: string | null;
  side: CheckerSide | 0;
  king?: boolean;
}
export interface BoardGameView {
  kind: BoardVariant;
  name: string;
  board: BoardCell[][];
  turn: string;
  selfSide: CheckerSide;
  legalMoves: { from: string; to: string; promotion?: string }[];
  forcedFrom: string | null;
  inCheck: boolean;
  ply: number;
  lastMove: { from: string; to: string } | null;
  moveHistory: string[];
  drawOffer?: string;
  result?: BoardResult;
}
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new BoardRuleError(message);
}
const square = z.string().regex(/^[a-h][1-8]$/);
const moveSchema = z
  .object({
    type: z.literal("board:move"),
    from: square,
    to: square,
    promotion: z.enum(["q", "r", "b", "n"]).optional(),
  })
  .strict();
const commandSchema = z
  .object({ type: z.enum(["board:resign", "board:draw", "board:decline"]) })
  .strict();
const indexOf = (s: string) => (8 - Number(s[1])) * 8 + s.charCodeAt(0) - 97;
export function createBoardGame(
  kind: BoardVariant,
  players: string[],
): BoardGameState {
  assert(
    players.length === 2 && players[0] !== players[1],
    "Board games need two different players",
  );
  const pair = players as [string, string];
  return kind === "checkers"
    ? { kind, players: pair, position: createCheckers() }
    : {
        kind,
        players: pair,
        position: {
          initialFen: DEFAULT_POSITION,
          moves: [],
          fen: DEFAULT_POSITION,
        },
      };
}
export function restoreChess(position: ChessPosition) {
  const chess = new Chess(position.initialFen);
  for (const move of position.moves) chess.move(move);
  assert(chess.fen() === position.fen, "Chess checkpoint is inconsistent");
  return chess;
}
function turnOf(s: BoardGameState): CheckerSide {
  return s.kind === "checkers"
    ? s.position.turn
    : restoreChess(s.position).turn() === "w"
      ? 1
      : 2;
}
function finish(s: BoardGameState, winner: CheckerSide | 0, reason: string) {
  s.result = {
    winners: winner ? [s.players[winner - 1]] : [],
    scores: Object.fromEntries(
      s.players.map((id, i) => [id, winner === i + 1 ? 100 : 0]),
    ),
    reason,
  };
  delete s.drawOffer;
}
export function applyBoardGameAction(
  s: BoardGameState,
  userId: string,
  payload: unknown,
) {
  assert(s.players.includes(userId), "Join this board game first");
  assert(!s.result, "This board game ended");
  const type = z.object({ type: z.string() }).passthrough().parse(payload).type;
  if (type !== "board:move") {
    const command = commandSchema.parse(payload);
    if (command.type === "board:resign")
      finish(s, s.players[0] === userId ? 2 : 1, "Opponent resigned");
    else if (command.type === "board:draw") {
      if (s.drawOffer && s.drawOffer !== userId)
        finish(s, 0, "Draw agreed by both players");
      else {
        assert(s.drawOffer !== userId, "Your draw offer is already pending");
        s.drawOffer = userId;
      }
    } else {
      assert(
        s.drawOffer && s.drawOffer !== userId,
        "There is no opponent draw offer",
      );
      delete s.drawOffer;
    }
    return;
  }
  assert(s.players[turnOf(s) - 1] === userId, "Wait for your turn");
  const move = moveSchema.parse(payload);
  if (s.kind === "checkers") {
    assert(!move.promotion, "Checkers promotion is automatic");
    s.position = moveCheckers(s.position, indexOf(move.from), indexOf(move.to));
    if (s.position.outcome)
      finish(s, s.position.outcome.winner, s.position.outcome.reason);
  } else {
    assert(
      s.position.moves.length < 512,
      "Chess move limit reached; agree a draw or resign",
    );
    const chess = restoreChess(s.position);
    const legal = chess
      .moves({ verbose: true })
      .filter((m) => m.from === move.from && m.to === move.to);
    assert(
      legal.length,
      "Choose a legal chess move; your king cannot be left in check",
    );
    const promotion = legal.some((m) => m.promotion)
      ? (move.promotion ?? "q")
      : undefined;
    assert(
      !move.promotion || promotion,
      "Promotion is only available on the last rank",
    );
    chess.move({
      from: move.from as Square,
      to: move.to as Square,
      ...(promotion ? { promotion } : {}),
    });
    s.position.moves.push({
      from: move.from as Square,
      to: move.to as Square,
      ...(promotion ? { promotion } : {}),
    });
    s.position.fen = chess.fen();
    if (chess.isCheckmate())
      finish(s, chess.turn() === "w" ? 2 : 1, "Checkmate");
    else if (chess.isStalemate()) finish(s, 0, "Stalemate");
    else if (chess.isInsufficientMaterial())
      finish(s, 0, "Insufficient material");
    else if (chess.isThreefoldRepetition())
      finish(s, 0, "Threefold repetition");
    else if (chess.isDrawByFiftyMoves()) finish(s, 0, "Fifty-move rule");
  }
  // Moving declines an outstanding offer rather than silently carrying it across turns.
  delete s.drawOffer;
}
export function boardGameView(
  s: BoardGameState,
  userId: string,
): BoardGameView {
  assert(s.players.includes(userId), "Join this board game first");
  const selfSide: CheckerSide = s.players[0] === userId ? 1 : 2;
  if (s.kind === "checkers") {
    const p = s.position;
    const turn = s.players[p.turn - 1];
    return {
      kind: s.kind,
      name: "American checkers",
      board: Array.from({ length: 8 }, (_, r) =>
        Array.from({ length: 8 }, (_, c) => {
          const i = r * 8 + c,
            piece = p.board[i];
          return {
            square: checkerSquare(i),
            piece: piece ? (isKing(piece) ? "king" : "man") : null,
            side: sideOf(piece),
            king: isKing(piece),
          };
        }),
      ),
      turn,
      selfSide,
      legalMoves:
        turn === userId
          ? legalCheckersMoves(p).map((m) => ({
              from: checkerSquare(m.from),
              to: checkerSquare(m.to),
            }))
          : [],
      forcedFrom: p.forcedFrom === null ? null : checkerSquare(p.forcedFrom),
      inCheck: false,
      ply: p.ply,
      lastMove: p.lastMove
        ? {
            from: checkerSquare(p.lastMove.from),
            to: checkerSquare(p.lastMove.to),
          }
        : null,
      moveHistory: [],
      drawOffer: s.drawOffer,
      result: s.result,
    };
  }
  const chess = restoreChess(s.position),
    turn = s.players[chess.turn() === "w" ? 0 : 1];
  return {
    kind: s.kind,
    name: "Chess",
    board: chess
      .board()
      .map((row, r) =>
        row.map((piece, c) => ({
          square: checkerSquare(r * 8 + c),
          piece: piece?.type ?? null,
          side: piece ? (piece.color === "w" ? 1 : 2) : 0,
        })),
      ),
    turn,
    selfSide,
    legalMoves:
      turn === userId && !s.result
        ? chess
            .moves({ verbose: true })
            .map((m) => ({
              from: m.from,
              to: m.to,
              ...(m.promotion ? { promotion: m.promotion } : {}),
            }))
        : [],
    forcedFrom: null,
    inCheck: chess.inCheck(),
    ply: s.position.moves.length,
    lastMove: s.position.moves.at(-1) ?? null,
    moveHistory: chess.history().slice(-100),
    drawOffer: s.drawOffer,
    result: s.result,
  };
}
/** Common registry/host contract: add variants without duplicating lobby or recovery logic. */
export const boardGameRegistry = {
  checkers: { title: "American checkers", create: () => createCheckers() },
  chess: {
    title: "Chess",
    create: () => ({
      initialFen: DEFAULT_POSITION,
      moves: [],
      fen: DEFAULT_POSITION,
    }),
  },
} as const;
