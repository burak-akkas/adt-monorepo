import { describe, expect, it } from "vitest";
import { loadSummaryCollapsed, saveSummaryCollapsed, SUMMARY_COLLAPSED_KEY } from "@/lib/summaryCollapsed";

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

describe("loadSummaryCollapsed", () => {
  it("defaults to expanded when nothing is stored", () => {
    expect(loadSummaryCollapsed(fakeStorage())).toBe(false);
  });

  it("reads 1 as collapsed and 0 as expanded", () => {
    expect(loadSummaryCollapsed(fakeStorage({ [SUMMARY_COLLAPSED_KEY]: "1" }))).toBe(true);
    expect(loadSummaryCollapsed(fakeStorage({ [SUMMARY_COLLAPSED_KEY]: "0" }))).toBe(false);
  });

  it("reads corrupt values as expanded", () => {
    for (const value of ["yes", "", "{"]) {
      expect(loadSummaryCollapsed(fakeStorage({ [SUMMARY_COLLAPSED_KEY]: value }))).toBe(false);
    }
  });

  it("reads as expanded when storage throws or is unavailable", () => {
    expect(loadSummaryCollapsed(throwing)).toBe(false);
    expect(loadSummaryCollapsed(null)).toBe(false);
  });

  it("round-trips both values", () => {
    for (const value of [true, false]) {
      const storage = fakeStorage();
      saveSummaryCollapsed(value, storage);
      expect(loadSummaryCollapsed(storage)).toBe(value);
    }
  });
});

describe("saveSummaryCollapsed", () => {
  it("does not throw when storage throws", () => {
    expect(() => saveSummaryCollapsed(true, throwing)).not.toThrow();
  });
});
