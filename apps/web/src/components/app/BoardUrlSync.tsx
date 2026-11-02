"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { boardQuery, resolveBoardId } from "@/lib/boards";
import { useBoards } from "@/hooks/useBoard";

const noopSubscribe = () => () => {};

const boardParam = () => new URLSearchParams(window.location.search).get("board");
const boardUrl = boardQuery;

// Keeps ?board=<id> and the current board in sync. The URL is only read in effects after hydration,
// so the static render and the first client render match. Relative URLs work under any sub-path.
export function BoardUrlSync() {
  const { boards, currentId, selectBoard } = useBoards();
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const ready = useRef(false);
  const latest = useRef({ boards, currentId, selectBoard });

  useEffect(() => {
    latest.current = { boards, currentId, selectBoard };
  });

  // Store to URL: selecting, creating or deleting a board adds a history entry. Declared before the
  // initial load so it skips the first run, where the URL has not been resolved yet.
  useEffect(() => {
    if (ready.current && boardParam() !== currentId) {
      window.history.pushState(null, "", boardUrl(currentId));
    }
  }, [currentId]);

  // Initial load: the URL wins, otherwise the remembered board. Replace, so no extra history entry.
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const { boards, currentId, selectBoard } = latest.current;
    const id = resolveBoardId({ boards, currentId }, boardParam());
    selectBoard(id);
    window.history.replaceState(null, "", boardUrl(id));
    ready.current = true;
  }, [hydrated]);

  // Back and forward: URL to store.
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const onPopState = () => {
      const { boards, currentId, selectBoard } = latest.current;
      const param = boardParam();
      const id = resolveBoardId({ boards, currentId }, param);
      if (id !== param) {
        window.history.replaceState(null, "", boardUrl(id));
      }
      selectBoard(id);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [hydrated]);

  return null;
}
