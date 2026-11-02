import { isOverdue, todayString } from "./dates";
import { boardLists, insightsListIds, listCards, mapLists } from "./lists";
import type { Board, BoardStats } from "./types";

export function isFiltering(query: string): boolean {
  return query.trim() !== "";
}

// Cards whose title contains the query (case-insensitive, trimmed). A blank query returns the same board.
export function filterCards(board: Board, query: string): Board {
  if (!isFiltering(query)) {
    return board;
  }
  const q = query.trim().toLowerCase();
  return mapLists(board, (cards) => cards.filter((c) => c.title.toLowerCase().includes(q)));
}

export function boardStats(board: Board, today: string = todayString()): BoardStats {
  let total = 0;
  let overdue = 0;
  let highOpen = 0;
  const doneId = insightsListIds(board).done;
  for (const { id: column } of boardLists(board)) {
    for (const card of listCards(board, column)) {
      total += 1;
      if (isOverdue(card, column, today, doneId ?? null)) {
        overdue += 1;
      }
      if (column !== doneId && card.priority === "high") {
        highOpen += 1;
      }
    }
  }
  const done = doneId === undefined ? 0 : listCards(board, doneId).length;
  return { total, done, percentDone: total === 0 ? 0 : Math.round((done / total) * 100), overdue, highOpen };
}

// How many cards in one list are overdue (always 0 for the done list).
export function listOverdueCount(board: Board, listId: string, today: string = todayString()): number {
  const doneId = insightsListIds(board).done ?? null;
  return listCards(board, listId).filter((c) => isOverdue(c, listId, today, doneId)).length;
}

// Only the overdue cards (due before today, not in the done list).
export function filterOverdue(board: Board, today: string = todayString()): Board {
  const doneId = insightsListIds(board).done ?? null;
  return mapLists(board, (cards, id) => cards.filter((c) => isOverdue(c, id, today, doneId)));
}
