import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { addCard } from "@/lib/board";
import { initialBoardList } from "@/lib/boards";
import { saveBoards, STORAGE_KEY } from "@/lib/storage";
import { resetBoardStore, useBoard, useBoards } from "@/hooks/useBoard";

function setup() {
  return renderHook(() => ({ board: useBoard(), boards: useBoards() }));
}

describe("useBoard / useBoards", () => {
  beforeEach(() => {
    localStorage.clear();
    resetBoardStore();
  });

  it("starts with one 'My board'", () => {
    const { result } = setup();
    expect(result.current.boards.boards.map((b) => b.name)).toEqual(["My board"]);
    expect(result.current.board[0].columns.todo).toEqual([]);
  });

  it("keeps boards independent and follows the selected board", () => {
    const { result } = setup();
    const firstId = result.current.boards.currentId;
    act(() => result.current.board[1]((b) => addCard(b, "In first", { id: "c1" })));
    act(() => void result.current.boards.createBoard("Second"));

    expect(result.current.boards.currentId).not.toBe(firstId);
    expect(result.current.board[0].columns.todo).toEqual([]);

    act(() => result.current.boards.selectBoard(firstId));
    expect(result.current.board[0].columns.todo.map((c) => c.title)).toEqual(["In first"]);
  });

  it("returns validation results and refuses invalid names and the last delete", () => {
    const { result } = setup();
    let created: ReturnType<typeof result.current.boards.createBoard> | undefined;
    act(() => {
      created = result.current.boards.createBoard("my board");
    });
    expect(created?.ok).toBe(false);
    expect(result.current.boards.boards).toHaveLength(1);

    act(() => result.current.boards.deleteBoard(result.current.boards.currentId));
    expect(result.current.boards.boards).toHaveLength(1);

    act(() => void result.current.boards.renameBoard(result.current.boards.currentId, "Renamed"));
    expect(result.current.boards.boards[0].name).toBe("Renamed");
  });

  it("persists to the v2 key and reloads on a storage event from another tab", () => {
    const { result } = setup();
    act(() => result.current.board[1]((b) => addCard(b, "Mine", { id: "c1" })));
    expect(localStorage.getItem(STORAGE_KEY)).toContain("Mine");

    const other = initialBoardList("other");
    other.boards[0].name = "From another tab";
    saveBoards(other);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });
    expect(result.current.boards.boards.map((b) => b.name)).toEqual(["From another tab"]);
    expect(result.current.boards.currentId).toBe("other");
  });
});
