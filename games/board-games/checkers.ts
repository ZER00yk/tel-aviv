/** American checkers: forced capture, forward men, short kings, promotion ends the turn. */
export type CheckerSide = 1 | 2;
export type CheckerPiece = 0 | 1 | 2 | 3 | 4;
export interface CheckerMove {
  from: number;
  to: number;
  captured?: number;
}
export interface CheckersPosition {
  board: CheckerPiece[];
  turn: CheckerSide;
  forcedFrom: number | null;
  ply: number;
  quietPly: number;
  lastMove: CheckerMove | null;
  history: Record<string, number>;
  outcome: { winner: CheckerSide | 0; reason: string } | null;
}
export class BoardRuleError extends Error {}
export function sideOf(piece: CheckerPiece): CheckerSide | 0 {
  return piece === 1 || piece === 3 ? 1 : piece === 2 || piece === 4 ? 2 : 0;
}
export function isKing(piece: CheckerPiece) {
  return piece === 3 || piece === 4;
}
const inside = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
export function checkerSquare(index: number) {
  return `${String.fromCharCode(97 + (index % 8))}${8 - Math.floor(index / 8)}`;
}
function key(s: Pick<CheckersPosition, "board" | "turn">) {
  return `${s.board.join("")}:${s.turn}`;
}
export function createCheckers(): CheckersPosition {
  const board: Array<CheckerPiece> = Array(64).fill(0);
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if ((r + c) % 2 === 1) board[r * 8 + c] = r < 3 ? 2 : r > 4 ? 1 : 0;
  const s: CheckersPosition = {
    board,
    turn: 1,
    forcedFrom: null,
    ply: 0,
    quietPly: 0,
    lastMove: null,
    history: {},
    outcome: null,
  };
  s.history[key(s)] = 1;
  return s;
}
function movesFrom(
  s: CheckersPosition,
  from: number,
  captureOnly: boolean,
): CheckerMove[] {
  const piece = s.board[from],
    side = sideOf(piece);
  if (side !== s.turn) return [];
  const r = Math.floor(from / 8),
    c = from % 8,
    dirs = isKing(piece) ? [-1, 1] : side === 1 ? [-1] : [1];
  const moves: CheckerMove[] = [];
  for (const dr of dirs)
    for (const dc of [-1, 1]) {
      const nr = r + dr,
        nc = c + dc;
      if (!inside(nr, nc)) continue;
      const mid = nr * 8 + nc;
      if (!captureOnly && s.board[mid] === 0) moves.push({ from, to: mid });
      if (sideOf(s.board[mid]) && sideOf(s.board[mid]) !== side) {
        const er = nr + dr,
          ec = nc + dc;
        if (inside(er, ec) && s.board[er * 8 + ec] === 0)
          moves.push({ from, to: er * 8 + ec, captured: mid });
      }
    }
  return moves;
}
export function legalCheckersMoves(s: CheckersPosition): CheckerMove[] {
  if (s.outcome) return [];
  if (s.forcedFrom !== null) return movesFrom(s, s.forcedFrom, true);
  const captures = s.board.flatMap((_, i) => movesFrom(s, i, true));
  return captures.length
    ? captures
    : s.board.flatMap((_, i) => movesFrom(s, i, false));
}
export function moveCheckers(
  s: CheckersPosition,
  from: number,
  to: number,
): CheckersPosition {
  const move = legalCheckersMoves(s).find(
    (m) => m.from === from && m.to === to,
  );
  if (!move)
    throw new BoardRuleError(
      s.forcedFrom !== null
        ? "Continue this piece's capture chain"
        : "Choose a legal move; captures are mandatory",
    );
  const next: CheckersPosition = {
    ...s,
    board: [...s.board],
    history: { ...s.history },
    lastMove: move,
  };
  const piece = next.board[from];
  next.board[from] = 0;
  next.board[to] = piece;
  if (move.captured !== undefined) next.board[move.captured] = 0;
  const promoted =
    !isKing(piece) && ((s.turn === 1 && to < 8) || (s.turn === 2 && to >= 56));
  if (promoted) next.board[to] = s.turn === 1 ? 3 : 4;
  next.quietPly =
    move.captured !== undefined || promoted || !isKing(piece)
      ? 0
      : next.quietPly + 1;
  if (
    move.captured !== undefined &&
    !promoted &&
    movesFrom(next, to, true).length
  ) {
    next.forcedFrom = to;
    return next;
  }
  next.forcedFrom = null;
  next.turn = s.turn === 1 ? 2 : 1;
  next.ply = s.ply + 1;
  if (
    !next.board.some((p) => sideOf(p) === next.turn) ||
    legalCheckersMoves(next).length === 0
  )
    next.outcome = { winner: s.turn, reason: "Opponent has no legal move" };
  else {
    const positionKey = key(next);
    next.history[positionKey] = (next.history[positionKey] ?? 0) + 1;
    if (next.history[positionKey] >= 3)
      next.outcome = { winner: 0, reason: "Threefold repetition" };
    else if (next.quietPly >= 80)
      next.outcome = {
        winner: 0,
        reason: "Forty king moves each without progress",
      };
  }
  return next;
}
/** A shallow bounded local opponent; all legal rules are shared with the server. */
export function checkersBotMove(s: CheckersPosition): CheckerMove | undefined {
  const moves = legalCheckersMoves(s);
  const evaluate = (move: CheckerMove) => {
    const next = moveCheckers(s, move.from, move.to);
    let score = move.captured !== undefined ? 6 : 0;
    if (isKing(next.board[move.to]) && !isKing(s.board[move.from])) score += 5;
    score += (3.5 - Math.abs(3.5 - (move.to % 8))) * 0.2;
    if (next.outcome?.winner === s.turn) score += 100;
    if (next.turn !== s.turn)
      score -=
        legalCheckersMoves(next).filter((m) => m.captured !== undefined)
          .length * 4;
    return score;
  };
  return moves.sort((a, b) => evaluate(b) - evaluate(a) || a.to - b.to)[0];
}
