import { describe, expect, it } from "vitest";
import { addCard, addComment, archiveDone, emptyBoard, MAX_COMMENT_LENGTH, moveCard, setDueDate, setNotes, setPriority } from "@/lib/board";
import { initialBoardList } from "@/lib/boards";
import {
  exportFilename,
  isBoardList,
  LEGACY_STORAGE_KEY,
  loadBoards,
  parseBoard,
  saveBoards,
  serializeBoard,
  STORAGE_KEY,
} from "@/lib/storage";
import { loadBoard, saveBoard } from "../../support/testStorage";

describe("board list storage", () => {
  const legacyBoard = () => {
    const card = { id: "a", title: "Old", createdAt: "2024-01-01T00:00:00.000Z", priority: "high" };
    const archived = { id: "z", title: "Gone", createdAt: "2024-01-01T00:00:00.000Z", priority: "low" };
    return {
      columns: { todo: [card], doing: [], done: [] },
      archive: [archived],
      wipLimits: { todo: 3 },
    };
  };

  it("starts with one empty 'My board' on fresh data", () => {
    const list = loadBoards();
    expect(list.boards).toHaveLength(1);
    expect(list.boards[0].name).toBe("My board");
    expect(list.boards[0].board).toEqual(emptyBoard());
    expect(list.currentId).toBe(list.boards[0].id);
  });

  it("migrates the legacy board as 'My board' and leaves the legacy key untouched", () => {
    const raw = JSON.stringify(legacyBoard());
    localStorage.setItem(LEGACY_STORAGE_KEY, raw);
    const list = loadBoards();
    expect(list.boards).toHaveLength(1);
    expect(list.boards[0].name).toBe("My board");
    expect(list.boards[0].board.columns.todo.map((c) => c.id)).toEqual(["a"]);
    expect(list.boards[0].board.archive.map((c) => c.id)).toEqual(["z"]);
    expect(list.boards[0].board.wipLimits).toEqual({ todo: 3 });
    saveBoards(list);
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(raw);
    expect(loadBoards().boards[0].board.columns.todo).toHaveLength(1);
  });

  it("migrates a legacy board without archive or wipLimits", () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ columns: { todo: [], doing: [], done: [] } }));
    const { board } = loadBoards().boards[0];
    expect(board.archive).toEqual([]);
    expect(board.wipLimits).toBeUndefined();
  });

  it("prefers v2 data over the legacy key", () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacyBoard()));
    saveBoards(initialBoardList("x"));
    expect(loadBoards().boards[0].board.columns.todo).toEqual([]);
  });

  it("gives an empty list for corrupt v2 data without consulting the legacy key", () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacyBoard()));
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadBoards().boards[0].board).toEqual(emptyBoard());
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ boards: "x", currentId: "a" }));
    expect(loadBoards().boards[0].board).toEqual(emptyBoard());
  });

  it("falls back to the first board for an unknown currentId", () => {
    const entry = (id: string) => ({ id, name: id, board: emptyBoard() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ boards: [entry("a"), entry("b")], currentId: "nope" }));
    expect(loadBoards().currentId).toBe("a");
  });

  it("drops invalid and duplicate-id entries, falling back when none are left", () => {
    const good = { id: "a", name: "A", board: emptyBoard() };
    const stored = {
      boards: [good, { ...good, name: "dup" }, { id: 1, name: "B", board: emptyBoard() }, { id: "c", name: "C", board: {} }],
      currentId: "a",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    expect(loadBoards().boards.map((b) => b.name)).toEqual(["A"]);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ boards: [], currentId: "a" }));
    expect(loadBoards().boards).toHaveLength(1);
    expect(loadBoards().boards[0].name).toBe("My board");
  });

  it("validates the list shape", () => {
    expect(isBoardList(initialBoardList("a"))).toBe(true);
    for (const bad of [null, [], "x", {}, { boards: [] }, { currentId: "a" }]) {
      expect(isBoardList(bad)).toBe(false);
    }
  });
});

describe("storage", () => {
  it("round-trips a board through localStorage", () => {
    const board = addCard(emptyBoard(), "persist me", { id: "a" });
    saveBoard(board);
    expect(loadBoard()).toEqual(board);
  });

  it("returns an empty board when nothing is stored", () => {
    expect(loadBoard()).toEqual(emptyBoard());
  });

  it("returns an empty board for corrupt or foreign data", () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, "{not json");
    expect(loadBoard()).toEqual(emptyBoard());

    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ columns:{ todo: [{ id: 1 }] } }));
    expect(loadBoard()).toEqual(emptyBoard());
  });

  it("loads a board saved before archiving with an empty archive", () => {
    const old = { id: "a", title: "Old", createdAt: "2024-01-01T00:00:00.000Z", priority: "medium" };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ columns:{ todo: [old], doing: [], done: [] } }));
    const board = loadBoard();
    expect(board.archive).toEqual([]);
    expect(board.columns.todo).toEqual([old]);
  });

  it("round-trips the archive", () => {
    const board = archiveDone(moveCard(addCard(emptyBoard(), "Done one", { id: "a" }), "a", "done"));
    saveBoard(board);
    expect(loadBoard()).toEqual(board);
  });

  it("ignores a corrupt archive and drops invalid archived cards", () => {
    const columns = { todo: [], doing: [], done: [] };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ columns, archive: "nope" }));
    expect(loadBoard().archive).toEqual([]);

    const good = { id: "a", title: "Good", createdAt: "2024-01-01T00:00:00.000Z", priority: "low" };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ columns, archive: [good, { id: 1 }, null] }));
    expect(loadBoard().archive).toEqual([good]);
  });

  it("loads cards saved before due dates existed", () => {
    const old = { id: "a", title: "Old", createdAt: "2024-01-01T00:00:00.000Z", priority: "medium" };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ columns:{ todo: [old], doing: [], done: [] } }));
    expect(loadBoard().columns.todo).toEqual([old]);
  });

  it("round-trips a due date", () => {
    const board = setDueDate(addCard(emptyBoard(), "Due", { id: "a" }), "a", "2026-10-28");
    saveBoard(board);
    expect(loadBoard().columns.todo[0].dueDate).toBe("2026-10-28");
  });

  it("returns an empty board for an invalid stored due date", () => {
    for (const dueDate of [20261028, "nope", "2026-02-31", null]) {
      const card = { id: "a", title: "Bad", createdAt: "x", dueDate };
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ columns:{ todo: [card], doing: [], done: [] } }));
      expect(loadBoard()).toEqual(emptyBoard());
    }
  });

  it("loads cards saved without a priority as Medium, keeping other data", () => {
    const legacy = { id: "a", title: "old", createdAt: "2026-01-01T00:00:00.000Z" };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ columns:{ todo: [], doing: [legacy], done: [] } }));
    expect(loadBoard().columns.doing).toEqual([{ ...legacy, priority: "medium" }]);
  });

  it("falls back to Medium for invalid priorities and keeps valid ones", () => {
    const card = { id: "a", title: "t", createdAt: "x" };
    const stored = {
      columns: {
        todo: [
          { ...card, id: "1", priority: "urgent" },
          { ...card, id: "2", priority: 3 },
          { ...card, id: "3", priority: "high" },
        ],
        doing: [],
        done: [],
      },
    };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(stored));
    expect(loadBoard().columns.todo.map((c) => c.priority)).toEqual(["medium", "medium", "high"]);
  });

  it("round-trips a high priority", () => {
    const board = setPriority(addCard(emptyBoard(), "x", { id: "a" }), "a", "high");
    saveBoard(board);
    expect(loadBoard()).toEqual(board);
  });

  it("loads legacy cards without notes unchanged", () => {
    const old = { id: "a", title: "Old", createdAt: "x", priority: "low" };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ columns:{ todo: [old], doing: [], done: [] } }));
    const [card] = loadBoard().columns.todo;
    expect(card).toEqual(old);
    expect("notes" in card).toBe(false);
  });

  it("round-trips notes", () => {
    const board = setNotes(addCard(emptyBoard(), "x", { id: "a" }), "a", "one\ntwo");
    saveBoard(board);
    expect(loadBoard()).toEqual(board);
  });

  it("drops invalid or blank notes but keeps the card, and trims valid ones", () => {
    const card = { id: "a", title: "t", createdAt: "x", priority: "high" };
    const stored = {
      columns: {
        todo: [
          { ...card, id: "1", notes: 42 },
          { ...card, id: "2", notes: "x".repeat(1001) },
          { ...card, id: "3", notes: "   " },
          { ...card, id: "4", notes: "  keep  " },
          { ...card, id: "5", notes: null },
        ],
        doing: [],
        done: [],
      },
    };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(stored));
    const cards =loadBoard().columns.todo;
    expect(cards.map((c) => c.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(cards.map((c) => c.notes)).toEqual([undefined, undefined, undefined, "keep", undefined]);
    expect(cards.map((c) => "notes" in c)).toEqual([false, false, false, true, false]);
  });

  it("works without storage", () => {
    expect(loadBoards(undefined).boards[0].board).toEqual(emptyBoard());
    expect(() => saveBoards(initialBoardList(), undefined)).not.toThrow();
  });
});

describe("export and import", () => {
  it("round-trips a board through serializeBoard and parseBoard", () => {
    const added = addCard(emptyBoard(), "Task", { id: "c1" });
    const board = setDueDate(setPriority(added, "c1", "low"), "c1", "2026-01-02");
    const result = parseBoard(serializeBoard(board));
    expect(result).toEqual({ ok: true, board });
  });

  describe("comments", () => {
    const at = "2026-10-28T10:00:00.000Z";
    const parseComments = (comments: unknown) => {
      const card = { id: "a", title: "t", createdAt: at, comments };
      const result = parseBoard(JSON.stringify({ columns: { todo: [card], doing: [], done: [] } }));
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result.board.columns.todo[0];
    };

    it("round-trips comments through serializeBoard and parseBoard", () => {
      const board = addComment(addCard(emptyBoard(), "Task", { id: "c1" }), "c1", "hello", { id: "m1" });
      expect(parseBoard(serializeBoard(board))).toEqual({ ok: true, board });
    });

    it("keeps valid comments trimmed and in order, with a valid editedAt", () => {
      const card = parseComments([
        { id: "1", text: " one ", createdAt: at, editedAt: at },
        { id: "2", text: "two", createdAt: at },
      ]);
      expect(card.comments).toEqual([
        { id: "1", text: "one", createdAt: at, editedAt: at },
        { id: "2", text: "two", createdAt: at },
      ]);
    });

    it("drops invalid, blank, over-long and duplicate-id comments, and a bad editedAt alone", () => {
      const card = parseComments([
        null,
        "text",
        { id: 1, text: "x", createdAt: at },
        { id: "blank", text: "  ", createdAt: at },
        { id: "long", text: "x".repeat(MAX_COMMENT_LENGTH + 1), createdAt: at },
        { id: "baddate", text: "x", createdAt: "nope" },
        { id: "dup", text: "first", createdAt: at },
        { id: "dup", text: "second", createdAt: at },
        { id: "badedit", text: "kept", createdAt: at, editedAt: "nope" },
      ]);
      expect(card.comments).toEqual([
        { id: "dup", text: "first", createdAt: at },
        { id: "badedit", text: "kept", createdAt: at },
      ]);
    });

    it("omits the key when nothing valid is left or the value is not a list", () => {
      expect("comments" in parseComments([{ id: "x", text: "", createdAt: at }])).toBe(false);
      expect("comments" in parseComments("nope")).toBe(false);
      expect("comments" in parseComments(undefined)).toBe(false);
    });

    it("loads cards without comments unchanged and normalizes archived cards and saved boards", () => {
      const list = initialBoardList();
      const card = { id: "a", title: "t", createdAt: at, priority: "low" as const };
      const archived = { ...card, id: "z", comments: [{ id: "m", text: " hi ", createdAt: at }] };
      const board = { columns: { todo: [card], doing: [], done: [] }, archive: [archived] };
      const storage = new Map<string, string>();
      const fake = {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => void storage.set(k, v),
      } as unknown as Storage;
      saveBoards({ ...list, boards: [{ ...list.boards[0], board }] }, fake);
      const loaded = loadBoards(fake).boards[0].board;
      expect(loaded.columns.todo[0]).toEqual(card);
      expect(loaded.archive[0].comments).toEqual([{ id: "m", text: "hi", createdAt: at }]);
    });
  });

  it("defaults missing priority and leaves a missing dueDate unset", () => {
    const old = JSON.stringify({
      columns: { todo: [{ id: "a", title: "Old", createdAt: "2024-01-01T00:00:00.000Z" }], doing: [], done: [] },
    });
    const result = parseBoard(old);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.board.columns.todo[0].priority).toBe("medium");
      expect(result.board.columns.todo[0].dueDate).toBeUndefined();
    }
  });

  it.each([
    ["not json", "nope"],
    ["empty object", "{}"],
    ["array", "[]"],
    ["null", "null"],
    ["missing columns", '{"columns":{"todo":[]}}'],
    [
      "bad due date",
      '{"columns":{"todo":[{"id":"a","title":"t","createdAt":"x","dueDate":"31-12-2026"}],"doing":[],"done":[]}}',
    ],
  ])("rejects %s", (_name, text) => {
    const result = parseBoard(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toBe("");
    }
  });

  it("names the export file after the local date", () => {
    expect(exportFilename(new Date(2026, 9, 28))).toBe("kanban-board-2026-10-28.json");
  });
});

describe("board background storage", () => {
  const withBackground = (background: unknown) =>
    JSON.stringify({ ...emptyBoard(), archive: [], background });

  it("loads boards without a background unchanged", () => {
    const result = parseBoard(JSON.stringify(emptyBoard()));
    expect(result.ok && result.board.background).toBeUndefined();
  });

  it("round-trips a color and an image background through export and import", () => {
    for (const background of [
      { type: "color", value: "#aabbcc" },
      { type: "image", url: "https://example.com/a.jpg" },
    ]) {
      const result = parseBoard(serializeBoard({ ...emptyBoard(), background } as ReturnType<typeof emptyBoard>));
      expect(result.ok && result.board.background).toEqual(background);
    }
  });

  it.each([
    "red",
    { type: "color", value: "red" },
    { type: "image", url: "javascript:alert(1)" },
    { type: "image", url: "data:image/png;base64,AAAA" },
    { type: "nope" },
  ])("drops the invalid background %j and keeps the board", (background) => {
    const result = parseBoard(withBackground(background));
    expect(result.ok).toBe(true);
    expect(result.ok && "background" in result.board).toBe(false);
  });
});
