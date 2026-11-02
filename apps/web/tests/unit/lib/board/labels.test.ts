import { describe, expect, it } from "vitest";
import {
  addCard,
  addLabelToList,
  archiveDone,
  boardLabels,
  emptyBoard,
  filterByLabel,
  filterCards,
  hasChanges,
  labelColor,
  LABEL_PALETTE,
  MAX_LABEL_LENGTH,
  moveCard,
  normalizeLabel,
  removeLabelFromList,
  restoreCard,
  setLabels,
  updateCard,
  type Board,
  type CardEdits,
} from "@/lib/board";
import { parseBoard, serializeBoard } from "@/lib/storage";
import { loadBoard, saveBoard } from "../../../support/testStorage";

function boardWithLabels(): Board {
  let board = emptyBoard();
  board = addCard(board, "Fix crash", { id: "a" });
  board = addCard(board, "Style page", { id: "b" });
  board = addCard(board, "Plain", { id: "c" });
  board = setLabels(board, "a", ["Bug", "backend"]);
  board = setLabels(board, "b", ["design", "bug"]);
  return board;
}

describe("label names", () => {
  it("trims, and rejects empty and over-long names", () => {
    expect(normalizeLabel("  bug  ")).toBe("bug");
    expect(() => normalizeLabel("   ")).toThrow("must not be empty");
    expect(normalizeLabel("x".repeat(MAX_LABEL_LENGTH))).toHaveLength(MAX_LABEL_LENGTH);
    expect(() => normalizeLabel("x".repeat(MAX_LABEL_LENGTH + 1))).toThrow(`at most ${MAX_LABEL_LENGTH}`);
  });

  it("adds and removes without mutating, rejecting case-insensitive duplicates", () => {
    const list = ["Bug"];
    expect(addLabelToList(list, " design ")).toEqual(["Bug", "design"]);
    expect(list).toEqual(["Bug"]);
    expect(() => addLabelToList(list, "bUG")).toThrow("already exists");
    expect(removeLabelFromList(["Bug", "design"], "bug")).toEqual(["design"]);
    expect(list).toEqual(["Bug"]);
  });
});

describe("labelColor", () => {
  it("is case-insensitive, deterministic and from the palette", () => {
    expect(labelColor("Bug")).toBe(labelColor("bug"));
    expect(labelColor(" bug ")).toBe(labelColor("bug"));
    for (const name of ["a", "design", "backend", "ünï", "😀"]) {
      expect(LABEL_PALETTE).toContain(labelColor(name));
    }
  });

  it("has dark variants for every palette entry", () => {
    for (const classes of LABEL_PALETTE) {
      expect(classes).toMatch(/dark:bg-/);
      expect(classes).toMatch(/dark:text-/);
    }
  });
});

describe("setLabels / updateCard / hasChanges", () => {
  it("sets labels, validates, and removes the field when empty", () => {
    const board = boardWithLabels();
    expect(board.columns.todo[0].labels).toEqual(["Bug", "backend"]);
    expect(() => setLabels(board, "a", ["x", "X"])).toThrow();
    expect(() => setLabels(board, "zzz", ["x"])).toThrow("not found");
    expect(setLabels(board, "a", ["Bug", "backend"])).toBe(board);
    const cleared = setLabels(board, "a", []);
    expect("labels" in cleared.columns.todo[0]).toBe(false);
    expect(board.columns.todo[0].labels).toEqual(["Bug", "backend"]);
  });

  it("applies labels through updateCard and detects them in hasChanges", () => {
    const board = boardWithLabels();
    const card = board.columns.todo[0];
    const edits: CardEdits = {
      title: card.title,
      notes: undefined,
      priority: card.priority,
      dueDate: undefined,
      column: "todo",
      labels: [...(card.labels ?? [])],
    };
    expect(hasChanges(card, "todo", edits)).toBe(false);
    expect(hasChanges(card, "todo", { ...edits, labels: ["Bug"] })).toBe(true);
    expect(hasChanges(card, "todo", { ...edits, labels: ["Bug", "other"] })).toBe(true);
    expect(updateCard(board, "a", { ...edits, labels: ["new"] }).columns.todo[0].labels).toEqual(["new"]);
    expect(updateCard(board, "a", { ...edits, labels: [] }).columns.todo[0].labels).toBeUndefined();
  });
});

describe("boardLabels / filterByLabel", () => {
  it("lists distinct labels case-insensitively, sorted, first spelling wins", () => {
    expect(boardLabels(boardWithLabels())).toEqual(["backend", "Bug", "design"]);
    expect(boardLabels(emptyBoard())).toEqual([]);
  });

  it("filters case-insensitively, null returns the same board, and combines with search", () => {
    const board = boardWithLabels();
    expect(filterByLabel(board, null)).toBe(board);
    const bugs = filterByLabel(board, "BUG");
    expect(bugs.columns.todo.map((c) => c.id)).toEqual(["a", "b"]);
    expect(filterByLabel(filterCards(board, "style"), "bug").columns.todo.map((c) => c.id)).toEqual(["b"]);
    expect(filterByLabel(board, "nope").columns.todo).toEqual([]);
  });
});

describe("labels in storage", () => {
  const withCard = (card: Record<string, unknown>) =>
    JSON.stringify({ columns: { todo: [{ id: "a", title: "t", createdAt: "x", ...card }], doing: [], done: [] } });

  it("loads cards without labels unchanged", () => {
    const result = parseBoard(withCard({}));
    expect(result.ok && "labels" in result.board.columns.todo[0]).toBe(false);
  });

  it.each([
    ["a string", "bug", undefined],
    ["mixed types", ["ok", 1, null, {}], ["ok"]],
    ["blanks, duplicates and over-long", [" a ", "", "  ", "A", "x".repeat(MAX_LABEL_LENGTH + 1), "b"], ["a", "b"]],
    ["nothing valid", [1, ""], undefined],
  ])("repairs malformed labels (%s) without dropping the board", (_name, labels, expected) => {
    const result = parseBoard(withCard({ labels }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.board.columns.todo[0].labels).toEqual(expected);
      expect("labels" in result.board.columns.todo[0]).toBe(expected !== undefined);
    }
  });

  it("round-trips labels through export/import, localStorage and archive/restore", () => {
    let board = moveCard(boardWithLabels(), "a", "done");
    expect(parseBoard(serializeBoard(board))).toEqual({ ok: true, board });
    board = archiveDone(board);
    const archived = parseBoard(serializeBoard(board));
    expect(archived).toEqual({ ok: true, board });
    saveBoard(board);
    expect(loadBoard().archive[0].labels).toEqual(["Bug", "backend"]);
    board = restoreCard(board, "a");
    expect(board.columns.done[0].labels).toEqual(["Bug", "backend"]);
    localStorage.clear();
  });
});
