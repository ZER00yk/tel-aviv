export type Board = (0 | 1 | 2)[][];
export const emptyBoard = (): Board =>
  Array.from({ length: 6 }, () => Array<0 | 1 | 2>(7).fill(0));
export function drop(
  board: Board,
  column: number,
  player: 1 | 2,
): Board | null {
  if (column < 0 || column > 6 || board[0][column]) return null;
  const next = board.map((row) => [...row]);
  for (let row = 5; row >= 0; row--)
    if (!next[row][column]) {
      next[row][column] = player;
      return next;
    }
  return null;
}
export function winner(board: Board): 0 | 1 | 2 {
  for (let r = 0; r < 6; r++)
    for (let c = 0; c < 7; c++) {
      const player = board[r][c];
      if (!player) continue;
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
        [1, 1],
        [1, -1],
      ]) {
        if ([1, 2, 3].every((i) => board[r + dr * i]?.[c + dc * i] === player))
          return player;
      }
    }
  return 0;
}
export function botColumn(board: Board): number {
  const options = [3, 2, 4, 1, 5, 0, 6].filter((c) => !board[0][c]);
  for (const c of options) {
    const next = drop(board, c, 2)!;
    if (winner(next) === 2) return c;
  }
  for (const c of options) {
    const next = drop(board, c, 1)!;
    if (winner(next) === 1) return c;
  }
  return (
    options.sort(
      (a, b) => score(drop(board, b, 2)!) - score(drop(board, a, 2)!),
    )[0] ?? -1
  );
}
function score(board: Board) {
  let result = 0;
  for (let r = 0; r < 6; r++)
    for (let c = 0; c < 7; c++)
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
        [1, 1],
        [1, -1],
      ]) {
        const cells = Array.from(
          { length: 4 },
          (_, i) => board[r + dr * i]?.[c + dc * i],
        );
        if (cells.some((x) => x === undefined)) continue;
        const enemy = cells.filter((x) => x === 2).length;
        const own = cells.filter((x) => x === 1).length;
        if (!own) result += enemy * enemy;
        if (!enemy) result -= own * own * 0.8;
      }
  return result;
}
