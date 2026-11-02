import { describe, expect, it } from "vitest";
import { addCard, addList, deleteList, emptyBoard, isListCollapsed, listCards, moveCard, toggleListCollapsed } from "@/lib/board";
import { parseBoard, serializeBoard } from "@/lib/storage";

const boardJson = (extra: Record<string, unknown>) =>
  JSON.stringify({ columns: { todo: [], doing: [], done: [] }, archive: [], ...extra });

function parse(json: string) {
  const result = parseBoard(json);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.board;
}

describe("toggleListCollapsed", () => {
  it("collapses and expands a list without mutating the input", () => {
    const board = emptyBoard();
    const collapsed = toggleListCollapsed(board, "done");
    expect(board.collapsedLists).toBeUndefined();
    expect(collapsed.collapsedLists).toEqual(["done"]);
    expect(isListCollapsed(collapsed, "done")).toBe(true);
    expect(isListCollapsed(collapsed, "todo")).toBe(false);
    const expanded = toggleListCollapsed(collapsed, "done");
    expect(isListCollapsed(expanded, "done")).toBe(false);
    expect("collapsedLists" in expanded).toBe(false);
  });

  it("keeps other collapsed lists and ignores unknown ids", () => {
    let board = toggleListCollapsed(emptyBoard(), "done");
    board = toggleListCollapsed(board, "todo");
    expect(board.collapsedLists).toEqual(["done", "todo"]);
    expect(toggleListCollapsed(board, "nope")).toBe(board);
  });

  it("leaves cards, order and counts alone, also when a card moves into a collapsed list", () => {
    let board = addCard(emptyBoard(), "A", { id: "a" });
    board = toggleListCollapsed(board, "doing");
    board = moveCard(board, "a", "doing");
    expect(listCards(board, "doing").map((c) => c.id)).toEqual(["a"]);
    expect(isListCollapsed(board, "doing")).toBe(true);
  });
});

describe("deleteList and collapsed lists", () => {
  it("drops the id of a deleted list and the key once empty", () => {
    let board = toggleListCollapsed(emptyBoard(), "done");
    board = toggleListCollapsed(board, "doing");
    expect(deleteList(board, "done").collapsedLists).toEqual(["doing"]);
    expect("collapsedLists" in deleteList(toggleListCollapsed(emptyBoard(), "done"), "done")).toBe(false);
  });

  it("keeps the state of a list that is not deleted", () => {
    const board = toggleListCollapsed(addList(emptyBoard(), "Review", { id: "review" }), "review");
    expect(deleteList(board, "todo").collapsedLists).toEqual(["review"]);
  });
});

describe("collapsed lists in storage", () => {
  it("loads old boards with every list expanded", () => {
    const board = parse(boardJson({}));
    expect("collapsedLists" in board).toBe(false);
  });

  it("drops invalid, unknown and duplicate ids", () => {
    expect(parse(boardJson({ collapsedLists: ["done", "done", "ghost", 4, null] })).collapsedLists).toEqual(["done"]);
    expect("collapsedLists" in parse(boardJson({ collapsedLists: ["ghost"] }))).toBe(false);
    expect("collapsedLists" in parse(boardJson({ collapsedLists: "done" }))).toBe(false);
  });

  it("keeps collapsed lists through export and import", () => {
    const board = toggleListCollapsed(emptyBoard(), "done");
    expect(parse(serializeBoard(board)).collapsedLists).toEqual(["done"]);
  });
});
