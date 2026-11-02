import { describe, expect, it } from "vitest";
import { addCard, archiveDone, emptyBoard, moveCard, setDueDate } from "@/lib/board";
import { calendarCards, dateString, formatMonth, monthGrid, monthOf, shiftMonth } from "@/lib/calendar";

const inMonthDates = (year: number, month: number) =>
  monthGrid(year, month)
    .flat()
    .filter((d) => d.inMonth)
    .map((d) => d.date);

describe("monthGrid", () => {
  it("is always 6 weeks of 7 days", () => {
    for (const [y, m] of [[2026, 1], [2026, 2], [2026, 9], [2024, 1]]) {
      const grid = monthGrid(y, m);
      expect(grid).toHaveLength(6);
      for (const week of grid) {
        expect(week).toHaveLength(7);
      }
    }
  });

  it("covers 28, 29, 30 and 31 day months", () => {
    expect(inMonthDates(2026, 1)).toHaveLength(28);
    expect(inMonthDates(2024, 1)).toHaveLength(29);
    expect(inMonthDates(2026, 3)).toHaveLength(30);
    expect(inMonthDates(2026, 0)).toHaveLength(31);
  });

  it("includes Feb 29 only in leap years", () => {
    expect(inMonthDates(2024, 1)).toContain("2024-02-29");
    expect(inMonthDates(2026, 1)).not.toContain("2026-02-29");
  });

  it("starts the first week on Sunday by default (March 2026 starts on a Sunday)", () => {
    const grid = monthGrid(2026, 2);
    expect(grid[0][0]).toEqual({ date: "2026-03-01", inMonth: true });
    expect(grid[5][6].date).toBe("2026-04-11");
    expect(grid[5][6].inMonth).toBe(false);
  });

  it("pads with days of the previous month and honours the week start", () => {
    // April 1, 2026 is a Wednesday.
    expect(monthGrid(2026, 3)[0].map((d) => d.date)).toEqual([
      "2026-03-29",
      "2026-03-30",
      "2026-03-31",
      "2026-04-01",
      "2026-04-02",
      "2026-04-03",
      "2026-04-04",
    ]);
    expect(monthGrid(2026, 3, 1)[0][0]).toEqual({ date: "2026-03-30", inMonth: false });
    expect(monthGrid(2026, 3, 1)[0][2]).toEqual({ date: "2026-04-01", inMonth: true });
  });

  it("rolls over the year boundary", () => {
    const grid = monthGrid(2026, 11).flat();
    expect(grid.at(-1)?.date.startsWith("2027-01")).toBe(true);
    expect(monthGrid(2026, 0)[0][0].date.startsWith("2025-12")).toBe(true);
  });
});

describe("month helpers", () => {
  it("shifts across year boundaries", () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth({ year: 2026, month: 5 }, 0)).toEqual({ year: 2026, month: 5 });
  });

  it("reads the month of a date", () => {
    expect(monthOf("2026-03-05")).toEqual({ year: 2026, month: 2 });
  });

  it("formats a month with its year", () => {
    expect(formatMonth({ year: 2026, month: 2 })).toMatch(/2026/);
  });

  it("builds zero-padded date strings", () => {
    expect(dateString(2026, 0, 5)).toBe("2026-01-05");
    expect(dateString(2026, 12, 1)).toBe("2027-01-01");
  });
});

describe("calendarCards", () => {
  it("splits cards by due date and keeps list order within a day", () => {
    let b = emptyBoard();
    b = addCard(b, "Done one", { id: "a" });
    b = addCard(b, "Todo one", { id: "b" });
    b = addCard(b, "Plain", { id: "c" });
    b = moveCard(b, "a", "done");
    b = setDueDate(b, "a", "2026-03-05");
    b = setDueDate(b, "b", "2026-03-05");
    const { scheduled, unscheduled } = calendarCards(b);
    expect(scheduled.get("2026-03-05")?.map((e) => e.card.id)).toEqual(["b", "a"]);
    expect(scheduled.get("2026-03-05")?.map((e) => e.listId)).toEqual(["todo", "done"]);
    expect(unscheduled.map((e) => e.card.id)).toEqual(["c"]);
  });

  it("treats an invalid stored due date as unscheduled", () => {
    let b = emptyBoard();
    b = addCard(b, "Bad", { id: "a" });
    b = { ...b, columns: { ...b.columns, todo: b.columns.todo.map((c) => ({ ...c, dueDate: "nonsense" })) } };
    const { scheduled, unscheduled } = calendarCards(b);
    expect(scheduled.size).toBe(0);
    expect(unscheduled).toHaveLength(1);
  });

  it("leaves out archived cards", () => {
    let b = emptyBoard();
    b = addCard(b, "Old", { id: "a" });
    b = setDueDate(b, "a", "2026-03-05");
    b = moveCard(b, "a", "done");
    b = archiveDone(b);
    const { scheduled, unscheduled } = calendarCards(b);
    expect(scheduled.size).toBe(0);
    expect(unscheduled).toHaveLength(0);
  });
});
