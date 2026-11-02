import { defaultStorage, readPreference, writePreference } from "@/lib/preference";

export const COMMENT_ORDER_KEY = "kanban:comment-order";

export type CommentOrder = "oldest" | "newest";

// Stored as "newest" or "oldest"; anything else reads as oldest first.
export function loadCommentOrder(storage = defaultStorage()): CommentOrder {
  return readPreference<CommentOrder>(
    COMMENT_ORDER_KEY,
    (raw) => (raw === "newest" ? "newest" : "oldest"),
    "oldest",
    storage,
  );
}

export function saveCommentOrder(value: CommentOrder, storage = defaultStorage()): void {
  writePreference(COMMENT_ORDER_KEY, value, storage);
}
