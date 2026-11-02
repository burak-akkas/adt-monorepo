import { describe, expect, it } from "vitest";
import { addCard, addChecklistItem, emptyBoard, findCard } from "@/lib/board";
import { parseBoard, serializeBoard } from "@/lib/storage";

const card = (extra: Record<string, unknown>) => ({
  id: "a",
  title: "T",
  createdAt: "2024-01-01T00:00:00.000Z",
  priority: "low",
  ...extra,
});

const parse = (todo: unknown[], archive: unknown[] = []) => {
  const result = parseBoard(JSON.stringify({ columns: { todo, doing: [], done: [] }, archive }));
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.board;
};

describe("checklist storage", () => {
  it("loads cards without a checklist unchanged", () => {
    expect(parse([card({})]).columns.todo[0]).not.toHaveProperty("checklist");
  });

  it("round-trips through export and import, including archived cards", () => {
    let board = addChecklistItem(addCard(emptyBoard(), "T", { id: "a" }), "a", "one", { id: "x" });
    board = { ...board, archive: [{ ...board.columns.todo[0], id: "z" }] };
    const result = parseBoard(serializeBoard(board));
    expect(result).toEqual({ ok: true, board });
  });

  it("drops invalid items, trims text and removes an empty list", () => {
    const board = parse([
      card({
        checklist: [
          { id: "1", text: "  ok  ", done: true },
          { id: "1", text: "duplicate id", done: false },
          { id: "2", text: "   ", done: false },
          { id: "3", text: "x".repeat(201), done: false },
          { id: "4", text: "no done" },
          { id: 5, text: "bad id", done: false },
          null,
          "str",
        ],
      }),
      card({ id: "b", checklist: [{ id: "1", text: "", done: false }] }),
      card({ id: "c", checklist: "nope" }),
    ]);
    expect(findCard(board, "a")?.card.checklist).toEqual([{ id: "1", text: "ok", done: true }]);
    expect(findCard(board, "b")?.card).not.toHaveProperty("checklist");
    expect(findCard(board, "c")?.card).not.toHaveProperty("checklist");
  });

  it("normalizes archived cards too", () => {
    const board = parse([], [card({ checklist: [{ id: "1", text: " a ", done: false }, { id: "2" }] })]);
    expect(board.archive[0].checklist).toEqual([{ id: "1", text: "a", done: false }]);
  });
});
