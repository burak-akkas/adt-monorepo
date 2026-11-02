import { describe, expect, it } from "vitest";
import {
  addCard,
  addDays,
  addList,
  cardDueStatus,
  deleteList,
  emptyBoard,
  dueStatus,
  findCard,
  formatDueDate,
  insightsListIds,
  isCardOverdue,
  isOverdue,
  isValidDueDate,
  moveCard,
  moveList,
  renameList,
  setDueDate,
  setInsightsList,
  todayString,
} from "@/lib/board";

describe("addDays", () => {
  it("adds days across month, year and leap-day boundaries", () => {
    expect(addDays("2024-01-31", 1)).toBe("2024-02-01");
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2023-02-28", 1)).toBe("2023-03-01");
  });

  it("returns the same day for 0 and handles a week across DST", () => {
    expect(addDays("2025-03-25", 0)).toBe("2025-03-25");
    expect(addDays("2025-03-25", 7)).toBe("2025-04-01");
    expect(addDays("2025-10-28", 7)).toBe("2025-11-04");
  });
});

describe("due dates", () => {
  const base = addCard(emptyBoard(), "Task", { id: "a" });
  const withDate = setDueDate(base, "a", "2026-10-28");
  const card = () => findCard(withDate, "a")!.card;

  it("sets, changes and clears a due date", () => {
    expect(card().dueDate).toBe("2026-10-28");
    const changed = setDueDate(withDate, "a", "2026-11-01");
    expect(findCard(changed, "a")!.card.dueDate).toBe("2026-11-01");
    const cleared = setDueDate(changed, "a", undefined);
    expect("dueDate" in findCard(cleared, "a")!.card).toBe(false);
  });

  it("does not mutate its input", () => {
    const snapshot = structuredClone(base);
    setDueDate(base, "a", "2026-10-28");
    expect(base).toEqual(snapshot);
  });

  it("returns the same board when nothing changes", () => {
    expect(setDueDate(withDate, "a", "2026-10-28")).toBe(withDate);
    expect(setDueDate(base, "a", undefined)).toBe(base);
  });

  it("throws for an unknown card or an invalid date", () => {
    expect(() => setDueDate(base, "zzz", "2026-10-28")).toThrow(/not found/);
    for (const bad of ["2026-13-01", "2026-02-31", "abc", "", "2026-1-1"]) {
      expect(() => setDueDate(base, "a", bad)).toThrow(/valid/);
    }
  });

  it("validates dates", () => {
    expect(isValidDueDate("2024-02-29")).toBe(true);
    expect(isValidDueDate("2026-02-29")).toBe(false);
  });

  it("formats today's local date", () => {
    expect(todayString(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("flags overdue cards with an injectable today", () => {
    expect(isOverdue(card(), "todo", "2026-10-29", "done")).toBe(true);
    expect(isOverdue(card(), "doing", "2026-10-29", "done")).toBe(true);
    expect(isOverdue(card(), "todo", "2026-10-28", "done")).toBe(false);
    expect(isOverdue(card(), "todo", "2026-10-27", "done")).toBe(false);
    expect(isOverdue(base.columns.todo[0], "todo", "2030-01-01", "done")).toBe(false);
    expect(isOverdue(card(), "done", "2026-10-29", "done")).toBe(false);
  });

  it("has no done list when doneId is null, even for a list with the id done", () => {
    expect(isOverdue(card(), "done", "2026-10-29", null)).toBe(true);
    expect(isOverdue(card(), "done", "2026-10-29", "shipped")).toBe(true);
    expect(isOverdue(card(), "shipped", "2026-10-29", "shipped")).toBe(false);
  });

  it("keeps the due date when moving into and out of Done", () => {
    const done = moveCard(withDate, "a", "done");
    expect(findCard(done, "a")!.card.dueDate).toBe("2026-10-28");
    expect(isCardOverdue(done, findCard(done, "a")!.card, "done", "2030-01-01")).toBe(false);
    const back = moveCard(done, "a", "doing");
    expect(isCardOverdue(back, findCard(back, "a")!.card, "doing", "2030-01-01")).toBe(true);
  });

  it("follows the designated done list when it is renamed or reordered", () => {
    const renamed = moveList(renameList(moveCard(withDate, "a", "done"), "done", "Shipped"), "done", -1);
    const moved = findCard(renamed, "a")!;
    expect(isCardOverdue(renamed, moved.card, "done", "2030-01-01")).toBe(false);
    expect(cardDueStatus(renamed, moved.card, "done", "2030-01-01")).toBeNull();
  });

  it("treats a list with the id done as ordinary once another list is the done list", () => {
    const board = setInsightsList(addList(withDate, "Shipped", { id: "shipped" }), "done", "shipped");
    expect(isCardOverdue(board, card(), "done", "2030-01-01")).toBe(true);
    expect(isCardOverdue(board, card(), "shipped", "2030-01-01")).toBe(false);
    expect(cardDueStatus(board, card(), "shipped", "2030-01-01")).toBeNull();
  });

  it("has no done list after the done list is deleted", () => {
    const board = deleteList(withDate, "done");
    expect(insightsListIds(board).done).toBeUndefined();
    expect(isCardOverdue(board, card(), "todo", "2030-01-01")).toBe(true);
    expect(isCardOverdue(board, card(), "doing", "2030-01-01")).toBe(true);
  });

  it("formats the date without a timezone shift", () => {
    expect(formatDueDate("2026-10-28")).toMatch(/28/);
    expect(formatDueDate("2026-01-01")).toMatch(/1/);
  });
});

describe("dueStatus", () => {
  const due = (dueDate?: string) => findCard(setDueDate(addCard(emptyBoard(), "T", { id: "a" }), "a", dueDate), "a")!.card;

  it("classifies overdue, today and tomorrow, and nothing for later dates", () => {
    expect(dueStatus(due("2026-10-28"), "todo", "2026-10-29", "done")).toBe("overdue");
    expect(dueStatus(due("2026-10-29"), "todo", "2026-10-29", "done")).toBe("today");
    expect(dueStatus(due("2026-10-30"), "todo", "2026-10-29", "done")).toBe("tomorrow");
    expect(dueStatus(due("2026-10-31"), "todo", "2026-10-29", "done")).toBeNull();
  });

  it("handles month and year ends", () => {
    expect(dueStatus(due("2027-01-01"), "todo", "2026-12-31", "done")).toBe("tomorrow");
    expect(dueStatus(due("2026-03-01"), "todo", "2026-02-28", "done")).toBe("tomorrow");
  });

  it("is null without a due date or in the done list", () => {
    expect(dueStatus(due(), "todo", "2026-10-29", "done")).toBeNull();
    expect(dueStatus(due("2026-10-28"), "done", "2026-10-29", "done")).toBeNull();
    expect(dueStatus(due("2026-10-29"), "done", "2026-10-29", "done")).toBeNull();
    expect(dueStatus(due("2026-10-30"), "done", "2026-10-29", "done")).toBeNull();
  });

  it("shows a status in a list named done when it is not the done list", () => {
    expect(dueStatus(due("2026-10-28"), "done", "2026-10-29", null)).toBe("overdue");
    expect(dueStatus(due("2026-10-28"), "done", "2026-10-29", "shipped")).toBe("overdue");
  });
});
