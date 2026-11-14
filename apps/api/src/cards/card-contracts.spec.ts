import { activityEntrySchema, addAssigneeRequestSchema, cardResponseSchema } from "@adt/contracts";

const card = {
  id: "c1",
  listId: "l1",
  title: "Title",
  priority: "medium",
  cover: null,
  dueDate: null,
  notes: null,
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  checklist: [],
  comments: [],
  labels: [],
  activity: [],
};

describe("cardResponseSchema assignees", () => {
  it("defaults to an empty array when missing", () => {
    expect(cardResponseSchema.parse(card).assignees).toEqual([]);
  });

  it("keeps the emails it is given", () => {
    expect(cardResponseSchema.parse({ ...card, assignees: ["a@example.test", "b@example.test"] }).assignees).toEqual([
      "a@example.test",
      "b@example.test",
    ]);
  });
});

describe("activityEntrySchema", () => {
  it.each(["assigned", "unassigned"])("accepts %s entries", (type) => {
    const entry = { id: "e1", at: "2026-01-01T00:00:00.000Z", type, to: "a@example.test" };
    expect(activityEntrySchema.parse(entry)).toEqual(entry);
  });
});

describe("addAssigneeRequestSchema", () => {
  it("trims and lower-cases the email", () => {
    expect(addAssigneeRequestSchema.parse({ email: "  A@Example.Test " })).toEqual({ email: "a@example.test" });
  });

  it("rejects an invalid or empty email", () => {
    expect(addAssigneeRequestSchema.safeParse({ email: "nope" }).success).toBe(false);
    expect(addAssigneeRequestSchema.safeParse({ email: "" }).success).toBe(false);
    expect(addAssigneeRequestSchema.safeParse({}).success).toBe(false);
  });
});
