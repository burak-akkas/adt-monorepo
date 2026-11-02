import { describe, expect, it } from "vitest";
import type { Board, Card } from "@/lib/board";
import { boardToMarkdown } from "@/lib/boardMarkdown";

const card = (id: string, title: string, dueDate?: string): Card => ({
  id,
  title,
  createdAt: "2026-01-01T00:00:00.000Z",
  priority: "medium",
  ...(dueDate ? { dueDate } : {}),
});

const emptyBoard = (): Board => ({ columns: { todo: [], doing: [], done: [] }, archive: [] });

describe("boardToMarkdown", () => {
  it("renders the name, lists in order, bullets, due dates and empty lists", () => {
    const board: Board = {
      ...emptyBoard(),
      columns: { todo: [card("1", "Pay rent", "2026-11-05"), card("2", "Call Sam")], doing: [], done: [card("3", "Ship")] },
    };
    expect(boardToMarkdown(board, "Home")).toBe(
      [
        "# Home",
        "",
        "## To do",
        "- Pay rent (due 2026-11-05)",
        "- Call Sam",
        "",
        "## Doing",
        "_No cards_",
        "",
        "## Done",
        "- Ship",
        "",
      ].join("\n"),
    );
  });

  it("never includes archived cards", () => {
    const board: Board = { ...emptyBoard(), archive: [card("9", "Old stuff")] };
    expect(boardToMarkdown(board, "B")).not.toContain("Old stuff");
  });

  it("uses custom lists in their order", () => {
    const board: Board = {
      lists: [
        { id: "b", name: "Second" },
        { id: "a", name: "First" },
      ],
      columns: { a: [card("1", "One")], b: [] },
      archive: [],
    };
    expect(boardToMarkdown(board, "Custom")).toBe("# Custom\n\n## Second\n_No cards_\n\n## First\n- One\n");
  });

  it("keeps each card on one bullet when a title has newlines", () => {
    const board: Board = { ...emptyBoard(), columns: { todo: [card("1", "a\nb\r\nc")], doing: [], done: [] } };
    expect(boardToMarkdown(board, "B")).toContain("- a b c\n");
  });
});
