import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/board";
import { cardToText } from "@/lib/cardText";

const base: Card = { id: "c1", title: "Pay rent", createdAt: "2026-01-01T00:00:00.000Z", priority: "medium" };

describe("cardToText", () => {
  it("is just the title for a bare card", () => {
    expect(cardToText(base)).toBe("Pay rent");
  });

  it("adds the due date when set", () => {
    expect(cardToText({ ...base, dueDate: "2026-11-05" })).toBe("Pay rent\n\nDue: 2026-11-05");
  });

  it("adds notes when set", () => {
    expect(cardToText({ ...base, notes: "Line one\nLine two" })).toBe("Pay rent\n\nLine one\nLine two");
  });

  it("lists checklist items as done and not done", () => {
    const card: Card = {
      ...base,
      checklist: [
        { id: "a", text: "Transfer money", done: true },
        { id: "b", text: "Send receipt", done: false },
      ],
    };
    expect(cardToText(card)).toBe("Pay rent\n\n[x] Transfer money\n[ ] Send receipt");
  });

  it("omits an empty checklist", () => {
    expect(cardToText({ ...base, checklist: [] })).toBe("Pay rent");
  });

  it("combines all parts in order", () => {
    const card: Card = {
      ...base,
      dueDate: "2026-11-05",
      notes: "Before noon",
      checklist: [{ id: "a", text: "Transfer", done: true }],
    };
    expect(cardToText(card)).toBe("Pay rent\n\nDue: 2026-11-05\n\nBefore noon\n\n[x] Transfer");
  });
});
