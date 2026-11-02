import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { BoardSwitcher } from "@/components/app/BoardSwitcher";
import { TitleSync } from "@/components/app/TitleSync";
import { addCard, archiveDone, moveCard, restoreCard } from "@/lib/board";
import { createBoardEntry, initialBoardList } from "@/lib/boards";
import { saveBoards } from "@/lib/storage";
import { resetBoardStore, useBoard, useBoards } from "@/hooks/useBoard";

// Exposes the store's updaters so tests can change the board like the real UI does.
const api = {} as { update: ReturnType<typeof useBoard>[1]; rename: ReturnType<typeof useBoards>["renameBoard"] };
function Harness() {
  const [, update] = useBoard();
  const { renameBoard } = useBoards();
  useEffect(() => {
    api.update = update;
    api.rename = renameBoard;
  }, [update, renameBoard]);
  return null;
}

function setup() {
  render(
    <>
      <BoardSwitcher />
      <TitleSync />
      <Harness />
    </>,
  );
}

describe("<TitleSync />", () => {
  beforeEach(() => {
    localStorage.clear();
    resetBoardStore();
    document.title = "Kanban";
  });

  it("shows the board name and no count for an empty board", () => {
    setup();
    expect(document.title).toBe("My board · Kanban");
  });

  it("follows add, move to done, archive and restore", () => {
    setup();
    act(() => api.update((b) => addCard(addCard(b, "a", { id: "a" }), "b", { id: "b" })));
    expect(document.title).toBe("My board (2) · Kanban");
    act(() => api.update((b) => moveCard(b, "a", "done")));
    expect(document.title).toBe("My board (1) · Kanban");
    act(() => api.update((b) => archiveDone(b)));
    expect(document.title).toBe("My board (1) · Kanban");
    act(() => api.update((b) => restoreCard(b, "a", { listId: "todo" })));
    expect(document.title).toBe("My board (2) · Kanban");
  });

  it("follows a rename and a board switch", async () => {
    saveBoards({ ...createBoardEntry(initialBoardList("a"), "Work", "b"), currentId: "a" });
    resetBoardStore();
    const user = userEvent.setup();
    setup();
    act(() => api.update((b) => addCard(b, "a", { id: "a" })));
    act(() => {
      api.rename("a", "Home");
    });
    expect(document.title).toBe("Home (1) · Kanban");
    await user.selectOptions(screen.getByRole("combobox", { name: "Board" }), "Work");
    expect(document.title).toBe("Work · Kanban");
  });

  it("follows changes made in another tab", () => {
    setup();
    const list = initialBoardList("a");
    const board = addCard(list.boards[0].board, "x", { id: "x" });
    act(() => {
      saveBoards({ ...list, boards: [{ ...list.boards[0], name: "Other", board }] });
      resetBoardStore();
      window.dispatchEvent(new StorageEvent("storage"));
    });
    expect(document.title).toBe("Other (1) · Kanban");
  });

  it("leaves the title alone until hydrated, never using the placeholder board", () => {
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(document.title));
    observer.observe(document.querySelector("title") ?? document.head, { childList: true, subtree: true });
    setup();
    observer.disconnect();
    expect(seen.join("|")).not.toContain("server");
    expect(document.title).not.toContain("server");
  });
});
