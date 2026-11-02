import { MAX_ACTIVITY_ENTRIES } from "@adt/contracts";
import { cardDetails, toArchivedCard, toCard, type CardWithDetails } from "./card.mapper.js";

const base: CardWithDetails = {
  id: "c1",
  listId: "l1",
  title: "Title",
  priority: "medium",
  cover: null,
  dueDate: null,
  notes: null,
  position: 0,
  boardId: null,
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  checklist: [],
  comments: [],
  labels: [],
  activity: [],
};

describe("toCard", () => {
  it("maps empty detail arrays", () => {
    expect(toCard(base)).toMatchObject({ checklist: [], comments: [], labels: [], activity: [] });
  });

  it("maps checklist items with their done state", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    const card = toCard({
      ...base,
      checklist: [
        { id: "i1", cardId: "c1", text: "a", done: true, position: 0, createdAt: at },
        { id: "i2", cardId: "c1", text: "b", done: false, position: 1, createdAt: at },
      ],
    });
    expect(card.checklist).toEqual([
      { id: "i1", text: "a", done: true, position: 0 },
      { id: "i2", text: "b", done: false, position: 1 },
    ]);
  });

  it("maps comments with editedAt null or set", () => {
    const created = new Date("2026-02-01T10:00:00.000Z");
    const edited = new Date("2026-02-02T10:00:00.000Z");
    const card = toCard({
      ...base,
      comments: [
        { id: "m1", cardId: "c1", text: "x", createdAt: created, editedAt: null },
        { id: "m2", cardId: "c1", text: "y", createdAt: created, editedAt: edited },
      ],
    });
    expect(card.comments).toEqual([
      { id: "m1", text: "x", createdAt: created.toISOString(), editedAt: null },
      { id: "m2", text: "y", createdAt: created.toISOString(), editedAt: edited.toISOString() },
    ]);
  });

  it("maps labels to their names, in order", () => {
    const at = new Date();
    const card = toCard({
      ...base,
      labels: [
        { id: "a", cardId: "c1", name: "Urgent", position: 0, createdAt: at },
        { id: "b", cardId: "c1", name: "bug", position: 1, createdAt: at },
      ],
    });
    expect(card.labels).toEqual(["Urgent", "bug"]);
  });

  it("maps activity entries and omits empty from/to", () => {
    const at = new Date("2026-03-01T00:00:00.000Z");
    const card = toCard({
      ...base,
      activity: [
        { id: "a1", cardId: "c1", type: "moved", at, from: "l1", to: "l2" },
        { id: "a2", cardId: "c1", type: "created", at, from: null, to: null },
      ],
    });
    expect(card.activity).toEqual([
      { id: "a1", at: at.toISOString(), type: "moved", from: "l1", to: "l2" },
      { id: "a2", at: at.toISOString(), type: "created" },
    ]);
    expect(card.activity[1]).not.toHaveProperty("from");
  });
});

describe("toArchivedCard", () => {
  const archivedAt = new Date("2026-04-01T00:00:00.000Z");

  it("maps an archived card without list or position", () => {
    const card = toArchivedCard({ ...base, listId: null, boardId: "b1", archivedAt });
    expect(card).toMatchObject({ id: "c1", boardId: "b1", archivedAt: archivedAt.toISOString(), title: "Title" });
    expect(card).not.toHaveProperty("listId");
    expect(card).not.toHaveProperty("position");
  });

  it("refuses a live card, and toCard refuses an archived one", () => {
    expect(() => toArchivedCard(base)).toThrow();
    expect(() => toCard({ ...base, listId: null, boardId: "b1", archivedAt })).toThrow();
  });
});

describe("cardDetails", () => {
  it("orders details and caps activity newest first", () => {
    expect(cardDetails.checklist.orderBy).toEqual({ position: "asc" });
    expect(cardDetails.comments.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
    expect(cardDetails.labels.orderBy).toEqual({ position: "asc" });
    expect(cardDetails.activity.orderBy).toEqual([{ at: "desc" }, { id: "desc" }]);
    expect(cardDetails.activity.take).toBe(MAX_ACTIVITY_ENTRIES);
  });
});
