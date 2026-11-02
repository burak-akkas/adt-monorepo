import { describe, expect, it } from "vitest";
import { relativeDueHint } from "@/lib/board";

describe("relativeDueHint", () => {
  const today = "2030-03-10";

  it("describes today and tomorrow", () => {
    expect(relativeDueHint("2030-03-10", today)).toBe("Due today");
    expect(relativeDueHint("2030-03-11", today)).toBe("Due tomorrow");
  });

  it("counts days ahead", () => {
    expect(relativeDueHint("2030-03-15", today)).toBe("Due in 5 days");
  });

  it("counts overdue days, singular for one", () => {
    expect(relativeDueHint("2030-03-09", today)).toBe("Overdue by 1 day");
    expect(relativeDueHint("2030-03-08", today)).toBe("Overdue by 2 days");
  });

  it("works across month and year boundaries and DST changes", () => {
    expect(relativeDueHint("2031-01-01", "2030-12-30")).toBe("Due in 2 days");
    expect(relativeDueHint("2030-03-31", "2030-03-01")).toBe("Due in 30 days");
    expect(relativeDueHint("2030-10-30", "2030-10-25")).toBe("Due in 5 days");
  });

  it("returns an empty string for empty or invalid dates", () => {
    expect(relativeDueHint("", today)).toBe("");
    expect(relativeDueHint("2030-02-30", today)).toBe("");
  });
});
