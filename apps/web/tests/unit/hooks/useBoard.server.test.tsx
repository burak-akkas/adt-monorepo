import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { addCard, archiveCard, renameCard, undoArchive, type Board } from "@/lib/board";
import { resetBoardStore, useBoard, useBoards, useSaveError } from "@/hooks/useBoard";

vi.unmock("@/hooks/serverBoardStore");
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiRequest: vi.fn(),
  importBoard: vi.fn(),
}));

const { apiRequest, importBoard } = await import("@/lib/api-client");
const request = vi.mocked(apiRequest);
const postImport = vi.mocked(importBoard);

const AT = "2026-01-02T03:04:05.000Z";

type Json = Record<string, unknown>;

function cardJson(id: string, listId: string, position: number, title = `Card ${id}`): Json {
  return {
    id,
    listId,
    title,
    priority: "medium",
    cover: null,
    dueDate: null,
    notes: null,
    position,
    createdAt: AT,
    checklist: [],
    comments: [],
    labels: [],
    activity: [],
  };
}

function detailJson(id: string, name: string, cards: Json[] = [cardJson("c1", "l1", 0)]): Json {
  return {
    id,
    name,
    createdAt: AT,
    updatedAt: AT,
    lists: [
      { id: "l1", boardId: id, name: "To do", position: 0, wipLimit: null, collapsed: false, cards },
      { id: "l2", boardId: id, name: "Done", position: 1, wipLimit: null, collapsed: false, cards: [] },
    ],
    settings: { background: null, view: "board", collapsedListIds: [], doingListId: null, doneListId: "l2" },
    formerLists: {},
    templates: [],
    archive: [],
  };
}

const summary = (id: string, name: string) => ({ id, name, createdAt: AT, updatedAt: AT });

// What the fake server holds and what it was asked to do.
let details: Record<string, Json>;
let calls: string[];
let failing: Set<string>;
// Calls that answer with a given error, and calls that wait until their gate is opened.
let errors: Map<string, ApiError>;
let gates: Map<string, Promise<void>>;

function titles(board: Board, listId = "l1") {
  return (board.columns[listId] ?? []).map((c) => c.title);
}

beforeEach(() => {
  localStorage.clear();
  resetBoardStore();
  details = { b1: detailJson("b1", "First"), b2: detailJson("b2", "Second", []) };
  calls = [];
  failing = new Set();
  errors = new Map();
  gates = new Map();
  postImport.mockReset();
  request.mockReset();
  request.mockImplementation((async (path: string, options: { method?: string; body?: unknown } = {}) => {
    const call = `${options.method ?? "GET"} ${path}`;
    calls.push(call);
    await gates.get(call);
    const error = errors.get(call);
    if (error) {
      throw error;
    }
    if (failing.has(call)) {
      throw new ApiError("server", 500, "Boom");
    }
    const body = options.body as Json | undefined;
    switch (call) {
      case "GET /boards":
        return Object.values(details).map((d) => summary(d.id as string, d.name as string));
      case "GET /boards/b1":
      case "GET /boards/b2":
      case "GET /boards/b3":
        if (!details[path.split("/")[2]]) {
          throw new ApiError("not-found", 404, "Not found");
        }
        return structuredClone(details[path.split("/")[2]]);
      case "POST /lists/l1/cards": {
        const list = (details.b1.lists as Json[])[0];
        (list.cards as Json[]).push(cardJson("srv1", "l1", 1, (body as { title: string }).title));
        return { id: "srv1" };
      }
      case "POST /boards":
        details.b3 = detailJson("b3", (body as { name: string }).name, []);
        return summary("b3", (body as { name: string }).name);
      case "POST /boards/b3/lists":
        return { id: `new-${calls.length}` };
      case "POST /boards/b1/duplicate":
        details.b3 = detailJson("b3", "First (copy)");
        return summary("b3", "First (copy)");
      case "DELETE /boards/b1":
        delete details.b1;
        return undefined;
      default:
        return undefined;
    }
  }) as unknown as typeof apiRequest);
});

function setup() {
  return renderHook(() => ({ board: useBoard(), boards: useBoards(), save: useSaveError() }));
}

async function ready() {
  const view = setup();
  await waitFor(() => expect(view.result.current.boards.ready).toBe(true));
  return view;
}

describe("server mode: loading", () => {
  it("is not ready, then loads the list and the first board", async () => {
    const { result } = setup();
    expect(result.current.boards.ready).toBe(false);
    await waitFor(() => expect(result.current.boards.ready).toBe(true));
    expect(result.current.boards.boards.map((b) => b.name)).toEqual(["First", "Second"]);
    expect(result.current.boards.currentId).toBe("b1");
    expect(titles(result.current.board[0])).toEqual(["Card c1"]);
    expect(calls).toEqual(["GET /boards", "GET /boards/b1"]);
  });

  it("creates the default board for an account without boards", async () => {
    details = {};
    request.mockImplementationOnce((async () => []) as unknown as typeof apiRequest);
    request.mockImplementationOnce((async (path: string, options: { body?: unknown } = {}) => {
      expect(path).toBe("/boards");
      details.b1 = detailJson("b1", (options.body as { name: string }).name, []);
      return summary("b1", "My board");
    }) as unknown as typeof apiRequest);
    const { result } = setup();
    await waitFor(() => expect(result.current.boards.ready).toBe(true));
    expect(result.current.boards.boards).toEqual([{ id: "b1", name: "My board" }]);
  });
});

describe("server mode: update", () => {
  it("shows a card at once and sends it through the API", async () => {
    const { result } = await ready();
    calls.length = 0;
    act(() => result.current.board[1]((b) => addCard(b, "New", { id: "client-1", listId: "l1" })));
    expect(titles(result.current.board[0])).toContain("New");
    await waitFor(() => expect(calls).toContain("POST /lists/l1/cards"));
  });

  it("refetches once after creates, keeps the client id on screen and sends the server id", async () => {
    const { result } = await ready();
    calls.length = 0;
    act(() => result.current.board[1]((b) => addCard(b, "New", { id: "client-1", listId: "l1" })));
    await waitFor(() => expect(calls).toEqual(["POST /lists/l1/cards", "GET /boards/b1"]));
    // The card keeps the id it was made with, so a card dialog that is open stays open.
    await waitFor(() => expect(result.current.board[0].columns.l1.map((c) => c.id)).toEqual(["c1", "client-1"]));

    calls.length = 0;
    act(() => result.current.board[1]((b) => renameCard(b, "client-1", "Renamed")));
    await waitFor(() => expect(calls).toEqual(["PATCH /cards/srv1"]));
  });

  it("sends changes in order, one after the other", async () => {
    const { result } = await ready();
    calls.length = 0;
    act(() => {
      result.current.board[1]((b) => renameCard(b, "c1", "One"));
      result.current.board[1]((b) => renameCard(b, "c1", "Two"));
    });
    expect(titles(result.current.board[0])).toEqual(["Two"]);
    await waitFor(() => expect(calls).toEqual(["PATCH /cards/c1", "PATCH /cards/c1"]));
  });

  it("returns to the server state with a message when a save fails, and skips what was queued", async () => {
    const { result } = await ready();
    failing.add("PATCH /cards/c1");
    calls.length = 0;
    act(() => {
      result.current.board[1]((b) => renameCard(b, "c1", "One"));
      result.current.board[1]((b) => addCard(b, "Later", { id: "client-2", listId: "l1" }));
    });
    await waitFor(() => expect(result.current.save.error).toContain("Could not save"));
    expect(result.current.save.error).toContain("Boom");
    await waitFor(() => expect(titles(result.current.board[0])).toEqual(["Card c1"]));
    expect(calls).not.toContain("POST /lists/l1/cards");
    expect(calls).toContain("GET /boards/b1");

    act(() => result.current.save.dismiss());
    expect(result.current.save.error).toBeNull();
  });

  it("treats a change that cannot be sent like a failed save", async () => {
    details.b1.templates = [
      { id: "t1", boardId: "b1", name: "T", title: "x", priority: "medium", notes: null, labels: [], cover: null, checklist: [] },
    ];
    const { result } = await ready();
    calls.length = 0;
    // Only a rename can be sent for an existing template.
    act(() =>
      result.current.board[1]((b) => ({
        ...b,
        templates: [{ id: "t1", name: "T2", title: "changed", priority: "medium" }],
      })),
    );
    await waitFor(() => expect(result.current.save.error).toContain("Could not save"));
    expect(result.current.save.error).toContain("Cannot save this change");
    expect(calls).toEqual(["GET /boards", "GET /boards/b1"]);
  });

  it("shows a reload message when the refetch fails too", async () => {
    const { result } = await ready();
    failing.add("PATCH /cards/c1");
    failing.add("GET /boards");
    act(() => result.current.board[1]((b) => renameCard(b, "c1", "One")));
    await waitFor(() => expect(result.current.save.error).toContain("Reload the page"));
  });

  it("undoes an archive with the inverse API calls", async () => {
    const { result } = await ready();
    calls.length = 0;
    const archived = result.current.board[0].columns.l1;
    act(() => result.current.board[1]((b) => archiveCard(b, "c1")));
    act(() => result.current.board[1]((b) => undoArchive(b, archived, { listId: "l1" })));
    expect(titles(result.current.board[0])).toEqual(["Card c1"]);
    await waitFor(() => expect(calls).toEqual(["POST /cards/c1/archive", "POST /archive/c1/restore"]));
  });
});

function gate(call: string) {
  let open!: () => void;
  gates.set(call, new Promise<void>((resolve) => (open = resolve)));
  return () => {
    gates.delete(call);
    open();
  };
}

const focus = () => act(() => void window.dispatchEvent(new Event("focus")));

function serverRenames(title: string) {
  ((details.b1.lists as Json[])[0].cards as Json[])[0].title = title;
}

describe("server mode: catching up with the server", () => {
  it("shows the server's board when the window gets focus", async () => {
    const { result } = await ready();
    serverRenames("Changed in tab A");
    details.b2.name = "Renamed in tab A";
    focus();
    await waitFor(() => expect(titles(result.current.board[0])).toEqual(["Changed in tab A"]));
    expect(result.current.boards.boards.map((b) => b.name)).toEqual(["First", "Renamed in tab A"]);
  });

  it("catches up when the tab becomes visible, but not when it becomes hidden", async () => {
    const { result } = await ready();
    serverRenames("Changed in tab A");
    const visibility = vi.spyOn(document, "visibilityState", "get");
    try {
      calls.length = 0;
      visibility.mockReturnValue("hidden");
      act(() => void document.dispatchEvent(new Event("visibilitychange")));
      await Promise.resolve();
      expect(calls).toEqual([]);

      visibility.mockReturnValue("visible");
      act(() => void document.dispatchEvent(new Event("visibilitychange")));
      await waitFor(() => expect(titles(result.current.board[0])).toEqual(["Changed in tab A"]));
    } finally {
      visibility.mockRestore();
    }
  });

  it("waits for a save in flight and does not put an older board over it", async () => {
    const { result } = await ready();
    const open = gate("PATCH /cards/c1");
    act(() => result.current.board[1]((b) => renameCard(b, "c1", "Mine")));
    calls.length = 0;
    focus();
    await Promise.resolve();
    expect(calls).not.toContain("GET /boards/b1");
    serverRenames("Mine");
    open();
    await waitFor(() => expect(calls).toContain("GET /boards/b1"));
    await waitFor(() => expect(calls.filter((c) => c === "GET /boards/b1")).toHaveLength(1));
    expect(titles(result.current.board[0])).toEqual(["Mine"]);
  });

  it("keeps an edit made while the catch-up is fetching", async () => {
    const { result } = await ready();
    const open = gate("GET /boards/b1");
    focus();
    await waitFor(() => expect(calls.filter((c) => c === "GET /boards/b1")).toHaveLength(2));
    act(() => result.current.board[1]((b) => renameCard(b, "c1", "Typed just now")));
    open();
    await waitFor(() => expect(calls).toContain("PATCH /cards/c1"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(titles(result.current.board[0])).toEqual(["Typed just now"]);
  });

  it.each([
    ["not-found", 404],
    ["conflict", 409],
  ] as const)("refetches and says it was changed elsewhere on a %s", async (kind, status) => {
    const { result } = await ready();
    errors.set("PATCH /cards/c1", new ApiError(kind, status, "Nope"));
    serverRenames("Server version");
    calls.length = 0;
    act(() => {
      result.current.board[1]((b) => renameCard(b, "c1", "One"));
      result.current.board[1]((b) => addCard(b, "Later", { id: "client-2", listId: "l1" }));
    });
    await waitFor(() => expect(result.current.save.error).toContain("changed somewhere else"));
    expect(result.current.save.error).not.toContain("Nope");
    await waitFor(() => expect(titles(result.current.board[0])).toEqual(["Server version"]));
    expect(calls).toContain("GET /boards/b1");
    // The edit queued after the failed one was skipped, so it cannot undo the refetch.
    expect(calls).not.toContain("POST /lists/l1/cards");
  });

  it("keeps the generic message for a server error", async () => {
    const { result } = await ready();
    failing.add("PATCH /cards/c1");
    act(() => result.current.board[1]((b) => renameCard(b, "c1", "One")));
    await waitFor(() => expect(result.current.save.error).toContain("Could not save"));
    expect(result.current.save.error).not.toContain("changed somewhere else");
  });

  it("reloads the boards when the shown board is gone", async () => {
    const { result } = await ready();
    delete details.b1;
    focus();
    await waitFor(() => expect(result.current.boards.currentId).toBe("b2"));
    expect(result.current.save.error).toContain("changed somewhere else");
  });

  it("says nothing and keeps the board when the catch-up fails", async () => {
    const { result } = await ready();
    failing.add("GET /boards");
    calls.length = 0;
    focus();
    await waitFor(() => expect(calls).toContain("GET /boards"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.save.error).toBeNull();
    expect(result.current.boards.ready).toBe(true);
    expect(titles(result.current.board[0])).toEqual(["Card c1"]);
  });
});

describe("server mode: boards", () => {
  it("creates a board and selects it", async () => {
    const { result } = await ready();
    let outcome: ReturnType<typeof result.current.boards.createBoard> | undefined;
    act(() => {
      outcome = result.current.boards.createBoard("Third");
    });
    expect(outcome).toEqual({ ok: true, name: "Third" });
    await waitFor(() => expect(result.current.boards.currentId).toBe("b3"));
    expect(calls).toContain("POST /boards");
    // The API makes an empty board: the three default lists are added to it.
    expect(calls.filter((c) => c === "POST /boards/b3/lists")).toHaveLength(3);
    expect(result.current.boards.boards.map((b) => b.name)).toContain("Third");
  });

  it("stores the Doing / Done lists found by name the first time a board is read", async () => {
    const detail = detailJson("b1", "First");
    detail.lists = [
      { id: "l1", boardId: "b1", name: "To do", position: 0, wipLimit: null, collapsed: false, cards: [] },
      { id: "l2", boardId: "b1", name: "Doing", position: 1, wipLimit: null, collapsed: false, cards: [] },
      { id: "l3", boardId: "b1", name: "Done", position: 2, wipLimit: null, collapsed: false, cards: [] },
    ];
    detail.settings = { background: null, view: "board", collapsedListIds: [], doingListId: null, doneListId: null };
    details = { b1: detail };
    const { result } = await ready();
    expect(calls).toContain("PATCH /boards/b1/settings");
    expect(request).toHaveBeenCalledWith("/boards/b1/settings", { method: "PATCH", body: { doingListId: "l2", doneListId: "l3" } });
    expect(result.current.board[0].insightsLists).toEqual({ doing: "l2", done: "l3" });
  });

  it("refuses an invalid name without calling the API", async () => {
    const { result } = await ready();
    calls.length = 0;
    let outcome: ReturnType<typeof result.current.boards.createBoard> | undefined;
    act(() => {
      outcome = result.current.boards.createBoard("  ");
    });
    expect(outcome?.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("renames at once and sends PATCH /boards/:id", async () => {
    const { result } = await ready();
    act(() => void result.current.boards.renameBoard("b1", "Renamed"));
    expect(result.current.boards.boards[0].name).toBe("Renamed");
    await waitFor(() => expect(calls).toContain("PATCH /boards/b1"));
  });

  it("selects a board by fetching it", async () => {
    const { result } = await ready();
    act(() => result.current.boards.selectBoard("b2"));
    await waitFor(() => expect(result.current.boards.currentId).toBe("b2"));
    expect(calls).toContain("GET /boards/b2");
    expect(localStorage.getItem("kanban-current-board-v1")).toBe("b2");
    expect(titles(result.current.board[0])).toEqual([]);
  });

  it("is not ready while another board loads", async () => {
    const { result } = await ready();
    act(() => result.current.boards.selectBoard("b2"));
    expect(result.current.boards.ready).toBe(false);
    await waitFor(() => expect(result.current.boards.ready).toBe(true));
    expect(result.current.boards.currentId).toBe("b2");
  });

  it("duplicates the current board and selects the copy", async () => {
    const { result } = await ready();
    act(() => result.current.boards.duplicateBoard());
    await waitFor(() => expect(result.current.boards.currentId).toBe("b3"));
    expect(calls).toContain("POST /boards/b1/duplicate");
  });

  it("deletes a board and selects a neighbour; the last board stays", async () => {
    const { result } = await ready();
    act(() => result.current.boards.deleteBoard("b1"));
    await waitFor(() => expect(result.current.boards.currentId).toBe("b2"));
    expect(calls).toContain("DELETE /boards/b1");
    expect(result.current.boards.boards.map((b) => b.id)).toEqual(["b2"]);

    calls.length = 0;
    act(() => result.current.boards.deleteBoard("b2"));
    expect(calls).toEqual([]);
  });

  it("imports a file as a new board with a fresh import key", async () => {
    const { result } = await ready();
    postImport.mockImplementation(async () => {
      details.b3 = detailJson("b3", "From file", []);
      return { board: details.b3, created: true } as unknown as Awaited<ReturnType<typeof importBoard>>;
    });
    act(() => result.current.boards.importBoardFile?.(result.current.board[0], "From file"));
    await waitFor(() => expect(result.current.boards.currentId).toBe("b3"));
    expect(postImport).toHaveBeenCalledTimes(1);
    const sent = postImport.mock.calls[0][0];
    expect(sent.name).toBe("From file");
    expect(sent.importKey).toMatch(/[0-9a-f-]{36}/);
    expect(sent.lists.map((l) => l.name)).toEqual(["To do", "Done"]);
  });
});
