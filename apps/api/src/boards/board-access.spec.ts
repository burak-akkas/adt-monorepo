import { boardAccessWhere, boardOwnerWhere } from "./board-access.js";

describe("board access filters", () => {
  it("lets the owner or a member (by lower-cased email) in", () => {
    expect(boardAccessWhere("user-1", "B@Example.Test")).toEqual({
      OR: [{ userId: "user-1" }, { members: { some: { email: "b@example.test" } } }],
    });
  });

  it("limits the owner filter to the owner", () => {
    expect(boardOwnerWhere("user-1")).toEqual({ userId: "user-1" });
  });
});
