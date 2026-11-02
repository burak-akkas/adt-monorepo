import type { Board } from "./types";

// One-time A→Z sort of a single list by title, ignoring case. Stable: equal titles keep their order.
// Returns the same board when the list is missing or has fewer than 2 cards.
export function sortListByTitle(board: Board, columnId: string): Board {
  const cards = board.columns[columnId];
  if (!cards || cards.length < 2) return board;
  const sorted = [...cards].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  return { ...board, columns: { ...board.columns, [columnId]: sorted } };
}
