import { describe, expect, it } from "vitest";
import { addCard, emptyBoard, listCards, sortListByTitle } from "@/lib/board";
import type { Board } from "@/lib/board";

function build(cards: Array<[id: string, list: string, title: string]>): Board {
  let board = emptyBoard();
  for (const [id, list, title] of cards) {
    board = addCard(board, title, { id, listId: list });
  }
  return board;
}

const ids = (board: Board, list: string) => listCards(board, list).map((c) => c.id);

describe("sortListByTitle", () => {
  it("sorts A→Z ignoring case", () => {
    const board = build([
      ["a", "todo", "banana"],
      ["b", "todo", "Cherry"],
      ["c", "todo", "apple"],
    ]);
    expect(ids(sortListByTitle(board, "todo"), "todo")).toEqual(["c", "a", "b"]);
  });

  it("keeps equal titles in their relative order", () => {
    const board = build([
      ["a", "todo", "b"],
      ["b", "todo", "a"],
      ["c", "todo", "A"],
      ["d", "todo", "a"],
    ]);
    expect(ids(sortListByTitle(board, "todo"), "todo")).toEqual(["b", "c", "d", "a"]);
  });

  it("leaves other lists untouched and moves no card between lists", () => {
    const board = build([
      ["a", "todo", "b"],
      ["b", "todo", "a"],
      ["c", "doing", "z"],
      ["d", "doing", "y"],
    ]);
    const sorted = sortListByTitle(board, "todo");
    expect(ids(sorted, "todo")).toEqual(["b", "a"]);
    expect(sorted.columns.doing).toBe(board.columns.doing);
    expect(ids(sorted, "doing")).toEqual(["c", "d"]);
  });

  it("does not mutate its input", () => {
    const board = build([
      ["a", "todo", "b"],
      ["b", "todo", "a"],
    ]);
    const snapshot = JSON.parse(JSON.stringify(board));
    const sorted = sortListByTitle(board, "todo");
    expect(sorted).not.toBe(board);
    expect(board).toEqual(snapshot);
  });

  it("returns the same board for an unknown list or a list with fewer than 2 cards", () => {
    const board = build([["a", "todo", "only"]]);
    expect(sortListByTitle(board, "todo")).toBe(board);
    expect(sortListByTitle(board, "doing")).toBe(board);
    expect(sortListByTitle(board, "nope")).toBe(board);
  });
});
