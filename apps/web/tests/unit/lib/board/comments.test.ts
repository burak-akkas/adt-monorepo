import { describe, expect, it } from "vitest";
import {
  addCard,
  addComment,
  archiveDone,
  deleteComment,
  editComment,
  emptyBoard,
  findCard,
  MAX_COMMENT_LENGTH,
  moveCard,
  restoreCard,
  undoArchive,
  updateCard,
  type CardEdits,
} from "@/lib/board";

describe("comments", () => {
  const base = addCard(emptyBoard(), "Task", { id: "a" });
  const t1 = new Date("2026-10-28T10:00:00.000Z");
  const t2 = new Date("2026-10-28T11:00:00.000Z");
  const withOne = addComment(base, "a", "  first  ", { id: "c1", now: t1 });
  const withTwo = addComment(withOne, "a", "second", { id: "c2", now: t2 });
  const comments = (board = withTwo) => findCard(board, "a")!.card.comments;

  it("appends trimmed comments oldest first with injected id and time", () => {
    expect(comments()).toEqual([
      { id: "c1", text: "first", createdAt: t1.toISOString() },
      { id: "c2", text: "second", createdAt: t2.toISOString() },
    ]);
  });

  it("rejects blank and over-long text, accepting exactly the maximum", () => {
    expect(() => addComment(base, "a", "  \n ")).toThrow(/empty/);
    expect(() => addComment(base, "a", "x".repeat(MAX_COMMENT_LENGTH + 1))).toThrow(/at most/);
    expect(comments(addComment(base, "a", "x".repeat(MAX_COMMENT_LENGTH)))?.[0].text).toHaveLength(MAX_COMMENT_LENGTH);
  });

  it("edits text and sets editedAt", () => {
    const edited = editComment(withTwo, "a", "c1", " changed ", { now: t2 });
    expect(comments(edited)?.[0]).toEqual({ id: "c1", text: "changed", createdAt: t1.toISOString(), editedAt: t2.toISOString() });
    expect(comments(edited)?.[1]).toEqual(comments()?.[1]);
  });

  it("returns the same board when the edited text is unchanged", () => {
    expect(editComment(withTwo, "a", "c1", "first")).toBe(withTwo);
  });

  it("rejects blank or over-long edits", () => {
    expect(() => editComment(withTwo, "a", "c1", " ")).toThrow(/empty/);
    expect(() => editComment(withTwo, "a", "c1", "x".repeat(MAX_COMMENT_LENGTH + 1))).toThrow(/at most/);
  });

  it("deletes a comment and removes the key when none are left", () => {
    expect(comments(deleteComment(withTwo, "a", "c1"))?.map((c) => c.id)).toEqual(["c2"]);
    expect("comments" in findCard(deleteComment(withOne, "a", "c1"), "a")!.card).toBe(false);
  });

  it("throws for an unknown card or comment", () => {
    expect(() => addComment(base, "zzz", "x")).toThrow(/not found/);
    expect(() => editComment(withTwo, "zzz", "c1", "x")).toThrow(/not found/);
    expect(() => editComment(withTwo, "a", "zzz", "x")).toThrow(/not found/);
    expect(() => deleteComment(withTwo, "a", "zzz")).toThrow(/not found/);
    expect(() => deleteComment(base, "a", "c1")).toThrow(/not found/);
  });

  it("does not mutate its input", () => {
    const snapshot = structuredClone(withTwo);
    addComment(withTwo, "a", "x");
    editComment(withTwo, "a", "c1", "x");
    deleteComment(withTwo, "a", "c1");
    expect(withTwo).toEqual(snapshot);
  });

  it("keeps comments when moving, updating, archiving, restoring and undoing", () => {
    const edits: CardEdits = { title: "New", notes: undefined, priority: "high", dueDate: undefined, column: "done" };
    const updated = updateCard(withTwo, "a", edits);
    expect(comments(updated)).toHaveLength(2);
    expect(comments(moveCard(withTwo, "a", "doing"))).toHaveLength(2);
    const archived = archiveDone(updated);
    expect(archived.archive[0].comments).toHaveLength(2);
    expect(comments(restoreCard(archived, "a"))).toHaveLength(2);
    expect(comments(undoArchive(archived, updated.columns.done))).toHaveLength(2);
  });
});
