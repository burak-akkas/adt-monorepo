import { boardLists, listCards } from "./lists";
import { MAX_WIP_LIMIT } from "./types";
import type { Board, ColumnId, WipLimitResult, WipState } from "./types";

// Parses the limit editor's text. Blank clears the limit; otherwise a whole number from 1 to MAX_WIP_LIMIT.
export function parseWipLimit(input: string): WipLimitResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: true, limit: undefined };
  }
  const limit = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  if (!(limit >= 1 && limit <= MAX_WIP_LIMIT)) {
    return { ok: false, error: `Enter a whole number from 1 to ${MAX_WIP_LIMIT}.` };
  }
  return { ok: true, limit };
}

export function isValidWipLimit(limit: unknown): limit is number {
  return typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= MAX_WIP_LIMIT;
}

// Sets, changes or (with `undefined`) clears a column's WIP limit. The key is removed once no limit is left.
export function setWipLimit(board: Board, column: ColumnId, limit: number | undefined): Board {
  if (limit !== undefined && !isValidWipLimit(limit)) {
    throw new Error(`WIP limit must be a whole number from 1 to ${MAX_WIP_LIMIT}`);
  }
  if (board.wipLimits?.[column] === limit) {
    return board;
  }
  const { wipLimits, ...rest } = board;
  const next = { ...wipLimits };
  if (limit === undefined) {
    delete next[column];
  } else {
    next[column] = limit;
  }
  return Object.keys(next).length === 0 ? rest : { ...rest, wipLimits: next };
}

export function isListCollapsed(board: Board, id: ColumnId): boolean {
  return board.collapsedLists?.includes(id) ?? false;
}

// Collapses an expanded list or expands a collapsed one. Unknown ids are ignored; the key is removed once empty.
export function toggleListCollapsed(board: Board, id: ColumnId): Board {
  const { collapsedLists, ...rest } = board;
  if (collapsedLists?.includes(id)) {
    const remaining = collapsedLists.filter((c) => c !== id);
    return remaining.length === 0 ? rest : { ...rest, collapsedLists: remaining };
  }
  if (!boardLists(board).some((l) => l.id === id)) {
    return board;
  }
  return { ...rest, collapsedLists: [...(collapsedLists ?? []), id] };
}

// Collapses every list, in list order. Returns the same board when all are already collapsed or there are none.
export function collapseAllLists(board: Board): Board {
  const lists = boardLists(board);
  if (lists.length === 0 || lists.every((l) => isListCollapsed(board, l.id))) {
    return board;
  }
  return { ...board, collapsedLists: lists.map((l) => l.id) };
}

// True when some list has no cards and is not collapsed yet (archived cards live outside the columns).
export function hasExpandedEmptyList(board: Board): boolean {
  return boardLists(board).some((l) => listCards(board, l.id).length === 0 && !isListCollapsed(board, l.id));
}

// Collapses every expanded list without cards, keeping already collapsed ids. Returns the same board when there are none.
export function collapseEmptyLists(board: Board): Board {
  if (!hasExpandedEmptyList(board)) {
    return board;
  }
  const added = boardLists(board)
    .filter((l) => listCards(board, l.id).length === 0 && !isListCollapsed(board, l.id))
    .map((l) => l.id);
  return { ...board, collapsedLists: [...(board.collapsedLists ?? []), ...added] };
}

// Expands every list by removing the key. Returns the same board when nothing is collapsed.
export function expandAllLists(board: Board): Board {
  if (!board.collapsedLists?.length) {
    return board;
  }
  const { collapsedLists, ...rest } = board;
  void collapsedLists;
  return rest;
}

// How a column's real card count compares to its limit. `over` is how many cards exceed it.
export function wipStatus(count: number, limit: number | undefined): { state: WipState; over: number } {
  if (limit === undefined) {
    return { state: "none", over: 0 };
  }
  if (count > limit) {
    return { state: "over", over: count - limit };
  }
  return { state: count === limit ? "at" : "ok", over: 0 };
}
