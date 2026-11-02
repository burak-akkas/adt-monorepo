import { describe, expect, it } from "vitest";
import {
  addCard,
  addChecklistItem,
  archiveList,
  emptyBoard,
  moveCard,
  setDueDate,
  setLabels,
  setPriority,
  toggleChecklistItem,
  type Board,
} from "@/lib/board";
import { filterRows, lastActivityAt, sortRows, tableRows, type SortKey } from "@/lib/tableView";

function seed(): Board {
  let b = emptyBoard();
  b = addCard(b, "banana", { id: "a", now: new Date("2024-01-01T00:00:00Z") });
  b = addCard(b, "Apple", { id: "b", now: new Date("2024-01-02T00:00:00Z") });
  b = addCard(b, "cherry", { id: "c", now: new Date("2024-01-03T00:00:00Z") });
  b = addCard(b, "date", { id: "d", now: new Date("2024-01-04T00:00:00Z") });
  b = setPriority(b, "a", "high", { now: new Date("2024-02-01T00:00:00Z") });
  b = setPriority(b, "b", "low", { now: new Date("2024-02-02T00:00:00Z") });
  b = setDueDate(b, "a", "2024-05-02", { now: new Date("2024-01-05T00:00:00Z") });
  b = setDueDate(b, "b", "2024-05-01", { now: new Date("2024-01-06T00:00:00Z") });
  b = setLabels(b, "a", ["zeta"]);
  b = setLabels(b, "b", ["Alpha", "bug"]);
  b = addChecklistItem(b, "a", "x", { id: "i1" });
  b = addChecklistItem(b, "a", "y", { id: "i2" });
  b = toggleChecklistItem(b, "a", "i1");
  b = addChecklistItem(b, "b", "z", { id: "i3" });
  b = moveCard(b, "c", "doing", { now: new Date("2024-03-01T00:00:00Z") });
  return b;
}

const ids = (rows: { card: { id: string } }[]) => rows.map((r) => r.card.id);
const sorted = (key: SortKey, dir: "asc" | "desc") => ids(sortRows(tableRows(seed()), key, dir));

describe("tableRows", () => {
  it("lists open cards in list order with list names and excludes archived", () => {
    let b = seed();
    expect(ids(tableRows(b))).toEqual(["a", "b", "d", "c"]);
    expect(tableRows(b).find((r) => r.card.id === "c")?.listName).toBe("Doing");
    b = archiveList(b, "doing");
    expect(ids(tableRows(b))).toEqual(["a", "b", "d"]);
  });
});

describe("lastActivityAt", () => {
  it("uses the newest activity entry, else createdAt", () => {
    const b = seed();
    const card = tableRows(b).find((r) => r.card.id === "c")!.card;
    expect(lastActivityAt(card)).toBe("2024-03-01T00:00:00.000Z");
    expect(lastActivityAt({ ...card, activity: undefined })).toBe(card.createdAt);
  });
});

describe("sortRows", () => {
  it("sorts by title case-insensitively", () => {
    expect(sorted("title", "asc")).toEqual(["b", "a", "c", "d"]);
    expect(sorted("title", "desc")).toEqual(["d", "c", "a", "b"]);
  });

  it("sorts by list order", () => {
    expect(sorted("list", "asc")).toEqual(["a", "b", "d", "c"]);
    expect(sorted("list", "desc")).toEqual(["c", "a", "b", "d"]);
  });

  it("sorts by priority low < medium < high", () => {
    // c and d tie (medium) and keep their list order d, c.
    expect(sorted("priority", "asc")).toEqual(["b", "d", "c", "a"]);
    expect(sorted("priority", "desc")).toEqual(["a", "d", "c", "b"]);
  });

  it("sorts by due date with no date always last", () => {
    expect(sorted("dueDate", "asc")).toEqual(["b", "a", "d", "c"]);
    expect(sorted("dueDate", "desc")).toEqual(["a", "b", "d", "c"]);
  });

  it("sorts by first label with unlabelled cards last", () => {
    expect(sorted("labels", "asc")).toEqual(["b", "a", "d", "c"]);
    expect(sorted("labels", "desc")).toEqual(["a", "b", "d", "c"]);
  });

  it("sorts by checklist ratio with no checklist last", () => {
    expect(sorted("checklist", "asc")).toEqual(["b", "a", "d", "c"]);
    expect(sorted("checklist", "desc")).toEqual(["a", "b", "d", "c"]);
  });

  it("sorts by last activity", () => {
    expect(sorted("activity", "desc")).toEqual(["c", "b", "a", "d"]);
    expect(sorted("activity", "asc")).toEqual(["d", "a", "b", "c"]);
  });

  it("is stable and does not mutate its input", () => {
    const rows = tableRows(seed());
    const before = ids(rows);
    const result = sortRows(rows, "dueDate", "asc");
    expect(ids(rows)).toEqual(before);
    expect(result).not.toBe(rows);
    // c and d have no due date: they keep their incoming order.
    expect(ids(result).slice(2)).toEqual(["d", "c"]);
  });
});

describe("filterRows", () => {
  it("filters by list", () => {
    expect(ids(filterRows(tableRows(seed()), { listId: "doing" }))).toEqual(["c"]);
  });

  it("filters by label case-insensitively", () => {
    expect(ids(filterRows(tableRows(seed()), { label: "ALPHA" }))).toEqual(["b"]);
  });

  it("combines filters and returns all rows without any", () => {
    const rows = tableRows(seed());
    expect(filterRows(rows, {})).toHaveLength(4);
    expect(filterRows(rows, { listId: "doing", label: "bug" })).toEqual([]);
  });
});
