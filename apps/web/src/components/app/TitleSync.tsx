"use client";

import { useEffect, useSyncExternalStore } from "react";
import { boardTitle } from "@/lib/board";
import { useBoard, useBoards } from "@/hooks/useBoard";

const noopSubscribe = () => () => {};

// Shows the board name and open card count in the tab title. Waits for hydration, so the static
// "Kanban" title and the placeholder board never leak into it.
export function TitleSync() {
  const [board] = useBoard();
  const { boards, currentId } = useBoards();
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const name = boards.find((b) => b.id === currentId)?.name;
  const title = hydrated && name !== undefined ? boardTitle(name, board) : undefined;

  useEffect(() => {
    if (title === undefined) {
      return;
    }
    const apply = () => {
      if (document.title !== title) {
        document.title = title;
      }
    };
    apply();
    // React and Next rewrite the static <title> after hydration, so put ours back if that happens.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);

  return null;
}
