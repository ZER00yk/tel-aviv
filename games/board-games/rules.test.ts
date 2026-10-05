import { describe, it, expect } from "vitest";
import { emptyBoard, drop, winner, botColumn } from "./rules";
describe("Four in a Row", () => {
  it("rejects full columns without mutating the board", () => {
    let board = emptyBoard();
    for (let i = 0; i < 6; i++) board = drop(board, 0, i % 2 ? 1 : 2)!;
    const before = JSON.stringify(board);
    expect(drop(board, 0, 1)).toBeNull();
    expect(JSON.stringify(board)).toBe(before);
  });
  it("detects horizontal and diagonal victories", () => {
    const board = emptyBoard();
    board[5] = [1, 1, 1, 1, 0, 0, 0];
    expect(winner(board)).toBe(1);
    const diagonal = emptyBoard();
    for (let i = 0; i < 4; i++) diagonal[5 - i][i] = 2;
    expect(winner(diagonal)).toBe(2);
  });
  it("bot blocks immediate loss and takes immediate wins", () => {
    const board = emptyBoard();
    board[5] = [1, 1, 1, 0, 0, 0, 0];
    expect(botColumn(board)).toBe(3);
    board[4] = [2, 2, 2, 0, 0, 0, 0];
    expect(botColumn(board)).toBe(3);
  });
});
