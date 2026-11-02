import { describe, expect, it } from "vitest";
import { insightsListIds } from "./insights-lists.js";

const lists = [
  { id: "a", name: "To do" },
  { id: "b", name: "DOING" },
  { id: "c", name: "Done" },
  { id: "d", name: "Review" },
];

describe("insightsListIds", () => {
  it("prefers the chosen lists", () => {
    expect(insightsListIds({ doingListId: "d", doneListId: "a" }, lists)).toEqual({ doing: "d", done: "a" });
  });

  it("falls back to the list named Doing / Done, ignoring case", () => {
    expect(insightsListIds({ doingListId: null, doneListId: null }, lists)).toEqual({ doing: "b", done: "c" });
  });

  it("falls back when the chosen id is not on the board", () => {
    expect(insightsListIds({ doingListId: "gone", doneListId: "gone" }, lists)).toEqual({ doing: "b", done: "c" });
  });

  it("returns nothing when there is neither a choice nor a matching name", () => {
    expect(insightsListIds({ doingListId: null, doneListId: null }, [{ id: "x", name: "Backlog" }])).toEqual({
      doing: undefined,
      done: undefined,
    });
  });
});
