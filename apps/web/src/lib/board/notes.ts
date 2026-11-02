import { withActivity } from "./activity";
import { findCard } from "./lists";
import { MAX_NOTES_LENGTH } from "./types";
import type { ActivityOptions, Board, Card } from "./types";

// Sets, changes or clears a card's notes. Blank notes (or `undefined`) clear them.
export function setNotes(board: Board, cardId: string, notes: string | undefined, opts: ActivityOptions = {}): Board {
  const found = findCard(board, cardId);
  if (!found) {
    throw new Error(`Card ${cardId} not found`);
  }
  const trimmed = notes?.trim() || undefined;
  if (trimmed !== undefined && trimmed.length > MAX_NOTES_LENGTH) {
    throw new Error(`Card notes must be at most ${MAX_NOTES_LENGTH} characters`);
  }
  if (found.card.notes === trimmed) {
    return board;
  }
  let updated: Card = { ...found.card, notes: trimmed };
  if (trimmed === undefined) {
    delete updated.notes;
  }
  updated = withActivity(updated, { type: "description" }, opts);
  return {
    ...board,
    columns: {
      ...board.columns,
      [found.column]: board.columns[found.column].map((c) => (c.id === cardId ? updated : c)),
    },
  };
}
