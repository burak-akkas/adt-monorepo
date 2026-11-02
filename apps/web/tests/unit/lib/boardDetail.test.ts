import type { BoardDetail } from "@adt/contracts";
import { describe, expect, it } from "vitest";
import { boardLists } from "@/lib/board";
import { detailToBoard } from "@/lib/boardDetail";

const AT = "2026-01-02T03:04:05.000Z";

function card(id: string, position: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    listId: "l1",
    title: `Card ${id}`,
    priority: "medium" as const,
    cover: null,
    dueDate: null,
    notes: null,
    position,
    createdAt: AT,
    checklist: [],
    comments: [],
    labels: [],
    activity: [],
    ...extra,
  };
}

function detail(): BoardDetail {
  return {
    id: "b1",
    name: "Board",
    createdAt: AT,
    updatedAt: AT,
    lists: [
      { id: "l2", boardId: "b1", name: "Second", position: 1, wipLimit: 3, collapsed: true, cards: [] },
      {
        id: "l1",
        boardId: "b1",
        name: "First",
        position: 0,
        wipLimit: null,
        collapsed: false,
        cards: [
          card("b", 1),
          card("a", 0, {
            cover: "red",
            dueDate: "2026-05-06",
            notes: "n",
            labels: ["x"],
            checklist: [
              { id: "i2", text: "two", done: true, position: 1 },
              { id: "i1", text: "one", done: false, position: 0 },
            ],
            comments: [{ id: "m1", text: "hi", createdAt: AT, editedAt: null }],
            activity: [{ id: "e1", at: AT, type: "created" }],
          }),
        ],
      },
    ],
    settings: { background: { type: "color", value: "#112233" }, view: "table", collapsedListIds: ["l2"], doingListId: null, doneListId: "l2" },
    formerLists: { gone: "Old" },
    templates: [],
    archive: [{ ...card("z", 0), boardId: "b1", archivedAt: AT }],
  } as BoardDetail;
}

describe("detailToBoard", () => {
  it("orders lists, cards and checklist items by position", () => {
    const board = detailToBoard(detail());
    expect(boardLists(board).map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(board.columns.l1.map((c) => c.id)).toEqual(["a", "b"]);
    expect(board.columns.l1[0].checklist?.map((i) => i.id)).toEqual(["i1", "i2"]);
  });

  it("maps card fields and leaves empty optional ones out", () => {
    const board = detailToBoard(detail());
    expect(board.columns.l1[0]).toMatchObject({ cover: "red", dueDate: "2026-05-06", notes: "n", labels: ["x"] });
    expect(board.columns.l1[0].comments).toEqual([{ id: "m1", text: "hi", createdAt: AT }]);
    expect(board.columns.l1[1]).toEqual({ id: "b", title: "Card b", createdAt: AT, priority: "medium" });
  });

  it("maps list and board settings", () => {
    const board = detailToBoard(detail());
    expect(board.wipLimits).toEqual({ l2: 3 });
    expect(board.collapsedLists).toEqual(["l2"]);
    expect(board.view).toBe("table");
    expect(board.background).toEqual({ type: "color", value: "#112233" });
    expect(board.insightsLists).toEqual({ done: "l2" });
    expect(board.formerLists).toEqual({ gone: "Old" });
    expect(board.archive.map((c) => c.id)).toEqual(["z"]);
  });

  it("leaves the defaults out", () => {
    const plain = detail();
    plain.settings = { background: null, view: "board", collapsedListIds: [], doingListId: null, doneListId: null };
    plain.formerLists = {};
    const board = detailToBoard(plain);
    expect(board.view).toBeUndefined();
    expect(board.insightsLists).toBeUndefined();
    expect(board.collapsedLists).toBeUndefined();
  });
});
