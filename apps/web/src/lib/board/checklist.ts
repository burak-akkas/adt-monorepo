import { findCard } from "./lists";
import { MAX_CHECKLIST_ITEM_LENGTH } from "./types";
import type { Board, Card, ChecklistItem } from "./types";

export function normalizeChecklistText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Checklist item must not be empty");
  }
  if (trimmed.length > MAX_CHECKLIST_ITEM_LENGTH) {
    throw new Error(`Checklist item must be at most ${MAX_CHECKLIST_ITEM_LENGTH} characters`);
  }
  return trimmed;
}

// Replaces a card's checklist with the result of `change`. Returns the same board when it returns the same list.
// An empty list removes the field.
function changeChecklist(
  board: Board,
  cardId: string,
  change: (items: ChecklistItem[]) => ChecklistItem[],
): Board {
  const found = findCard(board, cardId);
  if (!found) {
    throw new Error(`Card ${cardId} not found`);
  }
  const current = found.card.checklist ?? [];
  const next = change(current);
  if (next === current) {
    return board;
  }
  const updated: Card = { ...found.card, checklist: next };
  if (next.length === 0) {
    delete updated.checklist;
  }
  return {
    ...board,
    columns: {
      ...board.columns,
      [found.column]: board.columns[found.column].map((c) => (c.id === cardId ? updated : c)),
    },
  };
}

function findItemIndex(items: ChecklistItem[], itemId: string): number {
  const index = items.findIndex((item) => item.id === itemId);
  if (index === -1) {
    throw new Error(`Checklist item ${itemId} not found`);
  }
  return index;
}

// Appends an unchecked item.
export function addChecklistItem(
  board: Board,
  cardId: string,
  text: string,
  { id = crypto.randomUUID() }: { id?: string } = {},
): Board {
  const item: ChecklistItem = { id, text: normalizeChecklistText(text), done: false };
  return changeChecklist(board, cardId, (items) => [...items, item]);
}

export function toggleChecklistItem(board: Board, cardId: string, itemId: string): Board {
  return changeChecklist(board, cardId, (items) => {
    const index = findItemIndex(items, itemId);
    return items.map((item, i) => (i === index ? { ...item, done: !item.done } : item));
  });
}

export function editChecklistItem(board: Board, cardId: string, itemId: string, text: string): Board {
  const trimmed = normalizeChecklistText(text);
  return changeChecklist(board, cardId, (items) => {
    const index = findItemIndex(items, itemId);
    if (items[index].text === trimmed) {
      return items;
    }
    return items.map((item, i) => (i === index ? { ...item, text: trimmed } : item));
  });
}

export function deleteChecklistItem(board: Board, cardId: string, itemId: string): Board {
  return changeChecklist(board, cardId, (items) => {
    findItemIndex(items, itemId);
    return items.filter((item) => item.id !== itemId);
  });
}

// Moves an item one place up (-1) or down (1). Returns the same board at either end.
export function moveChecklistItem(board: Board, cardId: string, itemId: string, direction: -1 | 1): Board {
  return changeChecklist(board, cardId, (items) => {
    const index = findItemIndex(items, itemId);
    const target = index + direction;
    if (target < 0 || target >= items.length) {
      return items;
    }
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
}

// Unticks every item. Returns the same board when no item is ticked.
export function uncheckAllChecklistItems(board: Board, cardId: string): Board {
  return changeChecklist(board, cardId, (items) =>
    items.some((item) => item.done) ? items.map((item) => (item.done ? { ...item, done: false } : item)) : items,
  );
}

// True when some ticked item comes before an unticked one.
export function hasCompletedItemsAboveOpen(items: ChecklistItem[]): boolean {
  const firstDone = items.findIndex((item) => item.done);
  return firstDone !== -1 && items.slice(firstDone).some((item) => !item.done);
}

// Moves ticked items below unticked ones, keeping the order within each group. Returns the same board when already so.
export function moveCompletedChecklistItemsToBottom(board: Board, cardId: string): Board {
  return changeChecklist(board, cardId, (items) =>
    hasCompletedItemsAboveOpen(items)
      ? [...items.filter((item) => !item.done), ...items.filter((item) => item.done)]
      : items,
  );
}

// Removes every ticked item. Returns the same board when no item is ticked.
export function deleteCompletedChecklistItems(board: Board, cardId: string): Board {
  return changeChecklist(board, cardId, (items) =>
    items.some((item) => item.done) ? items.filter((item) => !item.done) : items,
  );
}

// Done and total checklist items, or `undefined` when the card has no checklist.
export function checklistProgress(card: Card): { done: number; total: number } | undefined {
  const items = card.checklist;
  if (!items || items.length === 0) {
    return undefined;
  }
  return { done: items.filter((item) => item.done).length, total: items.length };
}
