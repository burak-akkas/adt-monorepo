import { importBoardRequestSchema, type ImportBoardRequest, type ImportBoardResponse } from "@adt/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { ACTIVITY_TYPES, emptyBoard, type Board } from "@/lib/board";
import type { BoardEntry } from "@/lib/boards";
import {
  getImportKey,
  hasLocalBoards,
  IMPORT_DONE_STORAGE_KEY,
  IMPORT_KEYS_STORAGE_KEY,
  importLocalBoards,
  isTransientError,
  toImportRequest,
  type LockManagerLike,
} from "@/lib/localImport";
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from "@/lib/storage";
import { saveBoards } from "../../support/testStorage";

const AT = "2026-01-02T03:04:05.000Z";
const LATER = "2026-02-02T03:04:05.000Z";

function richBoard(): Board {
  return {
    ...emptyBoard(),
    background: { type: "color", value: "#445566" },
    view: "calendar",
    wipLimits: { todo: 3 },
    collapsedLists: ["done"],
    formerLists: { gone: "Old list" },
    insightsLists: { doing: "doing", done: "done" },
    templates: [{ id: "t1", name: "Bug", title: "Bug: ", priority: "high", labels: ["bug"], checklist: [{ id: "i1", text: "repro" }] }],
    columns: {
      todo: [
        {
          id: "c1",
          title: "First",
          createdAt: AT,
          priority: "high",
          cover: "blue",
          dueDate: "2026-05-06",
          notes: "notes",
          labels: ["bug"],
          checklist: [{ id: "i1", text: "step", done: true }],
          comments: [{ id: "m1", text: "hi", createdAt: AT, editedAt: LATER }],
          activity: [
            { id: "a0", at: LATER, type: "checklistDone", to: "step" },
            { id: "a1", at: AT, type: "moved", from: "todo", to: "doing" },
          ],
        },
        { id: "c2", title: "Second", createdAt: AT, priority: "medium" },
      ],
      doing: [],
      done: [],
    },
    archive: [
      {
        id: "c3",
        title: "Old",
        createdAt: AT,
        priority: "low",
        activity: [
          { id: "a2", at: LATER, type: "archived" },
          { id: "a3", at: AT, type: "archived" },
        ],
      },
      { id: "c4", title: "No activity", createdAt: AT, priority: "low" },
    ],
  };
}

const entry = (id: string, name: string, board: Board = emptyBoard()): BoardEntry => ({ id, name, board });

function save(entries: BoardEntry[]) {
  saveBoards({ boards: entries, currentId: entries[0].id });
}

const ok = (created = true) => async (request: ImportBoardRequest): Promise<ImportBoardResponse> =>
  ({ board: { id: request.name }, created }) as unknown as ImportBoardResponse;

beforeEach(() => localStorage.clear());

describe("toImportRequest", () => {
  const key = "11111111-1111-4111-8111-111111111111";

  it("maps a full board to a request the contract accepts", () => {
    const request = toImportRequest(entry("b1", "Work", richBoard()), key);
    const parsed = importBoardRequestSchema.parse(request);
    expect(parsed.importKey).toBe(key);
    expect(parsed.name).toBe("Work");
    expect(parsed.lists.map((l) => [l.id, l.name, l.wipLimit, l.collapsed, l.cards.length])).toEqual([
      ["todo", "To do", 3, false, 2],
      ["doing", "Doing", undefined, false, 0],
      ["done", "Done", undefined, true, 0],
    ]);
    expect(parsed.lists[0].cards[0]).toMatchObject({
      title: "First",
      priority: "high",
      cover: "blue",
      dueDate: "2026-05-06",
      checklist: [{ text: "step", done: true }],
      comments: [{ text: "hi", createdAt: AT, editedAt: LATER }],
      labels: ["bug"],
      activity: [
        { type: "checklistDone", at: LATER, to: "step" },
        { type: "moved", at: AT, from: "todo", to: "doing" },
      ],
    });
    expect(parsed.templates).toEqual([{ name: "Bug", title: "Bug:", priority: "high", labels: ["bug"], checklist: ["repro"] }]);
    expect(parsed.formerLists).toEqual({ gone: "Old list" });
    expect(parsed.settings).toEqual({ background: { type: "color", value: "#445566" }, view: "calendar", doingListId: "doing", doneListId: "done" });
  });

  it("sends activity entries of every type, including duplicated", () => {
    const types = ACTIVITY_TYPES.map((type, index) => ({ id: `x${index}`, at: AT, type }));
    const board = richBoard();
    board.columns.todo[1] = { ...board.columns.todo[1], activity: types };
    const parsed = importBoardRequestSchema.parse(toImportRequest(entry("b1", "Work", board), key));
    expect(parsed.lists[0].cards[1].activity?.map((a) => a.type)).toEqual([...ACTIVITY_TYPES]);
    expect(ACTIVITY_TYPES).toHaveLength(10);
  });

  it("dates archived cards by their newest archived entry, else their creation", () => {
    const parsed = importBoardRequestSchema.parse(toImportRequest(entry("b1", "Work", richBoard()), key));
    expect(parsed.archive.map((c) => [c.title, c.archivedAt])).toEqual([
      ["Old", LATER],
      ["No activity", AT],
    ]);
  });

  it("maps an empty board with default settings", () => {
    const parsed = importBoardRequestSchema.parse(toImportRequest(entry("b1", "Empty"), key));
    expect(parsed.lists).toHaveLength(3);
    expect(parsed.archive).toEqual([]);
    expect(parsed.settings.view).toBe("board");
    expect(parsed.settings.background).toBeNull();
  });
});

describe("getImportKey", () => {
  it("is stable across calls and persisted", () => {
    const first = getImportKey("b1");
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(getImportKey("b1")).toBe(first);
    expect(JSON.parse(localStorage.getItem(IMPORT_KEYS_STORAGE_KEY) ?? "{}")).toEqual({ b1: first });
  });

  it("gives each board its own key", () => {
    expect(getImportKey("b1")).not.toBe(getImportKey("b2"));
  });

  it("reuses a key another tab stored", () => {
    localStorage.setItem(IMPORT_KEYS_STORAGE_KEY, JSON.stringify({ b1: "from-other-tab" }));
    expect(getImportKey("b1")).toBe("from-other-tab");
  });

  it("keeps the first key when another tab wrote one during creation", () => {
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      // The other tab wins the race: its value lands after ours.
      real.call(this, k, v);
      real.call(this, k, JSON.stringify({ b1: "winner" }));
    });
    expect(getImportKey("b1")).toBe("winner");
    spy.mockRestore();
  });
});

describe("hasLocalBoards", () => {
  it("is false for empty storage", () => expect(hasLocalBoards()).toBe(false));

  it("is true for saved or legacy data", () => {
    save([entry("b1", "A")]);
    expect(hasLocalBoards()).toBe(true);
    localStorage.clear();
    localStorage.setItem(LEGACY_STORAGE_KEY, "{}");
    expect(hasLocalBoards()).toBe(true);
  });

  it("is false once the import is marked done", () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, "{}");
    localStorage.setItem(IMPORT_DONE_STORAGE_KEY, "1");
    expect(hasLocalBoards()).toBe(false);
  });
});

describe("importLocalBoards", () => {
  it("does nothing without saved data and does not import the default board", async () => {
    const importBoard = vi.fn(ok());
    expect(await importLocalBoards({ importBoard })).toEqual({ status: "nothing" });
    expect(importBoard).not.toHaveBeenCalled();
  });

  it("imports every board, then removes the local copy", async () => {
    save([entry("b1", "A"), entry("b2", "B")]);
    const importBoard = vi.fn(ok());
    expect(await importLocalBoards({ importBoard })).toEqual({ status: "done", imported: 2, alreadyImported: 0, failed: [] });
    expect(importBoard.mock.calls.map(([r]) => r.name)).toEqual(["A", "B"]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(IMPORT_KEYS_STORAGE_KEY)).toBeNull();
    expect(hasLocalBoards()).toBe(false);
  });

  it("counts boards the server already had", async () => {
    save([entry("b1", "A")]);
    expect(await importLocalBoards({ importBoard: ok(false) })).toEqual({ status: "done", imported: 0, alreadyImported: 1, failed: [] });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("imports the other boards when one fails, removes only those, and retries only the failed one", async () => {
    save([entry("b1", "A"), entry("b2", "B"), entry("b3", "C")]);
    let fail = true;
    const importBoard = vi.fn(async (request: ImportBoardRequest) => {
      if (request.name === "B" && fail) {
        throw new ApiError("validation", 400, "too many cards");
      }
      return ok()(request);
    });
    const result = await importLocalBoards({ importBoard });
    expect(result).toMatchObject({
      status: "done",
      imported: 2,
      failed: [{ id: "b2", name: "B", transient: false, error: { kind: "validation", status: 400 } }],
    });
    expect(importBoard.mock.calls.map(([r]) => r.name)).toEqual(["A", "B", "C"]);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.boards.map((b: BoardEntry) => b.id)).toEqual(["b2"]);
    expect(stored.currentId).toBe("b2");
    expect(Object.keys(JSON.parse(localStorage.getItem(IMPORT_KEYS_STORAGE_KEY) ?? "{}"))).toEqual(["b2"]);
    expect(hasLocalBoards()).toBe(true);

    fail = false;
    importBoard.mockClear();
    expect(await importLocalBoards({ importBoard })).toMatchObject({ status: "done", imported: 1, failed: [] });
    expect(importBoard.mock.calls.map(([r]) => r.name)).toEqual(["B"]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(hasLocalBoards()).toBe(false);
  });

  it("keeps everything when every board fails", async () => {
    save([entry("b1", "A")]);
    const before = localStorage.getItem(STORAGE_KEY);
    const result = await importLocalBoards({
      importBoard: async () => {
        throw new ApiError("server", 500, "down");
      },
    });
    expect(result).toMatchObject({ status: "done", imported: 0, failed: [{ id: "b1", transient: true }] });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(hasLocalBoards()).toBe(true);
  });

  it("classifies errors as transient or not", () => {
    const transient = (kind: ApiError["kind"], status = 0) => isTransientError(new ApiError(kind, status, "x"));
    expect([transient("network"), transient("server", 503), transient("rate-limited", 429)]).toEqual([true, true, true]);
    expect([
      transient("validation", 400),
      transient("validation", 413),
      transient("unauthorized", 401),
      transient("forbidden", 403),
      transient("not-found", 404),
      transient("conflict", 409),
      transient("invalid-response", 200),
    ]).toEqual([false, false, false, false, false, false, false]);
  });

  it("treats an unexpected error as a transient network failure and keeps the data", async () => {
    save([entry("b1", "A")]);
    const result = await importLocalBoards({
      importBoard: async () => {
        throw new Error("boom");
      },
    });
    expect(result).toMatchObject({ status: "done", failed: [{ transient: true, error: { kind: "network" } }] });
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("keeps one stable id and key for a legacy board across failed runs", async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ columns: { todo: [], doing: [], done: [] } }));
    const keys: string[] = [];
    const failing = async (request: ImportBoardRequest): Promise<ImportBoardResponse> => {
      keys.push(request.importKey);
      throw new ApiError("network", 0, "down");
    };
    await importLocalBoards({ importBoard: failing });
    const firstId = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}").boards[0].id;
    await importLocalBoards({ importBoard: failing });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}").boards[0].id).toBe(firstId);
    expect(keys[1]).toBe(keys[0]);
  });

  it("posts each board once when two runs overlap, with a serialising lock", async () => {
    save([entry("b1", "A"), entry("b2", "B")]);
    let tail: Promise<unknown> = Promise.resolve();
    const locks: LockManagerLike = {
      request: <T,>(_name: string, callback: () => Promise<T>) => {
        const run = tail.then(callback);
        tail = run.catch(() => undefined);
        return run;
      },
    };
    const importBoard = vi.fn(ok());
    const [first, second] = await Promise.all([importLocalBoards({ importBoard, locks }), importLocalBoards({ importBoard, locks })]);
    expect(first).toMatchObject({ status: "done", imported: 2 });
    expect(second).toEqual({ status: "nothing" });
    expect(importBoard).toHaveBeenCalledTimes(2);
  });

  it("sends the same keys when retried", async () => {
    save([entry("b1", "A"), entry("b2", "B")]);
    const keys: string[][] = [[], []];
    const failing = async (request: ImportBoardRequest) => {
      keys[0].push(request.importKey);
      throw new ApiError("network", 0, "down");
    };
    await importLocalBoards({ importBoard: failing });
    const importBoard = vi.fn(async (request: ImportBoardRequest) => {
      keys[1].push(request.importKey);
      return ok()(request);
    });
    await importLocalBoards({ importBoard });
    expect(keys[1][0]).toBe(keys[0][0]);
    expect(keys[1][0]).not.toBe(keys[1][1]);
  });

  it("imports the legacy board and does not import it again", async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ columns: { todo: [], doing: [], done: [] } }));
    const importBoard = vi.fn(ok());
    expect(await importLocalBoards({ importBoard })).toMatchObject({ status: "done", imported: 1 });
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).not.toBeNull();
    expect(await importLocalBoards({ importBoard })).toEqual({ status: "nothing" });
    expect(importBoard).toHaveBeenCalledTimes(1);
  });
});
