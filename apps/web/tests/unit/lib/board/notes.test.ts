import { describe, expect, it } from "vitest";
import { addCard, emptyBoard, findCard, MAX_NOTES_LENGTH, moveCard, renameCard, setNotes } from "@/lib/board";

describe("notes", () => {
  const base = addCard(emptyBoard(), "Task", { id: "a" });
  const withNotes = setNotes(base, "a", "  line one\nline two  ");
  const card = (board = withNotes) => findCard(board, "a")!.card;

  it("sets trimmed notes, edits them and clears them by removing the key", () => {
    expect(card().notes).toBe("line one\nline two");
    expect(card(setNotes(withNotes, "a", "changed")).notes).toBe("changed");
    expect("notes" in card(setNotes(withNotes, "a", undefined))).toBe(false);
  });

  it("treats blank notes as clearing", () => {
    expect("notes" in card(setNotes(withNotes, "a", " \n  "))).toBe(false);
    expect(setNotes(base, "a", "   ")).toBe(base);
  });

  it("accepts exactly the maximum length and rejects more", () => {
    expect(card(setNotes(base, "a", "x".repeat(MAX_NOTES_LENGTH))).notes).toHaveLength(MAX_NOTES_LENGTH);
    expect(() => setNotes(base, "a", "x".repeat(MAX_NOTES_LENGTH + 1))).toThrow(/at most/);
  });

  it("returns the same board when nothing changes", () => {
    expect(setNotes(withNotes, "a", "line one\nline two")).toBe(withNotes);
    expect(setNotes(base, "a", undefined)).toBe(base);
  });

  it("throws for an unknown card", () => {
    expect(() => setNotes(base, "zzz", "x")).toThrow(/not found/);
  });

  it("does not mutate its input", () => {
    const snapshot = structuredClone(base);
    setNotes(base, "a", "x");
    expect(base).toEqual(snapshot);
  });

  it("keeps notes when moving or renaming", () => {
    expect(card(moveCard(withNotes, "a", "doing")).notes).toBe("line one\nline two");
    expect(card(renameCard(withNotes, "a", "New")).notes).toBe("line one\nline two");
  });
});
