"use client";

import { createPreferenceStore } from "@/hooks/createPreferenceStore";
import { COMMENT_ORDER_KEY, loadCommentOrder, saveCommentOrder, type CommentOrder } from "@/lib/commentOrder";

// Server snapshot is "oldest", so the static export hydrates without a mismatch.
const store = createPreferenceStore<CommentOrder>({
  key: COMMENT_ORDER_KEY,
  load: loadCommentOrder,
  save: saveCommentOrder,
  serverValue: "oldest",
});

export const useCommentOrder = store.useValue;

// Tests only: forget the cached value so the next read comes from storage.
export const resetCommentOrderStore = store.reset;
