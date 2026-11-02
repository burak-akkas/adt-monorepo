import { describe, expect, it } from "vitest";
import {
  addCard,
  archiveDone,
  COVER_COLORS,
  emptyBoard,
  hasChanges,
  moveCard,
  restoreCard,
  setCover,
  undoArchive,
  updateCard,
  type Board,
  type Card,
  type CardEdits,
} from "@/lib/board";
import { parseBoard, serializeBoard } from "@/lib/storage";

const seed = () => addCard(emptyBoard(), "Task", { id: "c1" });
const only = (board: Board) => board.columns.todo[0];

describe("cover color", () => {
  it("has eight named colors", () => {
    expect(COVER_COLORS).toHaveLength(8);
  });

  it("sets, replaces and clears the cover", () => {
    const blue = setCover(seed(), "c1", "blue");
    expect(only(blue).cover).toBe("blue");
    expect(only(setCover(blue, "c1", "red")).cover).toBe("red");
    const cleared = only(setCover(blue, "c1", undefined));
    expect(cleared).not.toHaveProperty("cover");
  });

  it("returns the same board when nothing changes", () => {
    const board = seed();
    expect(setCover(board, "c1", undefined)).toBe(board);
    const blue = setCover(board, "c1", "blue");
    expect(setCover(blue, "c1", "blue")).toBe(blue);
  });

  it("rejects unknown cards and colors", () => {
    expect(() => setCover(seed(), "nope", "blue")).toThrow();
    expect(() => setCover(seed(), "c1", "mauve" as never)).toThrow();
  });

  describe("updateCard and hasChanges", () => {
    const edits = (card: Card, extra: Partial<CardEdits> = {}): CardEdits => ({
      title: card.title,
      notes: card.notes,
      priority: card.priority,
      dueDate: card.dueDate,
      column: "todo",
      ...extra,
    });

    it("applies and clears the cover", () => {
      const board = seed();
      const withCover = updateCard(board, "c1", edits(only(board), { cover: "teal" }));
      expect(only(withCover).cover).toBe("teal");
      const cleared = updateCard(withCover, "c1", edits(only(withCover), { cover: undefined }));
      expect(only(cleared)).not.toHaveProperty("cover");
    });

    it("leaves the cover alone when the edit has no cover key", () => {
      const board = setCover(seed(), "c1", "teal");
      expect(only(updateCard(board, "c1", edits(only(board)))).cover).toBe("teal");
    });

    it("counts a cover change, and only a change, as a change", () => {
      const card = only(setCover(seed(), "c1", "teal"));
      expect(hasChanges(card, "todo", edits(card, { cover: "teal" }))).toBe(false);
      expect(hasChanges(card, "todo", edits(card, { cover: "red" }))).toBe(true);
      expect(hasChanges(card, "todo", edits(card, { cover: undefined }))).toBe(true);
      expect(hasChanges(card, "todo", edits(card))).toBe(false);
    });
  });

  it("is kept by move, archive, restore and undo", () => {
    let board = setCover(seed(), "c1", "pink");
    board = moveCard(board, "c1", "done");
    expect(board.columns.done[0].cover).toBe("pink");
    const archived = archiveDone(board);
    expect(archived.archive[0].cover).toBe("pink");
    expect(restoreCard(archived, "c1").columns.done[0].cover).toBe("pink");
    expect(undoArchive(archived, archived.archive).columns.done[0].cover).toBe("pink");
  });
});

describe("cover color storage", () => {
  const at = "2026-10-28T10:00:00.000Z";
  const parseCover = (cover: unknown) => {
    const card = { id: "a", title: "t", createdAt: at, cover };
    const result = parseBoard(JSON.stringify({ columns: { todo: [card], doing: [], done: [] } }));
    if (!result.ok) {
      throw new Error(result.error);
    }
    return result.board.columns.todo[0];
  };

  it("loads cards without a cover unchanged", () => {
    expect(parseCover(undefined)).not.toHaveProperty("cover");
  });

  it("keeps every palette color", () => {
    for (const { id } of COVER_COLORS) {
      expect(parseCover(id).cover).toBe(id);
    }
  });

  it("drops invalid values but keeps the card", () => {
    for (const bad of ["mauve", "", 3, null, { id: "red" }, ["red"], "RED"]) {
      const card = parseCover(bad);
      expect(card).not.toHaveProperty("cover");
      expect(card.title).toBe("t");
    }
  });

  it("round-trips the cover through export and import", () => {
    const board = setCover(seed(), "c1", "purple");
    expect(parseBoard(serializeBoard(board))).toEqual({ ok: true, board });
  });
});
