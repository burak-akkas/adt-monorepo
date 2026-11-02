import { describe, expect, it } from "vitest";
import { addCard, emptyBoard } from "@/lib/board";
import { loadBoards, parseBoard, saveBoards, serializeBoard } from "@/lib/storage";
import { boardTemplates, saveAsTemplate } from "@/lib/templates";
import { initialBoardList } from "@/lib/boards";

function parseWith(templates: unknown) {
  const text = JSON.stringify({ ...emptyBoard(), templates });
  const result = parseBoard(text);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.board;
}

describe("template storage", () => {
  it("round-trips through export and import", () => {
    let board = addCard(emptyBoard(), "Card", { id: "c1" });
    board = { ...board, columns: { ...board.columns, todo: [{ ...board.columns.todo[0], labels: ["a"], cover: "red", notes: "n", checklist: [{ id: "i", text: "x", done: true }] }] } };
    board = saveAsTemplate(board, "c1", "Mine", { id: "t1" });
    const result = parseBoard(serializeBoard(board));
    expect(result.ok && result.board.templates).toEqual(board.templates);
  });

  it("loads old boards and exports without templates", () => {
    const result = parseBoard(JSON.stringify(emptyBoard()));
    expect(result.ok && result.board.templates).toBeUndefined();
    expect(result.ok && "templates" in result.board).toBe(false);
  });

  it("drops malformed templates and keeps the valid ones", () => {
    const board = parseWith([
      { id: "t1", name: "Good", title: "Title", priority: "weird", labels: ["x", 3], checklist: [{ id: "i", text: " step ", done: true }, { id: "j", text: "" }] },
      { id: "t1", name: "Dup id", title: "T" },
      { id: "t2", name: "good", title: "T" },
      { id: "t3", name: "", title: "T" },
      { id: "t4", name: "No title" },
      { id: 5, name: "Bad id", title: "T" },
      "junk",
      null,
    ]);
    expect(boardTemplates(board)).toEqual([
      { id: "t1", name: "Good", title: "Title", priority: "medium", labels: ["x"], checklist: [{ id: "i", text: "step" }] },
    ]);
  });

  it("ignores a non-array templates value", () => {
    expect(parseWith("nope").templates).toBeUndefined();
    expect(parseWith([]).templates).toBeUndefined();
  });

  it("keeps templates per board across a reload", () => {
    const list = initialBoardList();
    const withCard = addCard(list.boards[0].board, "Card", { id: "c1" });
    const withTemplate = saveAsTemplate(withCard, "c1", "Mine", { id: "t1" });
    const other = { id: "other", name: "Other", board: emptyBoard() };
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as unknown as Storage;
    saveBoards({ currentId: list.currentId, boards: [{ ...list.boards[0], board: withTemplate }, other] }, storage);
    const loaded = loadBoards(storage);
    expect(boardTemplates(loaded.boards[0].board).map((t) => t.name)).toEqual(["Mine"]);
    expect(boardTemplates(loaded.boards[1].board)).toEqual([]);
  });
});
