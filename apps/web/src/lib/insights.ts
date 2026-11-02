// Pure board metrics (cycle time, throughput, WIP over time, overdue cards).
// Every function reads the board, never mutates it, and takes an injectable `now`.
// Archived cards count as finished work.
//
// Limitation: a card's `activity` log is capped at MAX_ACTIVITY_ENTRIES, so very old history may
// be truncated. Such cards are left out of cycle times and WIP replays are approximate.

import { boardLists, formatDueDate, insightsListIds, isOverdue, listCards, todayString } from "@/lib/board";
import type { Board, Card, ColumnId } from "@/lib/board";

export interface InsightsOptions {
  now?: Date;
}

export const THROUGHPUT_WEEKS = 8;

export const WIP_DAYS = 14;

interface Move {
  at: number;
  from: string | undefined;
  to: string | undefined;
}

interface Located {
  card: Card;
  column: ColumnId;
  archived: boolean;
}

// Lists' cards plus the archive (archived cards count as finished, in the done list when there is one).
function allCards(board: Board): Located[] {
  const located: Located[] = [];
  for (const { id: column } of boardLists(board)) {
    for (const card of listCards(board, column)) {
      located.push({ card, column, archived: false });
    }
  }
  for (const card of board.archive) {
    located.push({ card, column: insightsListIds(board).done ?? "", archived: true });
  }
  return located;
}

// `moved` entries with a valid timestamp, oldest first. `activity` is stored newest first, so it is
// reversed before a stable sort to keep same-millisecond moves in their true order.
function movedEntries(card: Card): Move[] {
  const moves: Move[] = [];
  for (const entry of [...(card.activity ?? [])].reverse()) {
    const at = Date.parse(entry.at);
    if (entry.type === "moved" && !Number.isNaN(at)) {
      moves.push({ at, from: entry.from, to: entry.to });
    }
  }
  return moves.sort((a, b) => a.at - b.at);
}

export interface CycleTimes {
  durationsMs: number[];
  // Finished cards without a Doing entry and a Done entry at or after it.
  excluded: number;
}

// Earliest move to Doing until the latest move to Done at or after it, for cards in Done or the archive.
// Open cards are neither measured nor excluded.
// `opts` is unused; it keeps the signature uniform with the other metrics.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function cycleTimes(board: Board, _opts: InsightsOptions = {}): CycleTimes {
  const durationsMs: number[] = [];
  let excluded = 0;
  const { doing, done } = insightsListIds(board);
  for (const { card, column, archived } of allCards(board)) {
    if (!archived && (done === undefined || column !== done)) {
      continue;
    }
    const moves = movedEntries(card);
    const start = doing === undefined ? undefined : moves.find((m) => m.to === doing)?.at;
    const end =
      start === undefined || done === undefined ? undefined : moves.findLast((m) => m.to === done && m.at >= start)?.at;
    if (start === undefined || end === undefined) {
      excluded += 1;
    } else {
      durationsMs.push(end - start);
    }
  }
  return { durationsMs, excluded };
}

// `null` when there are no durations.
export function summarizeCycleTimes(durationsMs: readonly number[]): { median: number; average: number } | null {
  if (durationsMs.length === 0) {
    return null;
  }
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const average = sorted.reduce((sum, ms) => sum + ms, 0) / sorted.length;
  return { median, average };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// At most two units: "2d 3h", "1d", "45m". Below a minute (or invalid) gives "<1m".
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / MINUTE_MS) * MINUTE_MS : 0;
  if (total < MINUTE_MS) {
    return "<1m";
  }
  const units: [number, string][] = [
    [Math.floor(total / DAY_MS), "d"],
    [Math.floor((total % DAY_MS) / HOUR_MS), "h"],
    [Math.floor((total % HOUR_MS) / MINUTE_MS), "m"],
  ];
  const first = units.findIndex(([value]) => value > 0);
  return units
    .slice(first, first + 2)
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value}${unit}`)
    .join(" ");
}

export interface WeekThroughput {
  // Monday of the week, `YYYY-MM-DD` (local).
  weekStart: string;
  // Short readable date, e.g. "Oct 26".
  label: string;
  count: number;
}

// Monday 00:00 local of the week containing `date`, shifted by `weeks` weeks (local setters, so DST-safe).
function mondayStart(date: Date, weeks = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7) - 7 * weeks);
}

// 8 local Monday-start weeks, oldest first, current week included. A card counts once per week, at its
// latest move to Done in that week.
export function weeklyThroughput(board: Board, { now = new Date() }: InsightsOptions = {}): WeekThroughput[] {
  const starts = Array.from({ length: THROUGHPUT_WEEKS }, (_, i) => mondayStart(now, THROUGHPUT_WEEKS - 1 - i));
  const counts = starts.map(() => 0);
  const nowMs = now.getTime();
  const { done } = insightsListIds(board);
  for (const { card } of done === undefined ? [] : allCards(board)) {
    const weeks = new Set<number>();
    for (const move of movedEntries(card)) {
      if (move.to !== done || move.at > nowMs) {
        continue;
      }
      const week = starts.findLastIndex((start) => start.getTime() <= move.at);
      if (week !== -1) {
        weeks.add(week);
      }
    }
    for (const week of weeks) {
      counts[week] += 1;
    }
  }
  return starts.map((start, i) => {
    const weekStart = todayString(start);
    return { weekStart, label: formatDueDate(weekStart), count: counts[i] };
  });
}

export interface DayWip {
  // Local day, `YYYY-MM-DD`.
  day: string;
  count: number;
}

// The column a card was in at `cutoff` (ms), or `undefined` if it did not exist yet.
function columnAt(located: Located, moves: Move[], cutoff: number, isToday: boolean): string | undefined {
  const created = Date.parse(located.card.createdAt);
  if (!Number.isNaN(created) && created > cutoff) {
    return undefined;
  }
  const last = moves.findLast((m) => m.at <= cutoff);
  if (last) {
    return last.to;
  }
  if (moves.length > 0) {
    return moves[0].from;
  }
  // No history: only known to be in its current column from today.
  return isToday ? located.column : undefined;
}

// Cards in Doing at the end of each of the last 14 local days (today up to `now`), oldest first,
// found by replaying each card's moves.
export function dailyWip(board: Board, { now = new Date() }: InsightsOptions = {}): DayWip[] {
  const { doing } = insightsListIds(board);
  const cards = allCards(board).map((located) => ({ located, moves: movedEntries(located.card) }));
  return Array.from({ length: WIP_DAYS }, (_, i) => {
    const daysAgo = WIP_DAYS - 1 - i;
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
    const isToday = daysAgo === 0;
    const cutoff = isToday ? now.getTime() : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
    const count =
      doing === undefined
        ? 0
        : cards.filter(({ located, moves }) => columnAt(located, moves, cutoff, isToday) === doing).length;
    return { day: todayString(date), count };
  });
}

// Open (not in the done list) cards past their due date, soonest due first. Ties keep board order.
export function overdueCards(board: Board, { now = new Date() }: InsightsOptions = {}): Card[] {
  const today = todayString(now);
  const done = insightsListIds(board).done ?? null;
  return allCards(board)
    .filter(({ card, column, archived }) => !archived && isOverdue(card, column, today, done))
    .map(({ card }) => card)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
}
