import { describe, expect, it } from "vitest";
import { addCard, archiveDone, boardTitle, emptyBoard, moveCard, openCardCount, setInsightsList } from "@/lib/board";
import type { Board } from "@/lib/board";

function withCards(...titles: string[]): Board {
  return titles.reduce((board, title, i) => addCard(board, title, { id: `c${i}` }), emptyBoard());
}

describe("openCardCount", () => {
  it("is 0 for an empty board", () => {
    expect(openCardCount(emptyBoard())).toBe(0);
  });

  it("counts cards in every list except done", () => {
    const board = moveCard(moveCard(withCards("a", "b", "c"), "c0", "doing"), "c1", "done");
    expect(openCardCount(board)).toBe(2);
  });

  it("counts every card when there is no done list", () => {
    const board = setInsightsList(moveCard(withCards("a", "b"), "c0", "done"), "done", undefined);
    expect(openCardCount(board)).toBe(2);
  });

  it("respects a custom done list", () => {
    const board = setInsightsList(withCards("a", "b"), "done", "todo");
    expect(openCardCount(board)).toBe(0);
  });

  it("ignores archived cards", () => {
    const board = archiveDone(moveCard(withCards("a", "b"), "c0", "done"));
    expect(board.archive).toHaveLength(1);
    expect(openCardCount(board)).toBe(1);
  });
});

describe("boardTitle", () => {
  it("includes the open count", () => {
    expect(boardTitle("My board", withCards("a", "b", "c"))).toBe("My board (3) · Kanban");
  });

  it("leaves the count out when nothing is open", () => {
    expect(boardTitle("My board", emptyBoard())).toBe("My board · Kanban");
    expect(boardTitle("My board", moveCard(withCards("a"), "c0", "done"))).toBe("My board · Kanban");
  });
});
