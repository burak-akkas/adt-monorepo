import { findCard } from "./lists";
import { MAX_COMMENT_LENGTH } from "./types";
import type { Board, Card, CardComment } from "./types";

function normalizeCommentText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Comment must not be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Comment must be at most ${MAX_COMMENT_LENGTH} characters`);
  }
  return trimmed;
}

// Replaces a card's comments. An empty list removes the field.
function withComments(board: Board, cardId: string, comments: CardComment[]): Board {
  const found = findCard(board, cardId);
  if (!found) {
    throw new Error(`Card ${cardId} not found`);
  }
  const updated: Card = { ...found.card, comments };
  if (comments.length === 0) {
    delete updated.comments;
  }
  return {
    ...board,
    columns: {
      ...board.columns,
      [found.column]: board.columns[found.column].map((c) => (c.id === cardId ? updated : c)),
    },
  };
}

function findComment(board: Board, cardId: string, commentId: string): CardComment[] {
  const found = findCard(board, cardId);
  if (!found) {
    throw new Error(`Card ${cardId} not found`);
  }
  const comments = found.card.comments ?? [];
  if (!comments.some((c) => c.id === commentId)) {
    throw new Error(`Comment ${commentId} not found`);
  }
  return comments;
}

// Appends a comment (oldest first). Throws on blank or over-long text.
export function addComment(
  board: Board,
  cardId: string,
  text: string,
  { id = crypto.randomUUID(), now = new Date() }: { id?: string; now?: Date } = {},
): Board {
  const found = findCard(board, cardId);
  if (!found) {
    throw new Error(`Card ${cardId} not found`);
  }
  const comment: CardComment = { id, text: normalizeCommentText(text), createdAt: now.toISOString() };
  return withComments(board, cardId, [...(found.card.comments ?? []), comment]);
}

// Changes a comment's text and marks it edited. Unchanged text returns the same board.
export function editComment(
  board: Board,
  cardId: string,
  commentId: string,
  text: string,
  { now = new Date() }: { now?: Date } = {},
): Board {
  const comments = findComment(board, cardId, commentId);
  const trimmed = normalizeCommentText(text);
  if (comments.find((c) => c.id === commentId)?.text === trimmed) {
    return board;
  }
  return withComments(
    board,
    cardId,
    comments.map((c) => (c.id === commentId ? { ...c, text: trimmed, editedAt: now.toISOString() } : c)),
  );
}

export function deleteComment(board: Board, cardId: string, commentId: string): Board {
  const comments = findComment(board, cardId, commentId);
  return withComments(
    board,
    cardId,
    comments.filter((c) => c.id !== commentId),
  );
}
