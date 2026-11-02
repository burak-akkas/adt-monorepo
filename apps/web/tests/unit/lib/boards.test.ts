import { describe, expect, it } from "vitest";
import { addCard } from "@/lib/board";
import {
  boardLink,
  boardQuery,
  copyBoardName,
  createBoardEntry,
  currentEntry,
  deleteBoardEntry,
  duplicateBoardEntry,
  initialBoardList,
  MAX_BOARD_NAME_LENGTH,
  renameBoard,
  resolveBoardId,
  selectBoard,
  updateCurrentBoard,
  validateBoardName,
} from "@/lib/boards";

describe("boardQuery and boardLink", () => {
  it("encodes the id in a relative query", () => {
    expect(boardQuery("abc")).toBe("?board=abc");
    expect(boardQuery("a b&c")).toBe("?board=a%20b%26c");
  });

  it("builds an absolute link that keeps the sub-path and replaces the query", () => {
    expect(boardLink("a b", "https://x.test/pr-1/?board=z")).toBe("https://x.test/pr-1/?board=a%20b");
    expect(boardLink("a", "http://localhost:3000/")).toBe("http://localhost:3000/?board=a");
  });
});

describe("initialBoardList", () => {
  it("has one empty 'My board' that is current", () => {
    const list = initialBoardList("a");
    expect(list.currentId).toBe("a");
    expect(list.boards).toHaveLength(1);
    expect(list.boards[0].name).toBe("My board");
    expect(list.boards[0].board.columns.todo).toEqual([]);
  });
});

describe("validateBoardName", () => {
  const boards = [
    { id: "a", name: "Work" },
    { id: "b", name: "Home" },
  ];

  it("trims the name", () => {
    expect(validateBoardName("  Side  ", boards)).toEqual({ ok: true, name: "Side" });
  });

  it("rejects empty or blank names", () => {
    expect(validateBoardName("", boards).ok).toBe(false);
    expect(validateBoardName("   ", boards).ok).toBe(false);
  });

  it("accepts 40 characters and rejects 41", () => {
    expect(validateBoardName("x".repeat(MAX_BOARD_NAME_LENGTH), boards).ok).toBe(true);
    expect(validateBoardName("x".repeat(MAX_BOARD_NAME_LENGTH + 1), boards).ok).toBe(false);
  });

  it("rejects case-insensitive duplicates", () => {
    expect(validateBoardName("work", boards).ok).toBe(false);
    expect(validateBoardName(" HOME ", boards).ok).toBe(false);
  });

  it("lets a board be renamed to its own name with different casing", () => {
    expect(validateBoardName("WORK", boards, "a")).toEqual({ ok: true, name: "WORK" });
    expect(validateBoardName("home", boards, "a").ok).toBe(false);
  });
});

describe("resolveBoardId", () => {
  const list = createBoardEntry(initialBoardList("a"), "Work", "b");

  it("returns a known id", () => {
    expect(resolveBoardId(list, "a")).toBe("a");
  });

  it("falls back to the first board for an unknown id", () => {
    expect(resolveBoardId(list, "nope")).toBe("a");
  });

  it("keeps the current board without a param", () => {
    expect(resolveBoardId(list, null)).toBe("b");
  });
});

describe("board list logic", () => {
  it("creates a board, makes it current and does not mutate", () => {
    const list = initialBoardList("a");
    const next = createBoardEntry(list, " Work ", "b");
    expect(next.boards.map((b) => b.name)).toEqual(["My board", "Work"]);
    expect(next.currentId).toBe("b");
    expect(list.boards).toHaveLength(1);
    expect(list.currentId).toBe("a");
  });

  it("returns the list unchanged for an invalid or duplicate name", () => {
    const list = initialBoardList("a");
    expect(createBoardEntry(list, "  ", "b")).toBe(list);
    expect(createBoardEntry(list, "my BOARD", "b")).toBe(list);
  });

  it("renames a board", () => {
    const list = createBoardEntry(initialBoardList("a"), "Work", "b");
    const next = renameBoard(list, "a", "Home");
    expect(next.boards.map((b) => b.name)).toEqual(["Home", "Work"]);
    expect(renameBoard(list, "a", "work")).toBe(list);
    expect(renameBoard(list, "a", "MY BOARD").boards[0].name).toBe("MY BOARD");
    expect(renameBoard(list, "zzz", "Other")).toBe(list);
  });

  it("refuses to delete the last board", () => {
    const list = initialBoardList("a");
    expect(deleteBoardEntry(list, "a")).toBe(list);
  });

  it("deletes a board and moves current to the first remaining one", () => {
    const list = createBoardEntry(createBoardEntry(initialBoardList("a"), "Two", "b"), "Three", "c");
    expect(list.currentId).toBe("c");
    const next = deleteBoardEntry(list, "c");
    expect(next.boards.map((b) => b.id)).toEqual(["a", "b"]);
    expect(next.currentId).toBe("a");
    const other = deleteBoardEntry(list, "a");
    expect(other.currentId).toBe("c");
    expect(deleteBoardEntry(list, "zzz")).toBe(list);
  });

  it("selects a board and ignores unknown ids", () => {
    const list = createBoardEntry(initialBoardList("a"), "Two", "b");
    expect(selectBoard(list, "a").currentId).toBe("a");
    expect(selectBoard(list, "zzz")).toBe(list);
  });

  it("changing one board never affects another", () => {
    const list = createBoardEntry(initialBoardList("a"), "Two", "b");
    const changed = updateCurrentBoard(list, (board) => addCard(board, "Only in two", { id: "c1" }));
    expect(changed.boards[1].board.columns.todo).toHaveLength(1);
    expect(changed.boards[0].board).toBe(list.boards[0].board);
    expect(currentEntry(selectBoard(changed, "a")).board.columns.todo).toEqual([]);
  });
});

describe("duplicateBoardEntry", () => {
  function source() {
    const list = initialBoardList("a");
    const board = addCard(list.boards[0].board, "Task", { id: "c1" });
    board.columns.todo[0].notes = "note";
    board.columns.todo[0].activity = [{ type: "created", at: "2026-01-01T00:00:00.000Z" }] as never;
    board.archive = [{ id: "old", title: "Old" } as never];
    board.wipLimits = { todo: 3 };
    board.collapsedLists = ["done"];
    board.templates = [];
    return { ...list, boards: [{ ...list.boards[0], board }] };
  }

  it("appends a copy named '(copy)' and makes it current", () => {
    const list = duplicateBoardEntry(source(), "a", "b");
    expect(list.boards.map((b) => b.name)).toEqual(["My board", "My board (copy)"]);
    expect(list.currentId).toBe("b");
  });

  it("keeps lists, cards and settings but drops archive and activity", () => {
    const list = duplicateBoardEntry(source(), "a", "b");
    const copy = list.boards[1].board;
    expect(copy.columns.todo[0]).toMatchObject({ id: "c1", title: "Task", notes: "note" });
    expect(copy.columns.todo[0].activity).toBeUndefined();
    expect(copy.archive).toEqual([]);
    expect(copy.wipLimits).toEqual({ todo: 3 });
    expect(copy.collapsedLists).toEqual(["done"]);
  });

  it("does not change the original and shares no references", () => {
    const original = source();
    const list = duplicateBoardEntry(original, "a", "b");
    expect(list.boards[0].board.archive).toHaveLength(1);
    expect(list.boards[0].board.columns.todo[0].activity).toHaveLength(1);
    expect(list.boards[1].board.columns.todo[0]).not.toBe(list.boards[0].board.columns.todo[0]);
    const changed = updateCurrentBoard(list, (b) => addCard(b, "Only copy", { id: "c2" }));
    expect(changed.boards[0].board.columns.todo).toHaveLength(1);
    expect(changed.boards[1].board.columns.todo).toHaveLength(2);
  });

  it("returns the list unchanged for an unknown id or a clashing new id", () => {
    const list = source();
    expect(duplicateBoardEntry(list, "zzz", "b")).toBe(list);
    expect(duplicateBoardEntry(list, "a", "a")).toBe(list);
  });
});

describe("copyBoardName", () => {
  it("numbers the copy when the name is taken, ignoring case", () => {
    const boards = [
      { id: "a", name: "Sprint" },
      { id: "b", name: "sprint (COPY)" },
    ];
    expect(copyBoardName("Sprint", boards)).toBe("Sprint (copy 2)");
  });

  it("truncates a long base name so the result is valid", () => {
    const long = "x".repeat(MAX_BOARD_NAME_LENGTH);
    const name = copyBoardName(long, [{ id: "a", name: long }]);
    expect(name.length).toBeLessThanOrEqual(MAX_BOARD_NAME_LENGTH);
    expect(name.endsWith(" (copy)")).toBe(true);
    expect(copyBoardName(long, [{ id: "a", name: long }, { id: "b", name }])).toMatch(/\(copy 2\)$/);
  });
});
