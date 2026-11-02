import { describe, expect, it } from "vitest";
import {
  addCard,
  boardStats,
  emptyBoard,
  filterCards,
  filterOverdue,
  isFiltering,
  listOverdueCount,
  moveCard,
  setDueDate,
  setPriority,
} from "@/lib/board";

const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

describe("filterCards / isFiltering", () => {
  let board = addCard(emptyBoard(), "Write Docs", { id: "a" });
  board = addCard(board, "Fix bug", { id: "b" });
  board = addCard(board, "Docs review", { id: "c" });
  board = moveCard(board, "c", "doing");
  board = moveCard(board, "b", "done");

  it("matches case-insensitively across all columns, preserving order", () => {
    const result = filterCards(board, "DOCS");
    expect(ids(result.columns.todo)).toEqual(["a"]);
    expect(ids(result.columns.doing)).toEqual(["c"]);
    expect(ids(result.columns.done)).toEqual([]);
  });

  it("ignores leading and trailing spaces in the query", () => {
    expect(filterCards(board, "  fix bug ").columns.done).toEqual(board.columns.done);
  });

  it("returns all cards for an empty or whitespace query", () => {
    expect(filterCards(board, "")).toBe(board);
    expect(filterCards(board, "   ")).toBe(board);
    expect(isFiltering("")).toBe(false);
    expect(isFiltering("  ")).toBe(false);
    expect(isFiltering(" a ")).toBe(true);
  });

  it("returns empty columns when nothing matches", () => {
    expect(filterCards(board, "zzz").columns).toEqual({ todo: [], doing: [], done: [] });
  });

  it("does not mutate the input board", () => {
    const snapshot = structuredClone(board);
    filterCards(board, "docs");
    expect(board).toEqual(snapshot);
  });
});

describe("boardStats / filterOverdue", () => {
  const TODAY = "2026-10-28";
  let board = emptyBoard();
  for (const id of ["a", "b", "c", "d"]) {
    board = addCard(board, `Card ${id}`, { id });
  }
  board = setDueDate(board, "a", "2026-10-01"); // overdue
  board = setDueDate(board, "b", "2026-10-28"); // due today: not overdue
  board = setDueDate(board, "c", "2026-09-01");
  board = setPriority(board, "a", "high");
  board = setPriority(board, "c", "high");
  board = moveCard(board, "c", "doing"); // overdue and high
  board = moveCard(board, "d", "done");
  board = setDueDate(board, "d", "2000-01-01"); // overdue but done
  board = setPriority(board, "d", "high"); // high but done

  it("counts totals, progress, overdue and open high priority cards", () => {
    expect(boardStats(board, TODAY)).toEqual({ total: 4, done: 1, percentDone: 25, overdue: 2, highOpen: 2 });
  });

  it("handles an empty board", () => {
    expect(boardStats(emptyBoard(), TODAY)).toEqual({ total: 0, done: 0, percentDone: 0, overdue: 0, highOpen: 0 });
  });

  it("rounds the percentage", () => {
    let b = addCard(addCard(addCard(emptyBoard(), "x", { id: "x" }), "y", { id: "y" }), "z", { id: "z" });
    b = moveCard(b, "x", "done");
    expect(boardStats(b, TODAY).percentDone).toBe(33);
  });

  it("counts overdue cards per list, excluding due today, undated and the done list", () => {
    let b = emptyBoard();
    for (const id of ["a", "b", "c", "d"]) {
      b = addCard(b, `Card ${id}`, { id });
    }
    b = setDueDate(b, "a", "2026-10-27");
    b = setDueDate(b, "b", "2026-10-28");
    b = setDueDate(b, "c", "2000-01-01");
    b = moveCard(b, "d", "done");
    b = setDueDate(b, "d", "2000-01-01");
    expect(listOverdueCount(b, "todo", TODAY)).toBe(2);
    expect(listOverdueCount(b, "doing", TODAY)).toBe(0);
    expect(listOverdueCount(b, "done", TODAY)).toBe(0);
    expect(listOverdueCount(emptyBoard(), "todo", TODAY)).toBe(0);
  });

  it("keeps only overdue, not-done cards and does not mutate", () => {
    const filtered = filterOverdue(board, TODAY);
    expect(ids(filtered.columns.todo)).toEqual(["a"]);
    expect(ids(filtered.columns.doing)).toEqual(["c"]);
    expect(filtered.columns.done).toEqual([]);
    expect(ids(board.columns.done)).toEqual(["d"]);
  });
});
