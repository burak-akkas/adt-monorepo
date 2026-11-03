import { describe, expect, it } from "vitest";
import { withClientIds } from "@/lib/boardDetail";
import { addCard, addChecklistItem, addComment, emptyBoard } from "@/lib/board";

describe("withClientIds", () => {
  it("puts the client's ids back on cards, checklist items and comments", () => {
    let server = addCard(emptyBoard(), "Task", { id: "srv-card" });
    server = addChecklistItem(server, "srv-card", "Step", { id: "srv-item" });
    server = addComment(server, "srv-card", "Hello", { id: "srv-comment" });
    const ids = new Map([
      ["client-card", "srv-card"],
      ["client-item", "srv-item"],
      ["client-comment", "srv-comment"],
    ]);

    const [card] = withClientIds(server, ids).columns.todo;
    expect(card.id).toBe("client-card");
    expect(card.checklist?.map((i) => i.id)).toEqual(["client-item"]);
    expect(card.comments?.map((c) => c.id)).toEqual(["client-comment"]);
  });

  it("leaves ids it does not know, and returns the same board when nothing was made up", () => {
    const board = addCard(emptyBoard(), "Task", { id: "srv-card" });
    expect(withClientIds(board, new Map())).toBe(board);
    expect(withClientIds(board, new Map([["a", "b"]])).columns.todo[0].id).toBe("srv-card");
  });
});
