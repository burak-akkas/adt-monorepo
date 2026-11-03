import type { BoardDetail } from "@adt/contracts";
import { describe, expect, it } from "vitest";
import { boardLists, type Board, type Card } from "@/lib/board";
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

// The inverse of `detailToBoard`, only needed to prove the mapping loses nothing.
function boardToDetail(board: Board): BoardDetail {
  const toServerCard = (c: Card, listId: string, position: number) => ({
    id: c.id,
    listId,
    title: c.title,
    priority: c.priority,
    cover: c.cover ?? null,
    dueDate: c.dueDate ?? null,
    notes: c.notes ?? null,
    position,
    createdAt: c.createdAt,
    labels: c.labels ?? [],
    checklist: (c.checklist ?? []).map((item, index) => ({ ...item, position: index })),
    comments: (c.comments ?? []).map((m) => ({ id: m.id, text: m.text, createdAt: m.createdAt, editedAt: m.editedAt ?? null })),
    activity: c.activity ?? [],
  });
  return {
    id: "b1",
    name: "Board",
    createdAt: AT,
    updatedAt: AT,
    lists: boardLists(board).map((list, index) => ({
      id: list.id,
      boardId: "b1",
      name: list.name,
      position: index,
      wipLimit: board.wipLimits?.[list.id] ?? null,
      collapsed: board.collapsedLists?.includes(list.id) ?? false,
      cards: (board.columns[list.id] ?? []).map((c, position) => toServerCard(c, list.id, position)),
    })),
    settings: {
      background: board.background ?? null,
      view: board.view ?? "board",
      collapsedListIds: board.collapsedLists ?? [],
      doingListId: board.insightsLists?.doing ?? null,
      doneListId: board.insightsLists?.done ?? null,
    },
    formerLists: board.formerLists ?? {},
    templates: (board.templates ?? []).map((t) => ({
      id: t.id,
      boardId: "b1",
      name: t.name,
      title: t.title,
      priority: t.priority,
      notes: t.notes ?? null,
      labels: t.labels ?? [],
      cover: t.cover ?? null,
      checklist: (t.checklist ?? []).map((i) => i.text),
      createdAt: AT,
    })),
    archive: board.archive.map((c) => ({ ...toServerCard(c, "l1", 0), boardId: "b1", archivedAt: AT })),
  } as BoardDetail;
}

describe("detailToBoard", () => {
  it("round-trips with the board it maps to", () => {
    const withTemplate = detail();
    withTemplate.templates = [
      { id: "t1", boardId: "b1", name: "Bug", title: "Fix", priority: "high", notes: "n", labels: ["x"], cover: "red", checklist: ["a", "b"], createdAt: AT },
    ];
    const board = detailToBoard(withTemplate);
    expect(detailToBoard(boardToDetail(board))).toEqual(board);
    const plain = detailToBoard(detail());
    expect(detailToBoard(boardToDetail(plain))).toEqual(plain);
  });

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
