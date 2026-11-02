import { describe, expect, it } from "vitest";
import {
  addCard,
  addChecklistItem,
  archiveDone,
  checklistProgress,
  deleteChecklistItem,
  deleteCompletedChecklistItems,
  editChecklistItem,
  emptyBoard,
  findCard,
  MAX_CHECKLIST_ITEM_LENGTH,
  moveCard,
  moveChecklistItem,
  moveCompletedChecklistItemsToBottom,
  restoreCard,
  toggleChecklistItem,
  uncheckAllChecklistItems,
  updateCard,
  type Board,
} from "@/lib/board";

function withItems(texts: string[]): Board {
  let board = addCard(emptyBoard(), "Card", { id: "c" });
  texts.forEach((text, i) => {
    board = addChecklistItem(board, "c", text, { id: `i${i}` });
  });
  return board;
}

const texts = (board: Board) => findCard(board, "c")?.card.checklist?.map((i) => i.text);
const ids = (board: Board) => findCard(board, "c")?.card.checklist?.map((i) => i.id);

describe("checklist", () => {
  it("unchecks every item, keeping text, order and ids, and leaves other cards alone", () => {
    let board = withItems(["a", "b", "c"]);
    board = addCard(board, "Other", { id: "o" });
    board = addChecklistItem(board, "o", "x", { id: "ox" });
    board = toggleChecklistItem(board, "c", "i0");
    board = toggleChecklistItem(board, "c", "i2");
    board = toggleChecklistItem(board, "o", "ox");
    const next = uncheckAllChecklistItems(board, "c");
    expect(findCard(next, "c")?.card.checklist).toEqual([
      { id: "i0", text: "a", done: false },
      { id: "i1", text: "b", done: false },
      { id: "i2", text: "c", done: false },
    ]);
    expect(findCard(next, "o")?.card.checklist?.[0].done).toBe(true);
    expect(checklistProgress(findCard(next, "c")!.card)).toEqual({ done: 0, total: 3 });
  });

  it("uncheck all returns the same board when nothing is ticked or the list is empty", () => {
    const board = withItems(["a"]);
    expect(uncheckAllChecklistItems(board, "c")).toBe(board);
    const empty = withItems([]);
    expect(uncheckAllChecklistItems(empty, "c")).toBe(empty);
  });

  it("moves completed items below open ones, stable within each group, without mutating", () => {
    let board = withItems(["a", "b", "c", "d"]);
    board = toggleChecklistItem(board, "c", "i0");
    board = toggleChecklistItem(board, "c", "i2");
    const before = findCard(board, "c")!.card.checklist;
    const snapshot = JSON.parse(JSON.stringify(before));
    const next = moveCompletedChecklistItemsToBottom(board, "c");
    expect(texts(next)).toEqual(["b", "d", "a", "c"]);
    expect(ids(next)).toEqual(["i1", "i3", "i0", "i2"]);
    expect(findCard(next, "c")?.card.checklist?.map((i) => i.done)).toEqual([false, false, true, true]);
    expect(before).toEqual(snapshot);
  });

  it("move completed to bottom returns the same board when sorted, all done, none done or empty", () => {
    const none = withItems(["a", "b"]);
    expect(moveCompletedChecklistItemsToBottom(none, "c")).toBe(none);
    const sorted = toggleChecklistItem(none, "c", "i1");
    expect(moveCompletedChecklistItemsToBottom(sorted, "c")).toBe(sorted);
    const all = toggleChecklistItem(sorted, "c", "i0");
    expect(moveCompletedChecklistItemsToBottom(all, "c")).toBe(all);
    const empty = withItems([]);
    expect(moveCompletedChecklistItemsToBottom(empty, "c")).toBe(empty);
  });

  it("move completed to bottom throws for an unknown card", () => {
    expect(() => moveCompletedChecklistItemsToBottom(withItems([]), "nope")).toThrow();
  });

  it("uncheck all throws for an unknown card", () => {
    expect(() => uncheckAllChecklistItems(withItems([]), "nope")).toThrow();
  });

  it("deletes completed items, keeping unchecked ones in order, without mutating", () => {
    let board = withItems(["a", "b", "c"]);
    board = toggleChecklistItem(board, "c", "i0");
    board = toggleChecklistItem(board, "c", "i2");
    const before = structuredClone(board);
    const next = deleteCompletedChecklistItems(board, "c");
    expect(findCard(next, "c")?.card.checklist).toEqual([{ id: "i1", text: "b", done: false }]);
    expect(board).toEqual(before);
  });

  it("delete completed removes the checklist field when every item is checked", () => {
    let board = withItems(["a", "b"]);
    board = toggleChecklistItem(board, "c", "i0");
    board = toggleChecklistItem(board, "c", "i1");
    const card = findCard(deleteCompletedChecklistItems(board, "c"), "c")!.card;
    expect("checklist" in card).toBe(false);
  });

  it("delete completed returns the same board when nothing is ticked, and throws for an unknown card", () => {
    const board = withItems(["a"]);
    expect(deleteCompletedChecklistItems(board, "c")).toBe(board);
    expect(() => deleteCompletedChecklistItems(board, "nope")).toThrow();
  });

  it("adds trimmed, unchecked items at the end with an injectable id", () => {
    const board = withItems(["one", "  two  "]);
    expect(findCard(board, "c")?.card.checklist).toEqual([
      { id: "i0", text: "one", done: false },
      { id: "i1", text: "two", done: false },
    ]);
  });

  it("generates an id by default", () => {
    const board = addChecklistItem(addCard(emptyBoard(), "Card", { id: "c" }), "c", "x");
    expect(findCard(board, "c")?.card.checklist?.[0].id).toBeTruthy();
  });

  it("rejects empty and over-long text, accepts the limit", () => {
    const board = withItems([]);
    expect(() => addChecklistItem(board, "c", "   ")).toThrow();
    expect(() => addChecklistItem(board, "c", "x".repeat(MAX_CHECKLIST_ITEM_LENGTH + 1))).toThrow();
    expect(MAX_CHECKLIST_ITEM_LENGTH).toBe(200);
    expect(texts(addChecklistItem(board, "c", "x".repeat(200)))?.[0]).toHaveLength(200);
  });

  it("toggles an item", () => {
    const board = toggleChecklistItem(withItems(["a", "b"]), "c", "i1");
    expect(findCard(board, "c")?.card.checklist?.map((i) => i.done)).toEqual([false, true]);
    const again = toggleChecklistItem(board, "c", "i1");
    expect(findCard(again, "c")?.card.checklist?.[1].done).toBe(false);
  });

  it("edits an item; same text is a no-op", () => {
    const board = withItems(["a", "b"]);
    expect(texts(editChecklistItem(board, "c", "i0", "  z "))).toEqual(["z", "b"]);
    expect(editChecklistItem(board, "c", "i0", "a ")).toBe(board);
    expect(() => editChecklistItem(board, "c", "i0", " ")).toThrow();
  });

  it("deletes an item and removes the field with the last one", () => {
    const board = withItems(["a", "b"]);
    const one = deleteChecklistItem(board, "c", "i0");
    expect(texts(one)).toEqual(["b"]);
    const none = deleteChecklistItem(one, "c", "i1");
    expect(findCard(none, "c")?.card).not.toHaveProperty("checklist");
  });

  it("moves items up and down; no-op at the ends", () => {
    const board = withItems(["a", "b", "c"]);
    expect(ids(moveChecklistItem(board, "c", "i2", -1))).toEqual(["i0", "i2", "i1"]);
    expect(ids(moveChecklistItem(board, "c", "i0", 1))).toEqual(["i1", "i0", "i2"]);
    expect(moveChecklistItem(board, "c", "i0", -1)).toBe(board);
    expect(moveChecklistItem(board, "c", "i2", 1)).toBe(board);
  });

  it("throws for an unknown card or item", () => {
    const board = withItems(["a"]);
    expect(() => addChecklistItem(board, "nope", "x")).toThrow();
    expect(() => toggleChecklistItem(board, "c", "nope")).toThrow();
    expect(() => editChecklistItem(board, "c", "nope", "x")).toThrow();
    expect(() => deleteChecklistItem(board, "c", "nope")).toThrow();
    expect(() => moveChecklistItem(board, "c", "nope", 1)).toThrow();
  });

  it("does not mutate its input", () => {
    const board = withItems(["a", "b"]);
    const snapshot = JSON.stringify(board);
    toggleChecklistItem(board, "c", "i0");
    editChecklistItem(board, "c", "i0", "z");
    moveChecklistItem(board, "c", "i0", 1);
    deleteChecklistItem(board, "c", "i0");
    addChecklistItem(board, "c", "q");
    expect(JSON.stringify(board)).toBe(snapshot);
  });

  it("reports progress, or nothing without a checklist", () => {
    const board = toggleChecklistItem(withItems(["a", "b", "c"]), "c", "i0");
    expect(checklistProgress(findCard(board, "c")!.card)).toEqual({ done: 1, total: 3 });
    expect(checklistProgress(findCard(withItems([]), "c")!.card)).toBeUndefined();
  });

  it("survives save, move, archive and restore", () => {
    let board = withItems(["a"]);
    board = updateCard(board, "c", { title: "New", notes: undefined, priority: "high", dueDate: undefined, column: "doing" });
    expect(texts(board)).toEqual(["a"]);
    board = archiveDone(moveCard(board, "c", "done"));
    board = restoreCard(board, "c");
    expect(texts(board)).toEqual(["a"]);
  });
});
