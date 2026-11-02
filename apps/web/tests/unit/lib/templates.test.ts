import { describe, expect, it } from "vitest";
import { addCard, boardStats, emptyBoard, filterCards, findCard, type Board } from "@/lib/board";
import {
  addCardFromTemplate,
  boardTemplates,
  deleteTemplate,
  MAX_TEMPLATE_NAME_LENGTH,
  MAX_TEMPLATES,
  renameTemplate,
  saveAsTemplate,
  validateTemplateName,
} from "@/lib/templates";

const NOW = new Date("2026-01-01T10:00:00Z");

function richBoard(): Board {
  const board = addCard(emptyBoard(), "Release", { id: "c1", now: NOW });
  const card = {
    ...board.columns.todo[0],
    notes: "Ship it",
    labels: ["ops"],
    priority: "high" as const,
    cover: "blue" as const,
    dueDate: "2026-02-01",
    comments: [{ id: "m1", text: "hi", createdAt: NOW.toISOString() }],
    checklist: [
      { id: "i1", text: "Tag", done: true },
      { id: "i2", text: "Deploy", done: false },
    ],
  };
  return { ...board, columns: { ...board.columns, todo: [card] } };
}

describe("validateTemplateName", () => {
  it("trims and accepts a valid name", () => {
    expect(validateTemplateName("  Bug  ", [])).toEqual({ ok: true, name: "Bug" });
  });

  it("rejects empty, too long and duplicate names", () => {
    expect(validateTemplateName("   ", []).ok).toBe(false);
    expect(validateTemplateName("x".repeat(MAX_TEMPLATE_NAME_LENGTH + 1), []).ok).toBe(false);
    const templates = [{ id: "t1", name: "Bug", title: "Bug", priority: "low" as const }];
    expect(validateTemplateName("bug", templates).ok).toBe(false);
    expect(validateTemplateName("BUG", templates, "t1")).toEqual({ ok: true, name: "BUG" });
  });
});

describe("saveAsTemplate", () => {
  it("copies title, notes, labels, priority, cover and an unticked checklist", () => {
    const board = richBoard();
    const next = saveAsTemplate(board, "c1", "Release", { id: "t1" });
    const [t] = boardTemplates(next);
    expect(t).toMatchObject({ id: "t1", name: "Release", title: "Release", notes: "Ship it", labels: ["ops"], priority: "high", cover: "blue" });
    expect(t.checklist?.map((i) => i.text)).toEqual(["Tag", "Deploy"]);
    expect(t.checklist?.map((i) => i.id)).not.toContain("i1");
    expect(t.checklist?.every((i) => !("done" in i))).toBe(true);
    expect(t).not.toHaveProperty("dueDate");
    expect(t).not.toHaveProperty("comments");
    expect(t).not.toHaveProperty("activity");
    expect(board.templates).toBeUndefined();
  });

  it("defaults the name to the card title and makes it unique", () => {
    let board = richBoard();
    board = saveAsTemplate(board, "c1", undefined, { id: "t1" });
    board = saveAsTemplate(board, "c1", undefined, { id: "t2" });
    expect(boardTemplates(board).map((t) => t.name)).toEqual(["Release", "Release (2)"]);
  });

  it("cuts a long default name to the maximum length", () => {
    const board = addCard(emptyBoard(), "y".repeat(100), { id: "c1" });
    const next = saveAsTemplate(board, "c1");
    expect(boardTemplates(next)[0].name).toHaveLength(MAX_TEMPLATE_NAME_LENGTH);
  });

  it("throws on a missing card, a bad or duplicate name and at the limit", () => {
    const board = richBoard();
    expect(() => saveAsTemplate(board, "nope")).toThrow();
    expect(() => saveAsTemplate(board, "c1", "  ")).toThrow();
    const one = saveAsTemplate(board, "c1", "A", { id: "t1" });
    expect(() => saveAsTemplate(one, "c1", "a")).toThrow();
    let full = board;
    for (let i = 0; i < MAX_TEMPLATES; i++) {
      full = saveAsTemplate(full, "c1", `T${i}`);
    }
    expect(() => saveAsTemplate(full, "c1", "One more")).toThrow();
  });
});

describe("renameTemplate and deleteTemplate", () => {
  const base = saveAsTemplate(richBoard(), "c1", "A", { id: "t1" });
  const two = saveAsTemplate(base, "c1", "B", { id: "t2" });

  it("renames with validation", () => {
    expect(boardTemplates(renameTemplate(two, "t1", " New "))[0].name).toBe("New");
    expect(() => renameTemplate(two, "t1", "b")).toThrow();
    expect(() => renameTemplate(two, "t1", "")).toThrow();
    expect(() => renameTemplate(two, "zz", "X")).toThrow();
    expect(renameTemplate(two, "t1", "A")).toBe(two);
  });

  it("deletes and drops the key when none is left", () => {
    expect(boardTemplates(deleteTemplate(two, "t1")).map((t) => t.id)).toEqual(["t2"]);
    expect(deleteTemplate(base, "t1").templates).toBeUndefined();
    expect(() => deleteTemplate(base, "zz")).toThrow();
  });
});

describe("addCardFromTemplate", () => {
  const withTemplate = saveAsTemplate(richBoard(), "c1", "Release", { id: "t1" });

  it("adds a matching card with fresh ids, unticked checklist and no due date or comments", () => {
    const next = addCardFromTemplate(withTemplate, "t1", "doing", { id: "n1", now: NOW });
    const card = next.columns.doing[0];
    expect(card).toMatchObject({ id: "n1", title: "Release", notes: "Ship it", labels: ["ops"], priority: "high", cover: "blue" });
    expect(card.checklist?.map((i) => [i.text, i.done])).toEqual([["Tag", false], ["Deploy", false]]);
    const templateIds = boardTemplates(withTemplate)[0].checklist?.map((i) => i.id);
    expect(card.checklist?.some((i) => templateIds?.includes(i.id))).toBe(false);
    expect(card.dueDate).toBeUndefined();
    expect(card.comments).toBeUndefined();
    expect(card.activity?.map((a) => a.type)).toEqual(["created"]);
    expect(card.createdAt).toBe(NOW.toISOString());
  });

  it("falls back to the first list and throws for a missing template", () => {
    expect(addCardFromTemplate(withTemplate, "t1", "gone", { id: "n1" }).columns.todo).toHaveLength(2);
    expect(addCardFromTemplate(withTemplate, "t1", undefined, { id: "n2" }).columns.todo).toHaveLength(2);
    expect(() => addCardFromTemplate(withTemplate, "zz", "todo")).toThrow();
  });

  it("does not mutate the input", () => {
    const snapshot = JSON.stringify(withTemplate);
    addCardFromTemplate(withTemplate, "t1", "done");
    expect(JSON.stringify(withTemplate)).toBe(snapshot);
  });
});

describe("templates stay off the board", () => {
  it("are not counted by stats, search or card lookup", () => {
    const board = saveAsTemplate(richBoard(), "c1", "Release", { id: "t1" });
    expect(boardStats(board).total).toBe(1);
    expect(filterCards(board, "Release").columns.todo).toHaveLength(1);
    expect(findCard(board, "t1")).toBeUndefined();
  });
});
