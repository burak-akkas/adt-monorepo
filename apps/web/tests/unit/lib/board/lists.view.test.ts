import { describe, expect, it } from "vitest";
import { addCard, boardView, emptyBoard, setView } from "@/lib/board";
import { loadBoards, parseBoard, serializeBoard } from "@/lib/storage";
import { loadBoard, saveBoard } from "../../../support/testStorage";

describe("board view", () => {
  it("defaults to board", () => {
    expect(boardView(emptyBoard())).toBe("board");
  });

  it("sets the table view without mutating, and removes the key for board", () => {
    const board = emptyBoard();
    const table = setView(board, "table");
    expect(boardView(table)).toBe("table");
    expect(board.view).toBeUndefined();
    const back = setView(table, "board");
    expect("view" in back).toBe(false);
  });

  it("returns the same board when the view does not change", () => {
    const board = emptyBoard();
    expect(setView(board, "board")).toBe(board);
    const table = setView(board, "table");
    expect(setView(table, "table")).toBe(table);
  });

  it("persists the table view and keeps calendar", () => {
    saveBoard(setView(emptyBoard(), "table"));
    expect(loadBoard().view).toBe("table");
    saveBoard(setView(emptyBoard(), "calendar"));
    expect(loadBoard().view).toBe("calendar");
  });

  it("treats a missing or invalid stored view as board", () => {
    saveBoard(emptyBoard());
    expect(boardView(loadBoard())).toBe("board");
    saveBoard({ ...emptyBoard(), view: "grid" } as never);
    expect(loadBoard().view).toBeUndefined();
  });

  it("round-trips the view through export and import", () => {
    const board = setView(addCard(emptyBoard(), "A"), "table");
    const result = parseBoard(serializeBoard(board));
    expect(result.ok && result.board.view).toBe("table");
  });

  it("imports an old export without a view as board", () => {
    const old = JSON.stringify({ columns: { todo: [], doing: [], done: [] }, archive: [] });
    const result = parseBoard(old);
    expect(result.ok && boardView(result.board)).toBe("board");
  });

  it("keeps the view when loading the board list", () => {
    saveBoard(setView(emptyBoard(), "table"));
    expect(loadBoards().boards[0].board.view).toBe("table");
  });
});
