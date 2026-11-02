import { describe, expect, it } from "vitest";
import { activityTypes, importBoardRequestSchema, type ImportBoardRequest } from "@adt/contracts";
import { buildBoardImport, importedBoardName, uniqueName } from "./boards.import.js";

const KEY = "5d0f3b6e-8f3c-4c53-9a4e-0b8f6f1d2a11";
const AT = "2026-01-02T03:04:05.000Z";

const snapshot = (overrides: Partial<ImportBoardRequest> = {}) =>
  importBoardRequestSchema.parse({ importKey: KEY, name: "Imported", lists: [], ...overrides });

describe("uniqueName", () => {
  it("suffixes taken names case-insensitively and keeps the result within the limit", () => {
    const taken = new Set<string>();
    expect(uniqueName("Todo", taken, 10)).toBe("Todo");
    expect(uniqueName("TODO", taken, 10)).toBe("TODO (2)");
    expect(uniqueName("todo", taken, 10)).toBe("todo (3)");
    expect(uniqueName("abcdefghij", taken, 10)).toBe("abcdefghij");
    expect(uniqueName("abcdefghij", taken, 10)).toBe("abcdef (2)");
  });
});

describe("importedBoardName", () => {
  it("falls back to the default name and cuts long names", () => {
    expect(importedBoardName("   ")).toBe("My board");
    expect(importedBoardName("x".repeat(100))).toHaveLength(40);
  });
});

describe("buildBoardImport", () => {
  it("maps lists, cards and their details, with server-made ids", () => {
    const result = buildBoardImport(
      snapshot({
        lists: [
          {
            id: "l1",
            name: "To do",
            wipLimit: 3,
            collapsed: true,
            cards: [
              {
                title: "Card",
                priority: "high",
                cover: "red",
                dueDate: "2026-03-04",
                notes: "n",
                createdAt: AT,
                checklist: [{ text: "a", done: true }, { text: "  ", done: false }, { text: "b", done: false }],
                comments: [{ text: "c", createdAt: AT, editedAt: AT }],
                labels: ["x", "X", "y"],
                activity: [{ type: "created", at: AT }],
              },
            ],
          },
        ],
      }),
    );
    const list = (result.create.lists as { create: Record<string, any>[] }).create[0];
    expect(list.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(list).toMatchObject({ name: "To do", position: 0, wipLimit: 3, collapsed: true });
    const card = list.cards.create[0];
    expect(card).toMatchObject({ title: "Card", priority: "high", cover: "red", notes: "n", position: 0 });
    expect(card.dueDate.toISOString()).toBe("2026-03-04T00:00:00.000Z");
    expect(card.checklist.create).toEqual([
      { text: "a", done: true, position: 0 },
      { text: "b", done: false, position: 1 },
    ]);
    expect(card.labels.create).toEqual([
      { name: "x", position: 0 },
      { name: "y", position: 1 },
    ]);
    expect(card.comments.create[0].text).toBe("c");
  });

  it("keeps activity entries of all 10 types", () => {
    const result = buildBoardImport(
      snapshot({
        lists: [
          {
            id: "l1",
            name: "To do",
            cards: [
              {
                title: "Card",
                createdAt: AT,
                activity: activityTypes.map((type) => ({ type, at: AT })),
              },
            ],
          },
        ],
      }),
    );
    const list = (result.create.lists as { create: Record<string, any>[] }).create[0];
    const activity = list.cards.create[0].activity.create as { type: string }[];
    expect(activityTypes).toHaveLength(10);
    expect(activity.map((entry) => entry.type)).toEqual([...activityTypes]);
  });

  it("remaps list references and drops unknown ones", () => {
    const result = buildBoardImport(
      snapshot({
        lists: [
          {
            id: "l1",
            name: "A",
            cards: [
              {
                title: "c",
                activity: [
                  { type: "moved", at: AT, from: "gone", to: "l2" },
                  { type: "moved", at: AT, from: "unknown", to: "l1" },
                  { type: "title", at: AT, from: "old", to: "new" },
                ],
              },
            ],
          },
          { id: "l2", name: "B" },
        ],
        formerLists: { gone: "Old list" },
        settings: { doingListId: "l1", doneListId: "nope", view: "table", background: { type: "color", value: "#aabbcc" } },
      }),
    );
    const lists = (result.create.lists as { create: Record<string, any>[] }).create;
    const [a, b] = lists;
    const former = (result.create.formerLists as { create: { listId: string; name: string }[] }).create;
    expect(former).toHaveLength(1);
    expect(former[0].name).toBe("Old list");
    const activity = a.cards.create[0].activity.create;
    expect(activity[0]).toMatchObject({ from: former[0].listId, to: b.id });
    expect(activity[1]).toMatchObject({ from: null, to: a.id });
    expect(activity[2]).toMatchObject({ from: "old", to: "new" });
    expect(result.doingListId).toBe(a.id);
    expect(result.doneListId).toBeNull();
    expect(result.create).toMatchObject({ view: "table", backgroundColor: "#aabbcc", backgroundImageUrl: null });
  });

  it("makes duplicate list and template names unique", () => {
    const template = { name: "T", title: "t" };
    const result = buildBoardImport(
      snapshot({
        lists: [
          { id: "1", name: "Same" },
          { id: "2", name: "same" },
        ],
        templates: [template, { ...template, name: "t" }],
      }),
    );
    const lists = (result.create.lists as { create: { name: string }[] }).create;
    expect(lists.map((l) => l.name)).toEqual(["Same", "same (2)"]);
    const templates = (result.create.templates as { create: { name: string }[] }).create;
    expect(templates.map((t) => t.name)).toEqual(["T", "t (2)"]);
  });

  it("puts archived cards on the board without a list", () => {
    const result = buildBoardImport(snapshot({ archive: [{ title: "Old", archivedAt: AT }] }));
    const archived = (result.create.archivedCards as { create: Record<string, any>[] }).create;
    expect(archived[0]).toMatchObject({ title: "Old", position: 0 });
    expect(archived[0].archivedAt.toISOString()).toBe(AT);
  });
});

describe("importBoardRequestSchema", () => {
  const bad: [string, object][] = [
    ["a missing importKey", { name: "x", lists: [] }],
    ["a non-uuid importKey", { importKey: "abc", name: "x", lists: [] }],
    ["a bad due date", { importKey: KEY, name: "x", lists: [{ id: "1", name: "A", cards: [{ title: "c", dueDate: "2026-02-30" }] }] }],
    ["a bad priority", { importKey: KEY, name: "x", lists: [{ id: "1", name: "A", cards: [{ title: "c", priority: "urgent" }] }] }],
    ["duplicate list ids", { importKey: KEY, name: "x", lists: [{ id: "1", name: "A" }, { id: "1", name: "B" }] }],
    ["a bad WIP limit", { importKey: KEY, name: "x", lists: [{ id: "1", name: "A", wipLimit: 100 }] }],
    ["too many cards", { importKey: KEY, name: "x", lists: [], archive: Array.from({ length: 2001 }, () => ({ title: "c", archivedAt: AT })) }],
  ];
  it.each(bad)("rejects %s", (_label, body) => {
    expect(importBoardRequestSchema.safeParse(body).success).toBe(false);
  });
});
