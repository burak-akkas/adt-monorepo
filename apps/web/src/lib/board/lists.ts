import { DEFAULT_LISTS, DELETED_LIST_NAME, MAX_LIST_NAME_LENGTH } from "./types";
import type { Board, BoardView, Card, ColumnId, InsightsLists, List, ListNameResult } from "./types";

export function emptyBoard(): Board {
  return {
    lists: DEFAULT_LISTS.map((l) => ({ ...l })),
    columns: { todo: [], doing: [], done: [] },
    archive: [],
    insightsLists: { doing: "doing", done: "done" },
  };
}

export function boardView(board: Board): BoardView {
  return board.view ?? "board";
}

// Chooses the view. "board" removes the key; the same view returns the same board.
export function setView(board: Board, view: BoardView): Board {
  if (boardView(board) === view) {
    return board;
  }
  const next: Board = { ...board, view };
  if (view === "board") {
    delete next.view;
  }
  return next;
}

export function boardLists(board: Board): readonly List[] {
  return board.lists ?? DEFAULT_LISTS;
}

// Cards of a list, in order. Unknown lists are empty.
export function listCards(board: Board, id: ColumnId): Card[] {
  return board.columns[id] ?? [];
}

// Name of a list: current name, else the name it had when deleted, else "Deleted list".
export function listName(board: Board, id: string | undefined): string {
  if (id === undefined) {
    return "";
  }
  return boardLists(board).find((l) => l.id === id)?.name ?? board.formerLists?.[id] ?? DELETED_LIST_NAME;
}

export function newListId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return `list-${cryptoApi.randomUUID()}`;
  }
  return `list-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// `ignoreId` is the list being renamed, so it may keep its own name (e.g. with different casing).
export function validateListName(name: string, lists: readonly List[], ignoreId?: string): ListNameResult {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, error: "List name must not be empty." };
  }
  if (trimmed.length > MAX_LIST_NAME_LENGTH) {
    return { ok: false, error: `List name must be at most ${MAX_LIST_NAME_LENGTH} characters.` };
  }
  const lower = trimmed.toLowerCase();
  if (lists.some((l) => l.id !== ignoreId && l.name.toLowerCase() === lower)) {
    return { ok: false, error: "A list with this name already exists." };
  }
  return { ok: true, name: trimmed };
}

// Shared with the other board modules; not re-exported from the board index.
export function requireList(board: Board, id: ColumnId): number {
  const index = boardLists(board).findIndex((l) => l.id === id);
  if (index === -1) {
    throw new Error(`List ${id} not found`);
  }
  return index;
}

// Appends an empty list. Throws on an invalid name.
export function addList(board: Board, name: string, { id = newListId() }: { id?: string } = {}): Board {
  const lists = boardLists(board);
  const result = validateListName(name, lists);
  if (!result.ok) {
    throw new Error(result.error);
  }
  if (lists.some((l) => l.id === id)) {
    throw new Error(`List ${id} already exists`);
  }
  return { ...board, lists: [...lists, { id, name: result.name }], columns: { ...board.columns, [id]: [] } };
}

// Throws on an unknown list or invalid name. Renaming to the same name returns the same board.
export function renameList(board: Board, id: ColumnId, name: string): Board {
  const index = requireList(board, id);
  const lists = boardLists(board);
  const result = validateListName(name, lists, id);
  if (!result.ok) {
    throw new Error(result.error);
  }
  if (lists[index].name === result.name) {
    return board;
  }
  return { ...board, lists: lists.map((l) => (l.id === id ? { ...l, name: result.name } : l)) };
}

// Moves a list one place left (-1) or right (1). Returns the same board at either end.
export function moveList(board: Board, id: ColumnId, direction: -1 | 1): Board {
  const index = requireList(board, id);
  const lists = boardLists(board);
  const target = index + direction;
  if (target < 0 || target >= lists.length) {
    return board;
  }
  const next = [...lists];
  [next[index], next[target]] = [next[target], next[index]];
  return { ...board, lists: next };
}

// Deletes a list. Refuses (throws) for the last list, and for a list with cards unless `moveTo` is another
// existing list: the cards are appended there. The list's WIP limit is dropped and its name remembered.
export function deleteList(board: Board, id: ColumnId, moveTo?: ColumnId): Board {
  const index = requireList(board, id);
  const lists = boardLists(board);
  if (lists.length <= 1) {
    throw new Error("The last list cannot be deleted");
  }
  const cards = listCards(board, id);
  if (cards.length > 0 && (moveTo === undefined || moveTo === id || !lists.some((l) => l.id === moveTo))) {
    throw new Error("Choose another list to move the cards to");
  }
  const columns = { ...board.columns };
  delete columns[id];
  if (cards.length > 0 && moveTo !== undefined) {
    columns[moveTo] = [...listCards(board, moveTo), ...cards];
  }
  const next: Board = {
    ...board,
    lists: lists.filter((l) => l.id !== id),
    columns,
    formerLists: { ...board.formerLists, [id]: lists[index].name },
  };
  if (board.wipLimits) {
    const limits = { ...board.wipLimits };
    delete limits[id];
    if (Object.keys(limits).length > 0) {
      next.wipLimits = limits;
    } else {
      delete next.wipLimits;
    }
  }
  if (board.collapsedLists) {
    const collapsed = board.collapsedLists.filter((c) => c !== id);
    if (collapsed.length > 0) {
      next.collapsedLists = collapsed;
    } else {
      delete next.collapsedLists;
    }
  }
  if (board.insightsLists) {
    const chosen = { ...board.insightsLists };
    if (chosen.doing === id) {
      delete chosen.doing;
    }
    if (chosen.done === id) {
      delete chosen.done;
    }
    next.insightsLists = chosen;
  }
  return next;
}

// The lists insights use as "in progress" and "done". Without a stored choice: lists named Doing / Done.
export function insightsListIds(board: Board): InsightsLists {
  const lists = boardLists(board);
  const known = (id: string | undefined) => (id !== undefined && lists.some((l) => l.id === id) ? id : undefined);
  if (board.insightsLists) {
    return { doing: known(board.insightsLists.doing), done: known(board.insightsLists.done) };
  }
  const named = (name: string) => lists.find((l) => l.name.toLowerCase() === name)?.id;
  return { doing: named("doing"), done: named("done") };
}

// Chooses the in-progress or done list (`undefined` clears it).
export function setInsightsList(board: Board, kind: "doing" | "done", id: ColumnId | undefined): Board {
  if (id !== undefined) {
    requireList(board, id);
  }
  const current = insightsListIds(board);
  if (board.insightsLists && current[kind] === id) {
    return board;
  }
  const next: InsightsLists = { ...current, [kind]: id };
  if (id === undefined) {
    delete next[kind];
  }
  return { ...board, insightsLists: next };
}

// Same board with every list's cards replaced by `change(cards, listId)`. Shared with the other board
// modules; not re-exported from the board index.
export function mapLists(board: Board, change: (cards: Card[], id: ColumnId) => Card[]): Board {
  const columns: Record<ColumnId, Card[]> = { ...board.columns };
  for (const { id } of boardLists(board)) {
    columns[id] = change(listCards(board, id), id);
  }
  return { ...board, columns };
}

export function findCard(board: Board, cardId: string): { card: Card; column: ColumnId } | undefined {
  for (const { id: column } of boardLists(board)) {
    const card = listCards(board, column).find((c) => c.id === cardId);
    if (card) {
      return { card, column };
    }
  }
  return undefined;
}

// Neighbouring list, for the "move left / right" buttons.
export function adjacentColumn(
  column: ColumnId,
  direction: -1 | 1,
  lists: readonly List[] = DEFAULT_LISTS,
): ColumnId | undefined {
  const index = lists.findIndex((l) => l.id === column);
  return index === -1 ? undefined : lists[index + direction]?.id;
}
