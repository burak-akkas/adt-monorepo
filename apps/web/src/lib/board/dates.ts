import { withActivity } from "./activity";
import { findCard, insightsListIds } from "./lists";
import type { ActivityOptions, Board, Card, ColumnId } from "./types";

export function isValidDueDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

// Sets, changes or (with `undefined`) clears a card's due date.
export function setDueDate(board: Board, cardId: string, date: string | undefined, opts: ActivityOptions = {}): Board {
  const found = findCard(board, cardId);
  if (!found) {
    throw new Error(`Card ${cardId} not found`);
  }
  if (date !== undefined && !isValidDueDate(date)) {
    throw new Error("Due date must be a valid YYYY-MM-DD date");
  }
  if (found.card.dueDate === date) {
    return board;
  }
  let updated: Card = { ...found.card, dueDate: date };
  if (date === undefined) {
    delete updated.dueDate;
  }
  updated = withActivity(updated, { type: "dueDate", from: found.card.dueDate, to: date }, opts);
  return {
    ...board,
    columns: {
      ...board.columns,
      [found.column]: board.columns[found.column].map((c) => (c.id === cardId ? updated : c)),
    },
  };
}

// Local calendar day as `YYYY-MM-DD`.
export function todayString(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear()).padStart(4, "0")}-${month}-${day}`;
}

// Overdue = due before today and not in the done list (`doneId`: the board's resolved done list, `null` when there is none).
// Due today is not overdue.
export function isOverdue(card: Card, column: ColumnId, today: string, doneId: ColumnId | null): boolean {
  return column !== doneId && !!card.dueDate && card.dueDate < today;
}

// Whether a card in `column` is overdue on this board (its done list is not overdue).
export function isCardOverdue(board: Board, card: Card, column: ColumnId, today: string = todayString()): boolean {
  return isOverdue(card, column, today, insightsListIds(board).done ?? null);
}

export type DueStatus = "overdue" | "today" | "tomorrow";

// `date` (`YYYY-MM-DD`) shifted by `days` calendar days, as a local calendar day (safe across DST).
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return todayString(new Date(year, month - 1, day + days));
}

function nextDay(date: string): string {
  return addDays(date, 1);
}

// Due status of a card in `column`: overdue, due today or due tomorrow, else null (also for the done list).
export function dueStatus(
  card: Card,
  column: ColumnId,
  today: string,
  doneId: ColumnId | null,
): DueStatus | null {
  if (!card.dueDate || column === doneId) {
    return null;
  }
  if (isOverdue(card, column, today, doneId)) {
    return "overdue";
  }
  if (card.dueDate === today) {
    return "today";
  }
  return card.dueDate === nextDay(today) ? "tomorrow" : null;
}

// Due status of a card in `column` on this board.
export function cardDueStatus(board: Board, card: Card, column: ColumnId, today: string = todayString()): DueStatus | null {
  return dueStatus(card, column, today, insightsListIds(board).done ?? null);
}

function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

// Hint relative to `today`: "Due today", "Due tomorrow", "Due in 5 days", "Overdue by 1 day".
// Empty string for a missing or invalid date.
export function relativeDueHint(date: string, today: string = todayString()): string {
  if (!isValidDueDate(date)) {
    return "";
  }
  const diff = dayNumber(date) - dayNumber(today);
  if (diff === 0) {
    return "Due today";
  }
  if (diff === 1) {
    return "Due tomorrow";
  }
  if (diff > 1) {
    return `Due in ${diff} days`;
  }
  return diff === -1 ? "Overdue by 1 day" : `Overdue by ${-diff} days`;
}

// Short readable date (e.g. "Oct 28"). Parsed as a local date so the day never shifts by timezone.
export function formatDueDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
