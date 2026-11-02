import { withActivity } from "./activity";
import { setDueDate } from "./dates";
import { setLabels } from "./labels";
import { boardLists, findCard, listCards } from "./lists";
import { setNotes } from "./notes";
import { DEFAULT_PRIORITY, MAX_TITLE_LENGTH, isCoverColor } from "./types";
import type { ActivityOptions, Board, Card, CardEdits, ColumnId, CoverColor, Priority } from "./types";

function normalizeTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error("Card title must not be empty");
  }
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new Error(`Card title must be at most ${MAX_TITLE_LENGTH} characters`);
  }
  return trimmed;
}

export function addCard(
  board: Board,
  title: string,
  { id = crypto.randomUUID(), now = new Date(), listId }: { id?: string; now?: Date; listId?: string } = {},
): Board {
  const base: Card = {
    id,
    title: normalizeTitle(title),
    createdAt: now.toISOString(),
    priority: DEFAULT_PRIORITY,
  };
  const card = withActivity(base, { type: "created" }, { now });
  // New cards go to the chosen list, or the first list when none (or an unknown one) is given.
  const lists = boardLists(board);
  const target = lists.find((l) => l.id === listId)?.id ?? lists[0].id;
  return { ...board, columns: { ...board.columns, [target]: [...listCards(board, target), card] } };
}

export function setPriority(board: Board, cardId: string, priority: Priority, opts: ActivityOptions = {}): Board {
  const found = findCard(board, cardId);
  if (!found) {
    throw new Error(`Card ${cardId} not found`);
  }
  if (found.card.priority === priority) {
    return board;
  }
  return {
    ...board,
    columns: {
      ...board.columns,
      [found.column]: board.columns[found.column].map((c) => (c.id === cardId ? withActivity({ ...c, priority }, { type: "priority", from: c.priority, to: priority }, opts) : c),
      ),
    },
  };
}

// Sets or clears (undefined) the cover color. Returns the same board when nothing changes.
export function setCover(board: Board, cardId: string, cover: CoverColor | undefined): Board {
  const found = findCard(board, cardId);
  if (!found) {
    throw new Error(`Card ${cardId} not found`);
  }
  if (cover !== undefined && !isCoverColor(cover)) {
    throw new Error(`Unknown cover color ${String(cover)}`);
  }
  if (found.card.cover === cover) {
    return board;
  }
  return {
    ...board,
    columns: {
      ...board.columns,
      [found.column]: board.columns[found.column].map((c) => {
        if (c.id !== cardId) {
          return c;
        }
        const updated = { ...c, cover };
        if (cover === undefined) {
          delete updated.cover;
        }
        return updated;
      }),
    },
  };
}

export function renameCard(board: Board, cardId: string, title: string, opts: ActivityOptions = {}): Board {
  const found = findCard(board, cardId);
  if (!found) {
    throw new Error(`Card ${cardId} not found`);
  }
  const trimmed = normalizeTitle(title);
  if (trimmed === found.card.title) {
    return board;
  }
  return {
    ...board,
    columns: {
      ...board.columns,
      [found.column]: board.columns[found.column].map((c) => (c.id === cardId ? withActivity({ ...c, title: trimmed }, { type: "title", from: c.title, to: trimmed }, opts) : c),
      ),
    },
  };
}

export function moveCard(board: Board, cardId: string, to: ColumnId, opts: ActivityOptions = {}): Board {
  const found = findCard(board, cardId);
  if (!found) {
    throw new Error(`Card ${cardId} not found`);
  }
  if (found.column === to) {
    return board;
  }
  if (!boardLists(board).some((l) => l.id === to)) {
    throw new Error(`List ${to} not found`);
  }
  return {
    ...board,
    columns: {
      ...board.columns,
      [found.column]: board.columns[found.column].filter((c) => c.id !== cardId),
      [to]: [...listCards(board, to), withActivity(found.card, { type: "moved", from: found.column, to }, opts)],
    },
  };
}

// Moves a card to the top or bottom of its own list. Returns the same board when it is already there.
export function reorderCard(board: Board, cardId: string, to: "top" | "bottom"): Board {
  const found = findCard(board, cardId);
  if (!found) {
    throw new Error(`Card ${cardId} not found`);
  }
  const cards = board.columns[found.column];
  const index = cards.findIndex((c) => c.id === cardId);
  if (to === "top" ? index === 0 : index === cards.length - 1) {
    return board;
  }
  const rest = cards.filter((c) => c.id !== cardId);
  return {
    ...board,
    columns: { ...board.columns, [found.column]: to === "top" ? [found.card, ...rest] : [...rest, found.card] },
  };
}

const COPY_SUFFIX = " (copy)";

// Inserts a copy right after the original, in the same column. The copy keeps notes, priority, due date,
// labels and checklist text (items unticked, new ids); comments and activity are not copied.
export function duplicateCard(
  board: Board,
  cardId: string,
  { id = crypto.randomUUID(), now = new Date() }: { id?: string; now?: Date } = {},
): Board {
  const found = findCard(board, cardId);
  if (!found) {
    throw new Error(`Card ${cardId} not found`);
  }
  const { card: original, column } = found;
  let copy: Card = {
    id,
    title: original.title.slice(0, MAX_TITLE_LENGTH - COPY_SUFFIX.length).trimEnd() + COPY_SUFFIX,
    createdAt: now.toISOString(),
    priority: original.priority,
  };
  if (original.dueDate !== undefined) {
    copy.dueDate = original.dueDate;
  }
  if (original.notes !== undefined) {
    copy.notes = original.notes;
  }
  if (original.labels && original.labels.length > 0) {
    copy.labels = [...original.labels];
  }
  if (original.checklist && original.checklist.length > 0) {
    copy.checklist = original.checklist.map((item) => ({ id: crypto.randomUUID(), text: item.text, done: false }));
  }
  copy = withActivity(copy, { type: "duplicated", from: original.title }, { now });
  const cards = board.columns[column];
  const index = cards.findIndex((c) => c.id === cardId);
  return {
    ...board,
    columns: { ...board.columns, [column]: [...cards.slice(0, index + 1), copy, ...cards.slice(index + 1)] },
  };
}

export function deleteCard(board: Board, cardId: string): Board {
  const found = findCard(board, cardId);
  if (!found) {
    throw new Error(`Card ${cardId} not found`);
  }
  return {
    ...board,
    columns: {
      ...board.columns,
      [found.column]: board.columns[found.column].filter((c) => c.id !== cardId),
    },
  };
}

// Applies every edit at once. Validates first (the setters throw), so nothing is half-applied.
export function updateCard(board: Board, cardId: string, edits: CardEdits, opts: { now?: Date } = {}): Board {
  let next = renameCard(board, cardId, edits.title, opts);
  next = setNotes(next, cardId, edits.notes, opts);
  if ("cover" in edits) {
    next = setCover(next, cardId, edits.cover);
  }
  if (edits.labels !== undefined) {
    next = setLabels(next, cardId, edits.labels);
  }
  next = setPriority(next, cardId, edits.priority, opts);
  next = setDueDate(next, cardId, edits.dueDate, opts);
  return moveCard(next, cardId, edits.column, opts);
}

// Whether a dialog draft differs from the stored card. Whitespace-only differences in title/notes don't count.
export function hasChanges(card: Card, column: ColumnId, draft: CardEdits): boolean {
  return (
    draft.title.trim() !== card.title ||
    (draft.notes?.trim() || undefined) !== card.notes ||
    draft.priority !== card.priority ||
    (draft.dueDate || undefined) !== card.dueDate ||
    draft.column !== column ||
    ("cover" in draft && draft.cover !== card.cover) ||
    (draft.labels !== undefined &&
      (draft.labels.length !== (card.labels ?? []).length ||
        draft.labels.some((l, i) => l.trim() !== (card.labels ?? [])[i])))
  );
}
