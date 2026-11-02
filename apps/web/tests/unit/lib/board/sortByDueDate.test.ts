import { describe, expect, it } from "vitest";
import { addCard, emptyBoard, hasDueDates, listCards, setDueDate, sortListsByDueDate } from "@/lib/board";
import type { Board } from "@/lib/board";

function build(cards: Array<[id: string, list: string, due?: string]>): Board {
  let board = emptyBoard();
  for (const [id, list] of cards) {
    board = addCard(board, id, { id, listId: list });
  }
  for (const [id, , due] of cards) {
    if (due) board = setDueDate(board, id, due);
  }
  return board;
}

const ids = (board: Board, list: string) => listCards(board, list).map((c) => c.id);

describe("sortListsByDueDate", () => {
  it("puts dated cards first, earliest first, then undated cards in their order", () => {
    const board = build([
      ["a", "todo"],
      ["b", "todo", "2030-05-01"],
      ["c", "todo"],
      ["d", "todo", "2030-01-01"],
    ]);
    expect(ids(sortListsByDueDate(board), "todo")).toEqual(["d", "b", "a", "c"]);
  });

  it("keeps equal dates in their relative order", () => {
    const board = build([
      ["a", "todo", "2030-01-01"],
      ["b", "todo", "2029-01-01"],
      ["c", "todo", "2030-01-01"],
      ["d", "todo", "2030-01-01"],
    ]);
    expect(ids(sortListsByDueDate(board), "todo")).toEqual(["b", "a", "c", "d"]);
  });

  it("keeps cards in their own lists and sorts every list", () => {
    const board = build([
      ["a", "todo", "2030-02-01"],
      ["b", "todo", "2030-01-01"],
      ["c", "doing", "2031-02-01"],
      ["d", "doing", "2031-01-01"],
      ["e", "done"],
    ]);
    const sorted = sortListsByDueDate(board);
    expect(ids(sorted, "todo")).toEqual(["b", "a"]);
    expect(ids(sorted, "doing")).toEqual(["d", "c"]);
    expect(ids(sorted, "done")).toEqual(["e"]);
    expect(sorted.columns.todo.find((c) => c.id === "a")).toBe(board.columns.todo.find((c) => c.id === "a"));
  });

  it("does not mutate its input", () => {
    const board = build([
      ["a", "todo", "2030-02-01"],
      ["b", "todo", "2030-01-01"],
    ]);
    const snapshot = JSON.parse(JSON.stringify(board));
    const sorted = sortListsByDueDate(board);
    expect(sorted).not.toBe(board);
    expect(board).toEqual(snapshot);
  });
});

describe("hasDueDates", () => {
  it("is false for an empty board and a board without due dates", () => {
    expect(hasDueDates(emptyBoard())).toBe(false);
    expect(hasDueDates(build([["a", "todo"]]))).toBe(false);
  });

  it("is true when any card has a due date", () => {
    expect(hasDueDates(build([["a", "done", "2030-01-01"]]))).toBe(true);
  });
});
