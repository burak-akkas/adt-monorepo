import { describe, expect, it } from "vitest";
import { addCard, assigneeInitials, assignToCard, emptyBoard, isAssignedTo, unassignFromCard } from "@/lib/board";

const base = () => addCard(emptyBoard(), "Task", { id: "a" });

describe("assignToCard", () => {
  it("adds a lower-cased email at the end without mutating the input", () => {
    const board = base();
    const next = assignToCard(assignToCard(board, "a", "A@Example.test"), "a", "b@example.test");
    expect(next.columns.todo[0].assignees).toEqual(["a@example.test", "b@example.test"]);
    expect(board.columns.todo[0].assignees).toBeUndefined();
  });

  it("ignores duplicates (any case) and unknown cards", () => {
    const board = assignToCard(base(), "a", "a@example.test");
    expect(assignToCard(board, "a", "A@EXAMPLE.test")).toBe(board);
    expect(assignToCard(board, "zzz", "b@example.test")).toBe(board);
  });
});

describe("unassignFromCard", () => {
  it("removes the email and deletes the field when empty", () => {
    const board = assignToCard(assignToCard(base(), "a", "a@example.test"), "a", "b@example.test");
    const one = unassignFromCard(board, "a", "A@example.test");
    expect(one.columns.todo[0].assignees).toEqual(["b@example.test"]);
    const none = unassignFromCard(one, "a", "b@example.test");
    expect(none.columns.todo[0]).not.toHaveProperty("assignees");
  });

  it("ignores someone not assigned, a card without the field and unknown cards", () => {
    const board = base();
    expect(unassignFromCard(board, "a", "a@example.test")).toBe(board);
    expect(unassignFromCard(board, "zzz", "a@example.test")).toBe(board);
  });
});

describe("isAssignedTo", () => {
  it("is case-insensitive and tolerates a missing field", () => {
    const board = assignToCard(base(), "a", "a@example.test");
    expect(isAssignedTo(board.columns.todo[0], "A@Example.test")).toBe(true);
    expect(isAssignedTo(board.columns.todo[0], "b@example.test")).toBe(false);
    expect(isAssignedTo(base().columns.todo[0], "a@example.test")).toBe(false);
  });
});

describe("assigneeInitials", () => {
  it("uses the first letter before the @, upper-cased", () => {
    expect(assigneeInitials("alice@example.test")).toBe("A");
    expect(assigneeInitials("@example.test")).toBe("?");
    expect(assigneeInitials("")).toBe("?");
  });
});
