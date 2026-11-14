import { findCard } from "./lists";
import type { Board, Card } from "./types";

const normalizeEmail = (email: string) => email.trim().toLowerCase();

function withAssignees(board: Board, cardId: string, assignees: string[]): Board {
  const found = findCard(board, cardId);
  if (!found) {
    return board;
  }
  const updated: Card = { ...found.card, assignees };
  if (assignees.length === 0) {
    delete updated.assignees;
  }
  return {
    ...board,
    columns: {
      ...board.columns,
      [found.column]: board.columns[found.column].map((c) => (c.id === cardId ? updated : c)),
    },
  };
}

// Adds an assignee (lower-cased email) at the end. A duplicate or an unknown card returns the same board.
export function assignToCard(board: Board, cardId: string, email: string): Board {
  const wanted = normalizeEmail(email);
  const found = findCard(board, cardId);
  if (!found || !wanted || (found.card.assignees ?? []).includes(wanted)) {
    return board;
  }
  return withAssignees(board, cardId, [...(found.card.assignees ?? []), wanted]);
}

// Removes an assignee. Removing the last one deletes the field. Not assigned or unknown card returns the same board.
export function unassignFromCard(board: Board, cardId: string, email: string): Board {
  const wanted = normalizeEmail(email);
  const found = findCard(board, cardId);
  if (!found || !(found.card.assignees ?? []).includes(wanted)) {
    return board;
  }
  return withAssignees(
    board,
    cardId,
    (found.card.assignees ?? []).filter((a) => a !== wanted),
  );
}

export function isAssignedTo(card: Card, email: string): boolean {
  return (card.assignees ?? []).includes(normalizeEmail(email));
}

// First letter of the part before the `@`, upper-cased; "?" when there is none.
export function assigneeInitials(email: string): string {
  const first = Array.from(email.trim().split("@")[0])[0];
  return first ? first.toUpperCase() : "?";
}
