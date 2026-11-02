import { describe, expect, it } from "vitest";
import {
  addCard,
  addChecklistItem,
  addComment,
  emptyBoard,
  MAX_TITLE_LENGTH,
  duplicateCard,
  moveCard,
  setDueDate,
  setLabels,
  setNotes,
  setPriority,
  toggleChecklistItem,
} from "@/lib/board";
import { loadBoard, saveBoard } from "../../../support/testStorage";

const NOW = new Date("2030-05-05T10:00:00.000Z");

function fullBoard() {
  let b = addCard(emptyBoard(), "first", { id: "a" });
  b = addCard(b, "Plan trip", { id: "b" });
  b = addCard(b, "last", { id: "c" });
  b = setNotes(b, "b", "Some notes");
  b = setPriority(b, "b", "high");
  b = setDueDate(b, "b", "2030-06-01");
  b = setLabels(b, "b", ["travel", "fun"]);
  b = addChecklistItem(b, "b", "Book", { id: "i1" });
  b = addChecklistItem(b, "b", "Pack", { id: "i2" });
  b = toggleChecklistItem(b, "b", "i1");
  b = addComment(b, "b", "A comment", { id: "m1" });
  return b;
}

describe("duplicateCard", () => {
  it("inserts the copy right after the original and keeps the other cards in order", () => {
    const next = duplicateCard(fullBoard(), "b", { id: "copy", now: NOW });
    expect(next.columns.todo.map((c) => c.id)).toEqual(["a", "b", "copy", "c"]);
  });

  it("inserts after the last card, and in any column", () => {
    let b = moveCard(fullBoard(), "c", "doing");
    b = duplicateCard(b, "c", { id: "copy", now: NOW });
    expect(b.columns.doing.map((c) => c.id)).toEqual(["c", "copy"]);
    expect(b.columns.todo.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("titles the copy '<title> (copy)'", () => {
    const copy = duplicateCard(fullBoard(), "b", { id: "copy", now: NOW }).columns.todo[2];
    expect(copy.title).toBe("Plan trip (copy)");
  });

  it("truncates long titles so the copy stays within the limit and still ends with ' (copy)'", () => {
    for (const length of [MAX_TITLE_LENGTH, MAX_TITLE_LENGTH - 2]) {
      const b = addCard(emptyBoard(), "x".repeat(length), { id: "a" });
      const copy = duplicateCard(b, "a", { id: "copy" }).columns.todo[1];
      expect(copy.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
      expect(copy.title.endsWith(" (copy)")).toBe(true);
    }
  });

  it("trims a trailing space left by truncation", () => {
    const title = `${"x".repeat(MAX_TITLE_LENGTH - 8)} yyyyyyy`;
    const b = addCard(emptyBoard(), title, { id: "a" });
    const copy = duplicateCard(b, "a", { id: "copy" }).columns.todo[1];
    expect(copy.title).toBe(`${"x".repeat(MAX_TITLE_LENGTH - 8)} (copy)`);
  });

  it("copies notes, priority, due date and labels (labels not shared)", () => {
    const board = fullBoard();
    const original = board.columns.todo[1];
    const copy = duplicateCard(board, "b", { id: "copy", now: NOW }).columns.todo[2];
    expect(copy).toMatchObject({ notes: "Some notes", priority: "high", dueDate: "2030-06-01", labels: ["travel", "fun"] });
    expect(copy.labels).not.toBe(original.labels);
    expect(copy.createdAt).toBe(NOW.toISOString());
  });

  it("copies the checklist with new ids, unticked, same text and order", () => {
    const copy = duplicateCard(fullBoard(), "b", { id: "copy", now: NOW }).columns.todo[2];
    expect(copy.checklist?.map((i) => [i.text, i.done])).toEqual([
      ["Book", false],
      ["Pack", false],
    ]);
    expect(copy.checklist?.map((i) => i.id)).not.toContain("i1");
    expect(copy.checklist?.map((i) => i.id)).not.toContain("i2");
  });

  it("does not copy comments or activity; the activity is one 'duplicated' entry", () => {
    const copy = duplicateCard(fullBoard(), "b", { id: "copy", now: NOW }).columns.todo[2];
    expect(copy.comments).toBeUndefined();
    expect(copy.activity).toHaveLength(1);
    expect(copy.activity?.[0]).toMatchObject({ type: "duplicated", from: "Plan trip", at: NOW.toISOString() });
  });

  it("writes no optional keys for a bare card", () => {
    const b = addCard(emptyBoard(), "bare", { id: "a" });
    const copy = duplicateCard(b, "a", { id: "copy", now: NOW }).columns.todo[1];
    expect(Object.keys(copy).sort()).toEqual(["activity", "createdAt", "id", "priority", "title"]);
  });

  it("leaves the original and the input board untouched", () => {
    const board = fullBoard();
    const snapshot = JSON.parse(JSON.stringify(board));
    const next = duplicateCard(board, "b", { id: "copy", now: NOW });
    expect(board).toEqual(snapshot);
    expect(next.columns.todo[1]).toBe(board.columns.todo[1]);
  });

  it("throws for an unknown card", () => {
    expect(() => duplicateCard(emptyBoard(), "nope")).toThrow("not found");
  });

  it("survives a save and load round trip", () => {
    const next = duplicateCard(fullBoard(), "b", { id: "copy", now: NOW });
    saveBoard(next);
    expect(loadBoard().columns.todo[2].activity?.[0]).toMatchObject({ type: "duplicated", from: "Plan trip" });
  });
});
