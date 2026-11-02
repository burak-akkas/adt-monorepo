import { describe, expect, it } from "vitest";
import {
  addCard,
  addList,
  archiveDone,
  boardLists,
  collapseEmptyLists,
  emptyBoard,
  hasExpandedEmptyList,
  toggleListCollapsed,
} from "@/lib/board";

describe("collapseEmptyLists", () => {
  it("collapses only the empty lists without mutating the input", () => {
    const board = addCard(emptyBoard(), "Task", { listId: "todo" });
    const result = collapseEmptyLists(board);
    expect(board.collapsedLists).toBeUndefined();
    expect(result.collapsedLists).toEqual(["doing", "done"]);
  });

  it("equals collapsing those lists by hand and keeps list order", () => {
    const board = addList(addCard(emptyBoard(), "Task", { listId: "todo" }), "Extra");
    const empty = boardLists(board)
      .filter((l) => l.id !== "todo")
      .map((l) => l.id);
    let byHand = board;
    for (const id of empty) {
      byHand = toggleListCollapsed(byHand, id);
    }
    expect(collapseEmptyLists(board)).toEqual(byHand);
  });

  it("keeps lists that were already collapsed", () => {
    const board = toggleListCollapsed(addCard(emptyBoard(), "Task", { listId: "todo" }), "todo");
    expect(collapseEmptyLists(board).collapsedLists).toEqual(["todo", "doing", "done"]);
  });

  it("returns the same board when there is nothing to do", () => {
    const noLists = { ...emptyBoard(), lists: [], columns: {} };
    let full = emptyBoard();
    for (const l of boardLists(full)) {
      full = addCard(full, `Card ${l.id}`, { listId: l.id });
    }
    const allCollapsed = collapseEmptyLists(emptyBoard());
    expect(hasExpandedEmptyList(full)).toBe(false);
    expect(collapseEmptyLists(full)).toBe(full);
    expect(collapseEmptyLists(allCollapsed)).toBe(allCollapsed);
    expect(hasExpandedEmptyList(allCollapsed)).toBe(false);
    expect(hasExpandedEmptyList(noLists)).toBe(false);
    expect(collapseEmptyLists(noLists)).toBe(noLists);
  });

  it("counts a list with only archived cards as empty", () => {
    const board = archiveDone(addCard(emptyBoard(), "Old", { listId: "done" }));
    expect(collapseEmptyLists(board).collapsedLists).toContain("done");
  });
});
