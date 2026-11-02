import { describe, expect, it } from "vitest";
import { addCard, archiveDone, emptyBoard, MAX_ACTIVITY_ENTRIES, moveCard, setPriority } from "@/lib/board";
import { parseBoard, serializeBoard } from "@/lib/storage";
import { loadBoard, saveBoard } from "../../support/testStorage";

const card = (extra: Record<string, unknown>) => ({
  id: "a",
  title: "T",
  createdAt: "2026-01-01T00:00:00.000Z",
  priority: "medium",
  ...extra,
});
const parseCard = (extra: Record<string, unknown>) => {
  const result = parseBoard(JSON.stringify({ columns: { todo: [card(extra)], doing: [], done: [] } }));
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.board.columns.todo[0];
};
const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  at: "2026-01-01T00:00:00.000Z",
  type: "created",
  ...extra,
});

describe("activity storage", () => {
  it("loads old cards without activity unchanged", () => {
    expect(parseCard({})).not.toHaveProperty("activity");
  });

  it("keeps valid entries and drops malformed ones", () => {
    const loaded = parseCard({
      activity: [
        entry("ok", { type: "moved", from: "todo", to: "doing", extra: "dropped" }),
        entry("bad-type", { type: "nope" }),
        entry("bad-date", { at: "not a date" }),
        entry("bad-from", { from: 5 }),
        { at: "2026-01-01T00:00:00.000Z", type: "created" },
        entry("ok"),
        entry("ok"),
        null,
        "text",
      ],
    });
    expect(loaded.activity).toEqual([
      { id: "ok", at: "2026-01-01T00:00:00.000Z", type: "moved", from: "todo", to: "doing" },
    ]);
  });

  it("omits the key for an empty or non-array log", () => {
    expect(parseCard({ activity: [] })).not.toHaveProperty("activity");
    expect(parseCard({ activity: "x" })).not.toHaveProperty("activity");
  });

  it("caps the log at the most recent entries", () => {
    const many = Array.from({ length: MAX_ACTIVITY_ENTRIES + 10 }, (_, i) => entry(`e${i}`));
    const loaded = parseCard({ activity: many });
    expect(loaded.activity).toHaveLength(MAX_ACTIVITY_ENTRIES);
    expect(loaded.activity?.[0].id).toBe("e0");
  });

  it("round-trips through export/import, including archived cards", () => {
    let board = addCard(emptyBoard(), "Task", { id: "c1" });
    board = archiveDone(moveCard(setPriority(board, "c1", "high"), "c1", "done"));
    expect(board.archive[0].activity).toHaveLength(4);
    expect(parseBoard(serializeBoard(board))).toEqual({ ok: true, board });
  });

  it("persists across a reload", () => {
    const board = setPriority(addCard(emptyBoard(), "Task", { id: "c1" }), "c1", "low");
    saveBoard(board);
    expect(loadBoard()).toEqual(board);
  });
});
