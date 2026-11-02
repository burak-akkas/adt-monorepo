import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "@/lib/time";

const now = new Date("2026-06-15T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

describe("formatRelativeTime", () => {
  it("says just now for the last seconds", () => {
    expect(formatRelativeTime(ago(0), now)).toBe("just now");
    expect(formatRelativeTime(ago(30 * S), now)).toBe("just now");
  });

  it("uses minutes, hours, days, months and years", () => {
    expect(formatRelativeTime(ago(5 * M), now)).toBe("5 minutes ago");
    expect(formatRelativeTime(ago(3 * H), now)).toBe("3 hours ago");
    expect(formatRelativeTime(ago(D), now)).toBe("yesterday");
    expect(formatRelativeTime(ago(4 * D), now)).toBe("4 days ago");
    expect(formatRelativeTime(ago(65 * D), now)).toBe("2 months ago");
    expect(formatRelativeTime(ago(800 * D), now)).toBe("2 years ago");
  });

  it("handles future times and invalid input", () => {
    expect(formatRelativeTime(new Date(now.getTime() + 2 * H).toISOString(), now)).toBe("in 2 hours");
    expect(formatRelativeTime("nope", now)).toBe("");
  });
});
