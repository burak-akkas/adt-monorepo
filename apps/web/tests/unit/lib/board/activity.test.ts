import { describe, expect, it } from "vitest";
import {
  addCard,
  archiveDone,
  emptyBoard,
  findCard,
  MAX_ACTIVITY_ENTRIES,
  moveCard,
  renameCard,
  restoreCard,
  setDueDate,
  setNotes,
  setPriority,
  undoArchive,
  updateCard,
  withActivity,
  type ActivityEntry,
  type Board,
  type CardEdits,
} from "@/lib/board";

const T0 = new Date("2026-03-01T10:00:00Z");
const T1 = new Date("2026-03-02T10:00:00Z");

const seed = (): Board => addCard(emptyBoard(), "Task", { id: "a", now: T0 });
const activity = (board: Board, id = "a"): ActivityEntry[] => {
  const found = findCard(board, id);
  const card = found?.card ?? board.archive.find((c) => c.id === id);
  return card?.activity ?? [];
};
const types = (board: Board, id = "a") => activity(board, id).map((e) => e.type);

describe("activity recording", () => {
  it("records created with the injected now", () => {
    expect(activity(seed())).toEqual([{ id: expect.any(String), at: T0.toISOString(), type: "created" }]);
  });

  it("records moved with column ids, and nothing for a no-op", () => {
    const board = seed();
    const moved = moveCard(board, "a", "doing", { now: T1 });
    expect(activity(moved)[0]).toMatchObject({ type: "moved", from: "todo", to: "doing", at: T1.toISOString() });
    expect(moveCard(board, "a", "todo")).toBe(board);
  });

  it("records title, description, priority and due date changes", () => {
    let board = renameCard(seed(), "a", "New", { now: T1 });
    expect(activity(board)[0]).toMatchObject({ type: "title", from: "Task", to: "New" });
    board = setNotes(board, "a", "hello", { now: T1 });
    expect(activity(board)[0]).toEqual({ id: expect.any(String), at: T1.toISOString(), type: "description" });
    board = setPriority(board, "a", "high", { now: T1 });
    expect(activity(board)[0]).toMatchObject({ type: "priority", from: "medium", to: "high" });
    board = setDueDate(board, "a", "2030-01-02", { now: T1 });
    expect(activity(board)[0]).toEqual({ id: expect.any(String), at: T1.toISOString(), type: "dueDate", to: "2030-01-02" });
    board = setDueDate(board, "a", undefined, { now: T1 });
    expect(activity(board)[0]).toMatchObject({ type: "dueDate", from: "2030-01-02" });
    expect(activity(board)[0]).not.toHaveProperty("to");
    expect(types(board)).toEqual(["dueDate", "dueDate", "priority", "description", "title", "created"]);
  });

  it("uses an injected id", () => {
    expect(activity(setPriority(seed(), "a", "low", { id: "x1" }))[0].id).toBe("x1");
  });

  it("returns the same board and adds nothing for no-op changes", () => {
    const board = seed();
    expect(renameCard(board, "a", " Task ")).toBe(board);
    expect(setNotes(board, "a", "  ")).toBe(board);
    expect(setPriority(board, "a", "medium")).toBe(board);
    expect(setDueDate(board, "a", undefined)).toBe(board);
  });

  it("does not mutate the input board", () => {
    const board = seed();
    const snapshot = JSON.stringify(board);
    setPriority(board, "a", "high");
    moveCard(board, "a", "done");
    expect(JSON.stringify(board)).toBe(snapshot);
  });

  it("updateCard records one entry per changed field and none for unchanged ones", () => {
    const same: CardEdits = { title: "Task", notes: undefined, priority: "medium", dueDate: undefined, column: "todo" };
    const board = seed();
    expect(updateCard(board, "a", same, { now: T1 })).toBe(board);
    const next = updateCard(board, "a", { ...same, priority: "high", column: "doing" }, { now: T1 });
    expect(types(next)).toEqual(["moved", "priority", "created"]);
    expect(new Set(activity(next).map((e) => e.id)).size).toBe(3);
  });

  it("does not record label changes", () => {
    const same: CardEdits = { title: "Task", notes: undefined, priority: "medium", dueDate: undefined, column: "todo" };
    expect(types(updateCard(seed(), "a", { ...same, labels: ["x"] }))).toEqual(["created"]);
  });

  it("archiveDone records archived on every moved card", () => {
    let board = addCard(seed(), "Other", { id: "b", now: T0 });
    board = moveCard(moveCard(board, "a", "done"), "b", "done");
    const archived = archiveDone(board, { now: T1 });
    expect(types(archived, "a")[0]).toBe("archived");
    expect(types(archived, "b")[0]).toBe("archived");
    expect(activity(archived, "a")[0].at).toBe(T1.toISOString());
  });

  it("restoreCard records restored", () => {
    const board = archiveDone(moveCard(seed(), "a", "done"));
    expect(types(restoreCard(board, "a", { now: T1 }))).toEqual(["restored", "archived", "moved", "created"]);
  });

  it("undoArchive keeps the earlier history and records restored", () => {
    const board = moveCard(seed(), "a", "done");
    const archived = archiveDone(board);
    const undone = undoArchive(archived, board.columns.done, { now: T1 });
    expect(types(undone)).toEqual(["restored", "archived", "moved", "created"]);
    const again = archiveDone(undone);
    expect(types(again)).toEqual(["archived", "restored", "archived", "moved", "created"]);
  });

  it("caps the log at the newest entries", () => {
    let board = seed();
    for (let i = 0; i < MAX_ACTIVITY_ENTRIES + 5; i++) {
      board = setPriority(board, "a", i % 2 === 0 ? "high" : "low", { id: `e${i}` });
    }
    const log = activity(board);
    expect(log).toHaveLength(MAX_ACTIVITY_ENTRIES);
    expect(log[0].id).toBe(`e${MAX_ACTIVITY_ENTRIES + 4}`);
    expect(log.some((e) => e.type === "created")).toBe(false);
  });

  it("withActivity prepends the entry without mutating the card", () => {
    const card = findCard(seed(), "a")!.card;
    const next = withActivity(card, { type: "checklistDone", to: "item" }, { now: T1, id: "c1" });
    expect(next.activity?.[0]).toEqual({ id: "c1", at: T1.toISOString(), type: "checklistDone", to: "item" });
    expect(card.activity).toHaveLength(1);
  });
});
