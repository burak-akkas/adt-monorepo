import { describe, expect, it } from "vitest";
import {
  addCard,
  addList,
  adjacentColumn,
  archiveDone,
  archiveList,
  boardLabels,
  boardLists,
  boardStats,
  deleteList,
  emptyBoard,
  filterByLabel,
  filterCards,
  filterOverdue,
  findCard,
  insightsListIds,
  listCards,
  listName,
  MAX_LIST_NAME_LENGTH,
  moveCard,
  moveList,
  renameList,
  restoreCard,
  setInsightsList,
  setLabels,
  setDueDate,
  setWipLimit,
  undoArchive,
  validateListName,
  type Board,
} from "@/lib/board";
import { describeActivity } from "@/components/card/ActivityLog";
import { overdueCards, cycleTimes } from "@/lib/insights";
import { parseBoard, serializeBoard } from "@/lib/storage";

const names = (board: Board) => boardLists(board).map((l) => l.name);

function seed(): Board {
  let board = addList(emptyBoard(), "Review", { id: "review" });
  board = addCard(board, "A", { id: "a" });
  board = addCard(board, "B", { id: "b" });
  return board;
}

describe("validateListName", () => {
  const lists = boardLists(emptyBoard());

  it("trims and accepts a free name", () => {
    expect(validateListName("  Backlog ", lists)).toEqual({ ok: true, name: "Backlog" });
  });

  it("rejects empty, too long and duplicate names (case-insensitive)", () => {
    expect(validateListName("   ", lists).ok).toBe(false);
    expect(validateListName("x".repeat(MAX_LIST_NAME_LENGTH + 1), lists).ok).toBe(false);
    expect(validateListName("x".repeat(MAX_LIST_NAME_LENGTH), lists).ok).toBe(true);
    expect(validateListName("DOING", lists).ok).toBe(false);
  });

  it("lets a list keep its own name when renaming", () => {
    expect(validateListName("DOING", lists, "doing")).toEqual({ ok: true, name: "DOING" });
  });
});

describe("list operations", () => {
  it("a new board has To do, Doing and Done", () => {
    expect(names(emptyBoard())).toEqual(["To do", "Doing", "Done"]);
  });

  it("addList appends an empty list and throws for invalid names", () => {
    const board = addList(emptyBoard(), " Review ", { id: "r" });
    expect(names(board)).toEqual(["To do", "Doing", "Done", "Review"]);
    expect(board.columns.r).toEqual([]);
    expect(() => addList(board, "review")).toThrow();
    expect(() => addList(board, "")).toThrow();
  });

  it("renameList renames, keeps cards and is a no-op for the same name", () => {
    const board = renameList(seed(), "todo", "Backlog");
    expect(names(board)).toContain("Backlog");
    expect(listCards(board, "todo")).toHaveLength(2);
    expect(renameList(board, "todo", "Backlog")).toBe(board);
    expect(() => renameList(board, "todo", "Done")).toThrow();
    expect(() => renameList(board, "nope", "X")).toThrow();
  });

  it("moveList reorders and stops at both ends", () => {
    const board = moveList(seed(), "review", -1);
    expect(boardLists(board).map((l) => l.id)).toEqual(["todo", "doing", "review", "done"]);
    expect(moveList(board, "todo", -1)).toBe(board);
    expect(moveList(board, "done", 1)).toBe(board);
  });

  it("new cards go to the first list, even after reordering", () => {
    const board = addCard(moveList(emptyBoard(), "doing", -1), "X", { id: "x" });
    expect(findCard(board, "x")?.column).toBe("doing");
  });

  it("adjacentColumn follows the given lists", () => {
    const lists = boardLists(moveList(seed(), "review", -1));
    expect(adjacentColumn("review", 1, lists)).toBe("done");
    expect(adjacentColumn("review", -1, lists)).toBe("doing");
    expect(adjacentColumn("todo", -1, lists)).toBeUndefined();
  });

  it("moveCard works between custom lists and rejects unknown ones", () => {
    const board = moveCard(seed(), "a", "review");
    expect(findCard(board, "a")?.column).toBe("review");
    expect(() => moveCard(board, "a", "nope")).toThrow();
  });
});

describe("deleteList", () => {
  it("deletes an empty list and remembers its name", () => {
    const board = deleteList(seed(), "review");
    expect(boardLists(board).map((l) => l.id)).toEqual(["todo", "doing", "done"]);
    expect(board.columns).not.toHaveProperty("review");
    expect(listName(board, "review")).toBe("Review");
    expect(listName(board, "ghost")).toBe("Deleted list");
  });

  it("refuses a list with cards unless a target list is given, and never loses a card", () => {
    const board = seed();
    expect(() => deleteList(board, "todo")).toThrow();
    expect(() => deleteList(board, "todo", "todo")).toThrow();
    expect(() => deleteList(board, "todo", "nope")).toThrow();
    const next = deleteList(moveCard(board, "a", "review"), "todo", "review");
    expect(listCards(next, "review").map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("refuses to delete the last list", () => {
    let board = emptyBoard();
    board = deleteList(deleteList(board, "doing"), "done");
    expect(() => deleteList(board, "todo")).toThrow();
  });

  it("drops the WIP limit and clears a chosen insights list", () => {
    let board = setWipLimit(setWipLimit(seed(), "review", 2), "doing", 3);
    board = deleteList(board, "doing");
    expect(board.wipLimits).toEqual({ review: 2 });
    expect(insightsListIds(board)).toEqual({ doing: undefined, done: "done" });
    board = deleteList(board, "review");
    expect(board).not.toHaveProperty("wipLimits");
  });

  it("keeps old activity readable after rename and delete", () => {
    let board = moveCard(seed(), "a", "review");
    board = renameList(board, "review", "QA");
    const entry = findCard(board, "a")!.card.activity![0];
    expect(describeActivity(entry, board)).toBe("Moved from To do to QA");
    board = deleteList(board, "review", "todo");
    const moved = findCard(board, "a")!.card.activity!.find((e) => e.type === "moved")!;
    expect(describeActivity(moved, board)).toBe("Moved from To do to QA");
  });
});

describe("list-driven board logic", () => {
  it("archiveList archives any list and archiveDone uses the done list", () => {
    const board = moveCard(seed(), "a", "review");
    const archived = archiveList(board, "review");
    expect(archived.archive.map((c) => c.id)).toEqual(["a"]);
    expect(archiveList(archived, "review")).toBe(archived);
    expect(archiveDone(archived)).toBe(archived);
    const done = archiveDone(moveCard(board, "b", "done"));
    expect(done.archive.map((c) => c.id)).toEqual(["b"]);
  });

  it("restores and undoes archive into the right list", () => {
    const board = archiveList(moveCard(seed(), "a", "review"), "review");
    expect(listCards(restoreCard(board, "a"), "done").map((c) => c.id)).toEqual(["a"]);
    expect(listCards(restoreCard(board, "a", { listId: "review" }), "review").map((c) => c.id)).toEqual(["a"]);
    expect(listCards(undoArchive(board, board.archive, { listId: "review" }), "review")).toHaveLength(1);
  });

  it("restores into the last list when no done list is chosen", () => {
    let board = archiveList(moveCard(seed(), "a", "done"), "done");
    board = setInsightsList(board, "done", undefined);
    expect(listCards(restoreCard(board, "a"), "review").map((c) => c.id)).toEqual(["a"]);
  });

  it("search, label filter and overdue filter cover custom lists", () => {
    let board = moveCard(seed(), "a", "review");
    board = setLabels(board, "a", ["x"]);
    board = setDueDate(board, "a", "2000-01-01");
    expect(boardLabels(board)).toEqual(["x"]);
    expect(listCards(filterByLabel(board, "x"), "review")).toHaveLength(1);
    expect(listCards(filterByLabel(board, "x"), "todo")).toHaveLength(0);
    expect(listCards(filterCards(board, "a"), "review")).toHaveLength(1);
    expect(listCards(filterOverdue(board, "2026-01-01"), "review")).toHaveLength(1);
  });

  it("stats use the chosen done list", () => {
    let board = setDueDate(moveCard(seed(), "a", "review"), "a", "2000-01-01");
    expect(boardStats(board, "2026-01-01")).toMatchObject({ total: 2, done: 0, overdue: 1 });
    board = setInsightsList(board, "done", "review");
    expect(boardStats(board, "2026-01-01")).toMatchObject({ total: 2, done: 1, percentDone: 50, overdue: 0 });
  });
});

describe("insights lists", () => {
  it("defaults to the lists named Doing and Done", () => {
    expect(insightsListIds({ columns: { todo: [], doing: [], done: [] }, archive: [] })).toEqual({
      doing: "doing",
      done: "done",
    });
  });

  it("setInsightsList chooses a list, clears it, and rejects unknown lists", () => {
    let board = setInsightsList(seed(), "doing", "review");
    expect(insightsListIds(board).doing).toBe("review");
    board = setInsightsList(board, "doing", undefined);
    expect(insightsListIds(board).doing).toBeUndefined();
    expect(() => setInsightsList(board, "done", "nope")).toThrow();
  });

  it("cycle time and overdue use the chosen lists", () => {
    let board = setInsightsList(setInsightsList(seed(), "doing", "review"), "done", "doing");
    board = moveCard(moveCard(board, "a", "review", { now: new Date("2026-01-01T00:00:00Z") }), "a", "doing", {
      now: new Date("2026-01-02T00:00:00Z"),
    });
    expect(cycleTimes(board).durationsMs).toEqual([86_400_000]);
    board = setDueDate(board, "a", "2000-01-01");
    expect(overdueCards(board)).toEqual([]);
  });
});

describe("storage migration", () => {
  const old = {
    columns: {
      todo: [{ id: "a", title: "A", createdAt: "2024-01-01T00:00:00.000Z", priority: "low" }],
      doing: [{ id: "b", title: "B", createdAt: "2024-01-01T00:00:00.000Z", priority: "low" }],
      done: [],
    },
    archive: [{ id: "z", title: "Z", createdAt: "2024-01-01T00:00:00.000Z", priority: "low" }],
    wipLimits: { doing: 2 },
  };
  const parse = (value: unknown): Board => {
    const result = parseBoard(JSON.stringify(value));
    if (!result.ok) {
      throw new Error(result.error);
    }
    return result.board;
  };

  it("loads an old board as three lists with the same cards, limits and archive", () => {
    const board = parse(old);
    expect(boardLists(board).map((l) => [l.id, l.name])).toEqual([
      ["todo", "To do"],
      ["doing", "Doing"],
      ["done", "Done"],
    ]);
    expect(listCards(board, "todo")[0].id).toBe("a");
    expect(listCards(board, "doing")[0].id).toBe("b");
    expect(board.wipLimits).toEqual({ doing: 2 });
    expect(board.archive.map((c) => c.id)).toEqual(["z"]);
    expect(board.insightsLists).toEqual({ doing: "doing", done: "done" });
  });

  it("round-trips a board with custom lists, former names and insights choices", () => {
    let board = moveCard(seed(), "a", "review");
    board = setWipLimit(board, "review", 4);
    board = setInsightsList(board, "doing", "review");
    board = deleteList(addList(board, "Temp", { id: "temp" }), "temp");
    expect(parseBoard(serializeBoard(board))).toEqual({ ok: true, board });
  });

  it("falls back to the default lists when `lists` is malformed", () => {
    expect(boardLists(parse({ ...old, lists: [{ id: "x" }] })).map((l) => l.id)).toEqual(["todo", "doing", "done"]);
    expect(boardLists(parse({ ...old, lists: [] })).map((l) => l.id)).toEqual(["todo", "doing", "done"]);
  });

  it("rejects a board whose list has no cards array", () => {
    const result = parseBoard(JSON.stringify({ lists: [{ id: "q", name: "Q" }], columns: {}, archive: [] }));
    expect(result.ok).toBe(false);
  });

  it("ignores insights choices and limits for lists that do not exist", () => {
    const board = parse({ ...old, wipLimits: { gone: 2 }, insightsLists: { doing: "gone", done: "done" } });
    expect(board).not.toHaveProperty("wipLimits");
    expect(board.insightsLists).toEqual({ done: "done" });
  });
});

describe("helpers", () => {
  it("findCard reports the column", () => {
    const board = moveCard(addCard(emptyBoard(), "a", { id: "a" }), "a", "doing");
    expect(findCard(board, "a")?.column).toBe("doing");
    expect(findCard(board, "nope")).toBeUndefined();
  });

  it("adjacentColumn walks the column order", () => {
    expect(adjacentColumn("todo", -1)).toBeUndefined();
    expect(adjacentColumn("todo", 1)).toBe("doing");
    expect(adjacentColumn("done", 1)).toBeUndefined();
  });
});
