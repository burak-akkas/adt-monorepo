// Pure logic for the calendar view: the month grid and the split of open cards into scheduled/unscheduled.
// Dates are `YYYY-MM-DD` strings built from local date parts, so timezones never shift a day.
import { boardLists, isValidDueDate, listCards, type Board, type Card, type ColumnId } from "./board";

export interface MonthRef {
  year: number;
  // 0-based, like `Date#getMonth`.
  month: number;
}

export interface GridDay {
  date: string;
  inMonth: boolean;
}

export interface CalendarCard {
  card: Card;
  listId: ColumnId;
}

export const WEEKS_IN_GRID = 6;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function dateString(year: number, month: number, day: number): string {
  // Let `Date` normalise overflowing months/days (e.g. month 12 -> January of the next year).
  const d = new Date(year, month, day);
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The month containing a `YYYY-MM-DD` date.
export function monthOf(date: string): MonthRef {
  const [year, month] = date.split("-").map(Number);
  return { year, month: month - 1 };
}

export function shiftMonth({ year, month }: MonthRef, delta: number): MonthRef {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

// E.g. "March 2026".
export function formatMonth({ year, month }: MonthRef): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// E.g. "March 5, 2026".
export function formatLongDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

// Always 6 weeks x 7 days so the grid keeps a stable height. `weekStart`: 0 = Sunday ... 6 = Saturday.
export function monthGrid(year: number, month: number, weekStart = 0): GridDay[][] {
  const lead = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
  return Array.from({ length: WEEKS_IN_GRID }, (_, week) =>
    Array.from({ length: 7 }, (_, dayOfWeek) => {
      const d = new Date(year, month, 1 - lead + week * 7 + dayOfWeek);
      return { date: dateString(d.getFullYear(), d.getMonth(), d.getDate()), inMonth: d.getMonth() === month };
    }),
  );
}

// Open cards (archive and templates are never in `columns`) by due date; cards without a valid date are unscheduled.
// Order within a day and in the unscheduled list follows list order.
export function calendarCards(board: Board): { scheduled: Map<string, CalendarCard[]>; unscheduled: CalendarCard[] } {
  const scheduled = new Map<string, CalendarCard[]>();
  const unscheduled: CalendarCard[] = [];
  for (const { id: listId } of boardLists(board)) {
    for (const card of listCards(board, listId)) {
      if (card.dueDate && isValidDueDate(card.dueDate)) {
        scheduled.set(card.dueDate, [...(scheduled.get(card.dueDate) ?? []), { card, listId }]);
      } else {
        unscheduled.push({ card, listId });
      }
    }
  }
  return { scheduled, unscheduled };
}
