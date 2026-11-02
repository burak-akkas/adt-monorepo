import type { Board } from "./types";
import { boardLists, insightsListIds, listCards } from "./lists";

// Cards in every list except the done list. Archived cards live in `board.archive`, so they never count.
export function openCardCount(board: Board): number {
  const { done } = insightsListIds(board);
  return boardLists(board)
    .filter((list) => list.id !== done)
    .reduce((total, list) => total + listCards(board, list.id).length, 0);
}

// Browser tab title: "<name> (<open>) · Kanban", or "<name> · Kanban" when nothing is open.
export function boardTitle(name: string, board: Board): string {
  const open = openCardCount(board);
  return open > 0 ? `${name} (${open}) · Kanban` : `${name} · Kanban`;
}
