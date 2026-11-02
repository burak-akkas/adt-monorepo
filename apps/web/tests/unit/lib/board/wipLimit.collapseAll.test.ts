import { describe, expect, it } from "vitest";
import {
  addList,
  boardLists,
  collapseAllLists,
  emptyBoard,
  expandAllLists,
  toggleListCollapsed,
} from "@/lib/board";

describe("collapseAllLists", () => {
  it("collapses every list in list order without mutating the input", () => {
    const board = addList(emptyBoard(), "Extra");
    const result = collapseAllLists(board);
    expect(board.collapsedLists).toBeUndefined();
    expect(result.collapsedLists).toEqual(boardLists(board).map((l) => l.id));
  });

  it("equals collapsing each list by hand, also from a partial state", () => {
    const board = addList(emptyBoard(), "Extra");
    let byHand = board;
    for (const l of boardLists(board)) {
      byHand = toggleListCollapsed(byHand, l.id);
    }
    expect(collapseAllLists(board)).toEqual(byHand);
    const partial = toggleListCollapsed(board, "done");
    expect(collapseAllLists(partial).collapsedLists).toEqual(boardLists(board).map((l) => l.id));
  });

  it("returns the same board when all are collapsed", () => {
    const all = collapseAllLists(emptyBoard());
    expect(collapseAllLists(all)).toBe(all);
  });

  it("keeps other board fields", () => {
    const board = { ...emptyBoard(), wipLimits: { todo: 2 } };
    expect(collapseAllLists(board).wipLimits).toEqual({ todo: 2 });
  });
});

describe("expandAllLists", () => {
  it("removes the key without mutating the input", () => {
    const collapsed = collapseAllLists(emptyBoard());
    const result = expandAllLists(collapsed);
    expect("collapsedLists" in result).toBe(false);
    expect(collapsed.collapsedLists).toBeDefined();
  });

  it("returns the same board when nothing is collapsed", () => {
    const board = emptyBoard();
    expect(expandAllLists(board)).toBe(board);
    const empty = { ...board, collapsedLists: [] };
    expect(expandAllLists(empty)).toBe(empty);
  });

  it("equals expanding each list by hand", () => {
    let board = collapseAllLists(emptyBoard());
    const result = expandAllLists(board);
    for (const l of boardLists(board)) {
      board = toggleListCollapsed(board, l.id);
    }
    expect(result).toEqual(board);
  });
});
