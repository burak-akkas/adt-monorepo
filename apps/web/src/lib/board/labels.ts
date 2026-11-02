import { boardLists, findCard, listCards, mapLists } from "./lists";
import { MAX_LABEL_LENGTH } from "./types";
import type { Board, Card } from "./types";

export function normalizeLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Label must not be empty");
  }
  if (trimmed.length > MAX_LABEL_LENGTH) {
    throw new Error(`Label must be at most ${MAX_LABEL_LENGTH} characters`);
  }
  return trimmed;
}

const sameLabel = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Returns a new list with the label added at the end. Throws on empty, too long or duplicate (case-insensitive).
export function addLabelToList(labels: readonly string[], name: string): string[] {
  const label = normalizeLabel(name);
  if (labels.some((l) => sameLabel(l, label))) {
    throw new Error(`Label "${label}" already exists`);
  }
  return [...labels, label];
}

export function removeLabelFromList(labels: readonly string[], name: string): string[] {
  return labels.filter((l) => !sameLabel(l, name.trim()));
}

// Replaces a card's labels. An empty list (or `undefined`) removes the field.
export function setLabels(board: Board, cardId: string, labels: readonly string[] | undefined): Board {
  const found = findCard(board, cardId);
  if (!found) {
    throw new Error(`Card ${cardId} not found`);
  }
  let next: string[] = [];
  for (const name of labels ?? []) {
    next = addLabelToList(next, name);
  }
  const current = found.card.labels ?? [];
  if (current.length === next.length && current.every((l, i) => l === next[i])) {
    return board;
  }
  const updated: Card = { ...found.card, labels: next };
  if (next.length === 0) {
    delete updated.labels;
  }
  return {
    ...board,
    columns: {
      ...board.columns,
      [found.column]: board.columns[found.column].map((c) => (c.id === cardId ? updated : c)),
    },
  };
}

// Full class strings (not built dynamically) so Tailwind can see them.
export const LABEL_PALETTE: readonly string[] = [
  "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-300",
  "bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300",
];

// Deterministic, case-insensitive color classes for a label name.
export function labelColor(name: string): string {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return LABEL_PALETTE[hash % LABEL_PALETTE.length];
}

// Distinct labels in use on the board (first spelling wins), sorted alphabetically.
export function boardLabels(board: Board): string[] {
  const seen = new Map<string, string>();
  for (const { id: column } of boardLists(board)) {
    for (const card of listCards(board, column)) {
      for (const label of card.labels ?? []) {
        const key = label.toLowerCase();
        if (!seen.has(key)) {
          seen.set(key, label);
        }
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

// Only cards having the label (case-insensitive). A `null` label returns the same board.
export function filterByLabel(board: Board, label: string | null): Board {
  if (label === null) {
    return board;
  }
  const has = (c: Card) => (c.labels ?? []).some((l) => sameLabel(l, label));
  return mapLists(board, (cards) => cards.filter(has));
}
