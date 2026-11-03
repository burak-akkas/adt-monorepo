import { describe, expect, it, vi } from "vitest";
import {
  addCard,
  addChecklistItem,
  addComment,
  addList,
  archiveCard,
  archiveDone,
  archiveList,
  collapseAllLists,
  deleteArchived,
  deleteCard,
  deleteChecklistItem,
  deleteComment,
  deleteCompletedChecklistItems,
  deleteList,
  duplicateCard,
  editChecklistItem,
  editComment,
  emptyArchive,
  emptyBoard,
  expandAllLists,
  moveCard,
  moveChecklistItem,
  moveCompletedChecklistItemsToBottom,
  moveList,
  renameCard,
  renameList,
  reorderCard,
  restoreCard,
  setBackground,
  setCover,
  setDueDate,
  setInsightsList,
  setLabels,
  setNotes,
  setPriority,
  setView,
  setWipLimit,
  sortListByTitle,
  sortListsByDueDate,
  toggleChecklistItem,
  toggleListCollapsed,
  uncheckAllChecklistItems,
  undoArchive,
  updateCard,
  type Board,
} from "@/lib/board";
import { diffBoard, runOperations, UnsupportedChangeError, type Operation } from "@/lib/boardSync";
import { addCardFromTemplate, deleteTemplate, renameTemplate, saveAsTemplate } from "@/lib/templates";

const NOW = new Date("2026-03-04T05:06:07.000Z");

function start(): Board {
  let board = emptyBoard();
  board = addCard(board, "First", { id: "c1", now: NOW });
  board = addCard(board, "Second", { id: "c2", now: NOW });
  board = addCard(board, "Third", { id: "c3", now: NOW });
  board = moveCard(board, "c3", "done", { now: NOW });
  board = setLabels(board, "c1", ["bug", "ui"]);
  board = addChecklistItem(board, "c1", "one", { id: "i1" });
  board = addChecklistItem(board, "c1", "two", { id: "i2" });
  board = addComment(board, "c1", "hello", { id: "m1", now: NOW });
  board = setWipLimit(board, "doing", 3);
  board = addCard(board, "Archived", { id: "c4", now: NOW });
  board = archiveCard(board, "c4", { now: NOW });
  return board;
}

const kinds = (ops: Operation[]) => ops.map((o) => o.kind);

// Every change the UI can make through `lib/board` must be sendable: otherwise the board would be reset after the edit.
const ACTIONS: Record<string, (b: Board) => Board> = {
  addCard: (b) => addCard(b, "New", { id: "n1", now: NOW }),
  addCardInList: (b) => addCard(b, "New", { id: "n1", now: NOW, listId: "doing" }),
  setPriority: (b) => setPriority(b, "c1", "high", { now: NOW }),
  setCover: (b) => setCover(b, "c1", "red"),
  clearCover: (b) => setCover(setCover(b, "c1", "red"), "c1", undefined),
  renameCard: (b) => renameCard(b, "c1", "Renamed", { now: NOW }),
  moveCard: (b) => moveCard(b, "c1", "doing", { now: NOW }),
  reorderCardTop: (b) => reorderCard(b, "c2", "top"),
  reorderCardBottom: (b) => reorderCard(b, "c1", "bottom"),
  duplicateCard: (b) => duplicateCard(b, "c1", { id: "d1", now: NOW }),
  deleteCard: (b) => deleteCard(b, "c1"),
  updateCard: (b) =>
    updateCard(b, "c1", { title: "T", notes: "N", priority: "low", dueDate: "2026-05-06", column: "doing", labels: ["x"], cover: "blue" }, { now: NOW }),
  setNotes: (b) => setNotes(b, "c1", "some notes", { now: NOW }),
  setDueDate: (b) => setDueDate(b, "c1", "2026-05-06", { now: NOW }),
  clearDueDate: (b) => setDueDate(setDueDate(b, "c1", "2026-05-06"), "c1", undefined),
  setLabels: (b) => setLabels(b, "c1", ["ui", "bug", "new"]),
  clearLabels: (b) => setLabels(b, "c1", []),
  addChecklistItem: (b) => addChecklistItem(b, "c2", "step", { id: "i9" }),
  toggleChecklistItem: (b) => toggleChecklistItem(b, "c1", "i1"),
  editChecklistItem: (b) => editChecklistItem(b, "c1", "i1", "edited"),
  deleteChecklistItem: (b) => deleteChecklistItem(b, "c1", "i1"),
  moveChecklistItem: (b) => moveChecklistItem(b, "c1", "i1", 1),
  uncheckAll: (b) => uncheckAllChecklistItems(toggleChecklistItem(b, "c1", "i1"), "c1"),
  moveCompletedToBottom: (b) => moveCompletedChecklistItemsToBottom(toggleChecklistItem(b, "c1", "i1"), "c1"),
  deleteCompleted: (b) => deleteCompletedChecklistItems(toggleChecklistItem(b, "c1", "i1"), "c1"),
  addComment: (b) => addComment(b, "c2", "hi", { id: "m9", now: NOW }),
  editComment: (b) => editComment(b, "c1", "m1", "changed", { now: NOW }),
  deleteComment: (b) => deleteComment(b, "c1", "m1"),
  archiveCard: (b) => archiveCard(b, "c1", { now: NOW }),
  archiveList: (b) => archiveList(b, "todo", { now: NOW }),
  archiveDone: (b) => archiveDone(b, { now: NOW }),
  restoreCard: (b) => restoreCard(b, "c4", { now: NOW }),
  restoreCardToList: (b) => restoreCard(b, "c4", { now: NOW, listId: "doing" }),
  deleteArchived: (b) => deleteArchived(b, "c4"),
  emptyArchive: (b) => emptyArchive(b),
  undoArchive: (b) => {
    const archived = archiveList(b, "todo", { now: NOW });
    return undoArchive(archived, b.columns.todo, { now: NOW });
  },
  addList: (b) => addList(b, "Review", { id: "l9" }),
  renameList: (b) => renameList(b, "doing", "In progress"),
  moveList: (b) => moveList(b, "doing", 1),
  deleteList: (b) => deleteList(b, "done", "todo"),
  deleteEmptyList: (b) => deleteList(b, "doing"),
  setWipLimit: (b) => setWipLimit(b, "todo", 5),
  clearWipLimit: (b) => setWipLimit(b, "doing", undefined),
  toggleListCollapsed: (b) => toggleListCollapsed(b, "todo"),
  collapseAll: (b) => collapseAllLists(b),
  expandAll: (b) => expandAllLists(collapseAllLists(b)),
  setView: (b) => setView(b, "table"),
  setBackground: (b) => setBackground(b, { type: "color", value: "#112233" }),
  setInsightsList: (b) => setInsightsList(b, "done", "doing"),
  sortListByTitle: (b) => sortListByTitle(addCard(b, "A first", { id: "c9", now: NOW }), "todo"),
  sortListsByDueDate: (b) => sortListsByDueDate(setDueDate(b, "c2", "2026-01-01")),
  saveAsTemplate: (b) => saveAsTemplate(b, "c1", "Bug", { id: "t9" }),
  renameTemplate: (b) => renameTemplate(saveAsTemplate(b, "c1", "Bug", { id: "t9" }), "t9", "Bugs"),
  deleteTemplate: (b) => deleteTemplate(saveAsTemplate(b, "c1", "Bug", { id: "t9" }), "t9"),
  addCardFromTemplate: (b) => addCardFromTemplate(saveAsTemplate(b, "c1", "Bug", { id: "t9" }), "t9", "doing", { id: "n2", now: NOW }),
};

describe("diffBoard", () => {
  it("is empty when nothing changed", () => {
    expect(diffBoard(start(), start())).toEqual([]);
  });

  it.each(Object.entries(ACTIONS))("can send the diff of %s", (_name, action) => {
    const before = start();
    expect(() => diffBoard(before, action(before))).not.toThrow();
  });

  it.each(Object.entries(ACTIONS))("can send the inverse of %s (undo)", (_name, action) => {
    const before = start();
    expect(() => diffBoard(action(before), before)).not.toThrow();
  });

  it("creates a card with its content", () => {
    const before = start();
    const after = addChecklistItem(addCard(before, "New", { id: "n1", now: NOW, listId: "doing" }), "n1", "step", { id: "ni" });
    expect(kinds(diffBoard(before, after))).toEqual(["createCard", "addChecklistItem"]);
  });

  it("sends one update with only the changed fields", () => {
    const before = start();
    const after = setPriority(renameCard(before, "c1", "Renamed", { now: NOW }), "c1", "high", { now: NOW });
    expect(diffBoard(before, after)).toEqual([{ kind: "updateCard", id: "c1", patch: { title: "Renamed", priority: "high" } }]);
  });

  it("uses the duplicate endpoint for a copy", () => {
    const before = start();
    expect(diffBoard(before, duplicateCard(before, "c1", { id: "d1", now: NOW }))).toEqual([
      { kind: "duplicateCard", id: "d1", sourceId: "c1" },
      { kind: "reorderCards", listId: "todo", cardIds: ["c1", "d1", "c2"] },
    ]);
  });

  it("moves a card to the end of the target list", () => {
    const before = start();
    expect(diffBoard(before, moveCard(before, "c1", "doing", { now: NOW }))).toEqual([
      { kind: "moveCard", id: "c1", listId: "doing", position: 0 },
    ]);
  });

  it("archives a whole list in one call", () => {
    const before = start();
    expect(kinds(diffBoard(before, archiveList(before, "todo", { now: NOW })))).toEqual(["archiveList"]);
  });

  it("deletes a list after moving its cards out", () => {
    const before = start();
    expect(kinds(diffBoard(before, deleteList(before, "todo", "doing")))).toEqual(["moveCard", "moveCard", "deleteList"]);
  });

  it("rejects a template edit it cannot send", () => {
    const before = saveAsTemplate(start(), "c1", "Bug", { id: "t9" });
    const after: Board = { ...before, templates: before.templates?.map((t) => ({ ...t, title: "Other" })) };
    expect(() => diffBoard(before, after)).toThrow(UnsupportedChangeError);
  });
});

describe("runOperations", () => {
  it("maps client ids to the ids the server made", async () => {
    const calls: { path: string; method?: string; body?: unknown }[] = [];
    const request = vi.fn(async (path: string, options?: { method?: string; body?: unknown }) => {
      calls.push({ path, method: options?.method, body: options?.body });
      if (path === "/boards/b1/lists") {
        return { id: "server-list", boardId: "b1", name: "Review", position: 3, wipLimit: null, collapsed: false };
      }
      if (path === "/lists/server-list/cards") {
        return {
          id: "server-card",
          listId: "server-list",
          title: "New",
          priority: "medium",
          cover: null,
          dueDate: null,
          notes: null,
          position: 0,
          createdAt: NOW.toISOString(),
          checklist: [],
          comments: [],
          labels: [],
          activity: [],
        };
      }
      return undefined;
    });
    const ids = new Map<string, string>();
    await runOperations(
      [
        { kind: "createList", id: "l9", name: "Review" },
        { kind: "createCard", id: "n1", listId: "l9", card: { id: "n1", title: "New", createdAt: NOW.toISOString(), priority: "medium" } },
        { kind: "updateCard", id: "n1", patch: { title: "Newer" } },
      ],
      { boardId: "b1", ids, request: request as never },
    );
    expect(ids.get("l9")).toBe("server-list");
    expect(ids.get("n1")).toBe("server-card");
    expect(calls.at(-1)).toEqual({ path: "/cards/server-card", method: "PATCH", body: { title: "Newer" } });
  });

  // The API's routes (from its controllers), `:x` standing for one path segment.
  const ROUTES = [
    "POST /boards/:x/lists",
    "PATCH /lists/:x",
    "POST /lists/:x/move",
    "PUT /lists/:x/wip-limit",
    "PUT /lists/:x/cards/order",
    "POST /lists/:x/archive",
    "DELETE /lists/:x",
    "POST /lists/:x/cards",
    "GET /cards/:x",
    "PATCH /cards/:x",
    "POST /cards/:x/move",
    "POST /cards/:x/duplicate",
    "DELETE /cards/:x",
    "POST /cards/:x/labels",
    "DELETE /cards/:x/labels/:x",
    "POST /cards/:x/checklist",
    "PUT /cards/:x/checklist/order",
    "PATCH /cards/:x/checklist/:x",
    "DELETE /cards/:x/checklist/:x",
    "POST /cards/:x/comments",
    "PATCH /cards/:x/comments/:x",
    "DELETE /cards/:x/comments/:x",
    "POST /cards/:x/archive",
    "POST /archive/:x/restore",
    "DELETE /archive/:x",
    "DELETE /boards/:x/archive",
    "POST /boards/:x/templates",
    "PATCH /templates/:x",
    "DELETE /templates/:x",
    "PATCH /boards/:x/settings",
  ];

  it.each(Object.entries(ACTIONS))("only calls endpoints that exist for %s", async (_name, action) => {
    const before = start();
    const operations = [...diffBoard(before, action(before)), ...diffBoard(action(before), before)];
    let counter = 0;
    const seen: string[] = [];
    const request = async (path: string, options?: { method?: string }) => {
      seen.push(`${options?.method} ${path}`);
      counter += 1;
      return {
        id: `srv${counter}`,
        checklist: [],
        comments: [],
      };
    };
    await runOperations(operations, { boardId: "b1", ids: new Map(), request: request as never });
    for (const call of seen) {
      const [method, path] = call.split(" ");
      const segments = path.split("/").slice(1);
      const known = ROUTES.some((route) => {
        const [routeMethod, routePath] = route.split(" ");
        const routeSegments = routePath.split("/").slice(1);
        return (
          routeMethod === method &&
          routeSegments.length === segments.length &&
          routeSegments.every((s, i) => s === ":x" || s === segments[i])
        );
      });
      expect(known, call).toBe(true);
    }
  });

  it("stops at the first failure", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("boom"));
    await expect(
      runOperations(
        [
          { kind: "deleteCard", id: "a" },
          { kind: "deleteCard", id: "b" },
        ],
        { boardId: "b1", ids: new Map(), request: request as never },
      ),
    ).rejects.toThrow("boom");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
