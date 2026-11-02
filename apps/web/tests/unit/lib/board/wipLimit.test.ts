import { describe, expect, it } from "vitest";
import {
  addCard,
  archiveDone,
  emptyBoard,
  moveCard,
  parseWipLimit,
  restoreCard,
  setWipLimit,
  undoArchive,
  wipStatus,
} from "@/lib/board";
import { LEGACY_STORAGE_KEY, parseBoard, serializeBoard } from "@/lib/storage";
import { loadBoard, saveBoard } from "../../../support/testStorage";

function memoryStorage(initial?: string): Storage {
  const data = new Map<string, string>(initial === undefined ? [] : [[LEGACY_STORAGE_KEY, initial]]);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  } as Storage;
}

const boardJson = (extra: Record<string, unknown>) =>
  JSON.stringify({ columns: { todo: [], doing: [], done: [] }, archive: [], ...extra });

describe("parseWipLimit", () => {
  it("accepts whole numbers, trimmed", () => {
    expect(parseWipLimit("3")).toEqual({ ok: true, limit: 3 });
    expect(parseWipLimit(" 4 ")).toEqual({ ok: true, limit: 4 });
    expect(parseWipLimit("99")).toEqual({ ok: true, limit: 99 });
  });

  it("treats blank as clearing the limit", () => {
    expect(parseWipLimit("")).toEqual({ ok: true, limit: undefined });
    expect(parseWipLimit("   ")).toEqual({ ok: true, limit: undefined });
  });

  it.each(["0", "-1", "1.5", "abc", "1e3", "100", "99999999999", "+2"])("rejects %j", (input) => {
    const result = parseWipLimit(input);
    expect(result.ok).toBe(false);
  });
});

describe("setWipLimit", () => {
  it("sets a limit without mutating the input", () => {
    const board = emptyBoard();
    const next = setWipLimit(board, "doing", 3);
    expect(next.wipLimits).toEqual({ doing: 3 });
    expect(board.wipLimits).toBeUndefined();
  });

  it("changes one column and keeps the others", () => {
    const board = setWipLimit(setWipLimit(emptyBoard(), "doing", 3), "todo", 5);
    const next = setWipLimit(board, "doing", 2);
    expect(next.wipLimits).toEqual({ doing: 2, todo: 5 });
    expect(board.wipLimits).toEqual({ doing: 3, todo: 5 });
  });

  it("returns the same board when nothing changes", () => {
    const board = setWipLimit(emptyBoard(), "doing", 3);
    expect(setWipLimit(board, "doing", 3)).toBe(board);
    const empty = emptyBoard();
    expect(setWipLimit(empty, "doing", undefined)).toBe(empty);
  });

  it("removes the key when the last limit is cleared", () => {
    const board = setWipLimit(emptyBoard(), "doing", 3);
    const cleared = setWipLimit(board, "doing", undefined);
    expect("wipLimits" in cleared).toBe(false);
    expect(board.wipLimits).toEqual({ doing: 3 });
  });

  it("throws on invalid limits", () => {
    for (const bad of [0, -1, 1.5, 100, Number.NaN]) {
      expect(() => setWipLimit(emptyBoard(), "doing", bad)).toThrow();
    }
  });
});

describe("wipStatus", () => {
  it("has no state without a limit", () => {
    expect(wipStatus(5, undefined)).toEqual({ state: "none", over: 0 });
  });

  it("is ok below, at and over the limit", () => {
    expect(wipStatus(2, 3)).toEqual({ state: "ok", over: 0 });
    expect(wipStatus(3, 3)).toEqual({ state: "at", over: 0 });
    expect(wipStatus(5, 3)).toEqual({ state: "over", over: 2 });
  });
});

describe("soft limits", () => {
  it("never blocks adding, moving, archiving or restoring, and keeps the limits", () => {
    let board = setWipLimit(setWipLimit(emptyBoard(), "todo", 1), "done", 1);
    board = addCard(board, "A", { id: "a" });
    board = addCard(board, "B", { id: "b" });
    expect(board.columns.todo).toHaveLength(2);
    board = moveCard(moveCard(board, "a", "done"), "b", "done");
    expect(board.columns.done).toHaveLength(2);
    const cards = board.columns.done;
    board = archiveDone(board);
    expect(board.wipLimits).toEqual({ todo: 1, done: 1 });
    board = restoreCard(board, "a");
    expect(board.wipLimits).toEqual({ todo: 1, done: 1 });
    board = undoArchive(board, cards);
    expect(board.wipLimits).toEqual({ todo: 1, done: 1 });
    expect(board.columns.done).toHaveLength(2);
  });
});

describe("wip limit storage", () => {
  it("round-trips limits through save and load", () => {
    const storage = memoryStorage();
    saveBoard(setWipLimit(emptyBoard(), "doing", 4), storage);
    expect(loadBoard(storage).wipLimits).toEqual({ doing: 4 });
  });

  it("loads boards saved without limits unchanged", () => {
    const board = loadBoard(memoryStorage(boardJson({})));
    expect(board.wipLimits).toBeUndefined();
    expect("wipLimits" in board).toBe(false);
  });

  it("drops invalid limits without rejecting the board", () => {
    const bad = { todo: 0, doing: -2, done: 1.5 };
    expect(loadBoard(memoryStorage(boardJson({ wipLimits: bad }))).wipLimits).toBeUndefined();
    const mixed = { todo: "3", doing: 100, done: 2, other: 4 };
    expect(loadBoard(memoryStorage(boardJson({ wipLimits: mixed }))).wipLimits).toEqual({ done: 2 });
    for (const junk of [null, 5, "x", [1, 2]]) {
      const board = loadBoard(memoryStorage(boardJson({ wipLimits: junk })));
      expect(board.wipLimits).toBeUndefined();
    }
  });

  it("exports and imports limits", () => {
    const exported = serializeBoard(setWipLimit(emptyBoard(), "todo", 7));
    const result = parseBoard(exported);
    expect(result.ok && result.board.wipLimits).toEqual({ todo: 7 });
  });

  it("drops an invalid limit on import but keeps the board", () => {
    const result = parseBoard(boardJson({ wipLimits: { todo: 0, doing: 2 } }));
    expect(result.ok && result.board.wipLimits).toEqual({ doing: 2 });
  });
});
