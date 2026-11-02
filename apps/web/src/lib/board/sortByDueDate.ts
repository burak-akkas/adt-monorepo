import type { Board, Card } from "./types";

// True when at least one card on the board has a due date.
export function hasDueDates(board: Board): boolean {
  return Object.values(board.columns).some((cards) => cards.some((c) => c.dueDate));
}

// Stable: dated cards first (earliest first, equal dates keep their order), then undated cards in their order.
function sortCards(cards: Card[]): Card[] {
  const dated = cards.filter((c) => c.dueDate);
  const undated = cards.filter((c) => !c.dueDate);
  dated.sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0));
  return [...dated, ...undated];
}

// One-time sort of every list by due date. Cards stay in their own lists; nothing else changes.
export function sortListsByDueDate(board: Board): Board {
  const columns: Board["columns"] = {};
  for (const [id, cards] of Object.entries(board.columns)) {
    columns[id] = sortCards(cards);
  }
  return { ...board, columns };
}
