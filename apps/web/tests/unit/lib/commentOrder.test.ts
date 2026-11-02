import { describe, expect, it } from "vitest";
import { COMMENT_ORDER_KEY, loadCommentOrder, saveCommentOrder } from "@/lib/commentOrder";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("loadCommentOrder", () => {
  it("defaults to oldest when nothing is stored", () => {
    expect(loadCommentOrder(fakeStorage())).toBe("oldest");
  });

  it("reads newest and oldest", () => {
    expect(loadCommentOrder(fakeStorage({ [COMMENT_ORDER_KEY]: "newest" }))).toBe("newest");
    expect(loadCommentOrder(fakeStorage({ [COMMENT_ORDER_KEY]: "oldest" }))).toBe("oldest");
  });

  it("reads invalid values as oldest", () => {
    for (const value of ["1", "", "{", "NEWEST"]) {
      expect(loadCommentOrder(fakeStorage({ [COMMENT_ORDER_KEY]: value }))).toBe("oldest");
    }
  });

  it("reads as oldest when storage throws or is unavailable", () => {
    expect(loadCommentOrder(throwing)).toBe("oldest");
    expect(loadCommentOrder(null)).toBe("oldest");
  });

  it("round-trips both values", () => {
    for (const value of ["newest", "oldest"] as const) {
      const storage = fakeStorage();
      saveCommentOrder(value, storage);
      expect(loadCommentOrder(storage)).toBe(value);
    }
  });
});

describe("saveCommentOrder", () => {
  it("does not throw when storage throws", () => {
    expect(() => saveCommentOrder("newest", throwing)).not.toThrow();
  });
});
