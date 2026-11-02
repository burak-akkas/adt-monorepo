import { describe, expect, it } from "vitest";
import { barRects, chartMax, linePoints } from "@/lib/chart";
import type { ChartSize } from "@/lib/chart";

const SIZE: ChartSize = { width: 300, height: 120, padding: { top: 10, right: 10, bottom: 20, left: 20 } };

describe("chartMax", () => {
  it("is at least 1", () => {
    expect(chartMax([0, 0])).toBe(1);
    expect(chartMax([])).toBe(1);
  });

  it("is the largest count", () => {
    expect(chartMax([1, 5, 3])).toBe(5);
  });
});

describe("barRects", () => {
  it("returns one zero-height bar on the baseline per count for all zeros", () => {
    const bars = barRects([0, 0, 0], SIZE);
    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      expect(bar.height).toBe(0);
      expect(bar.y).toBe(100);
    }
  });

  it("fills the full plot height for the max and scales the rest", () => {
    const [low, high] = barRects([1, 2], SIZE);
    expect(high.height).toBe(90);
    expect(high.y).toBe(10);
    expect(low.height).toBe(45);
  });

  it("keeps a single non-zero value at full height", () => {
    const bars = barRects([0, 0, 4], SIZE);
    expect(bars.map((b) => b.height)).toEqual([0, 0, 90]);
  });

  it("stays inside the viewBox", () => {
    for (const bar of barRects([3, 0, 7, 1, 2, 0, 0, 5], SIZE)) {
      expect(bar.x).toBeGreaterThanOrEqual(SIZE.padding.left);
      expect(bar.x + bar.width).toBeLessThanOrEqual(SIZE.width - SIZE.padding.right);
      expect(bar.y).toBeGreaterThanOrEqual(SIZE.padding.top);
      expect(bar.y + bar.height).toBeLessThanOrEqual(SIZE.height - SIZE.padding.bottom);
    }
  });
});

describe("linePoints", () => {
  it("returns one point per count, left to right", () => {
    const points = linePoints(Array.from({ length: 14 }, (_, i) => i), SIZE);
    expect(points).toHaveLength(14);
    expect(points[0].x).toBe(20);
    expect(points[13].x).toBe(290);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].x).toBeGreaterThan(points[i - 1].x);
    }
  });

  it("puts zeros on the baseline and the max on the top", () => {
    expect(linePoints([0, 0], SIZE).map((p) => p.y)).toEqual([100, 100]);
    expect(linePoints([0, 3], SIZE).map((p) => p.y)).toEqual([100, 10]);
  });

  it("centres a single point", () => {
    expect(linePoints([2], SIZE)[0].x).toBe(155);
  });

  it("stays inside the viewBox", () => {
    for (const p of linePoints([4, 0, 2, 9, 1], SIZE)) {
      expect(p.x).toBeGreaterThanOrEqual(SIZE.padding.left);
      expect(p.x).toBeLessThanOrEqual(SIZE.width - SIZE.padding.right);
      expect(p.y).toBeGreaterThanOrEqual(SIZE.padding.top);
      expect(p.y).toBeLessThanOrEqual(SIZE.height - SIZE.padding.bottom);
    }
  });
});
