export interface ChartSize {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

export interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LinePoint {
  x: number;
  y: number;
}

// The y-axis top: at least 1, so an all-zero series gets a flat baseline instead of a division by zero.
export function chartMax(counts: readonly number[]): number {
  return Math.max(1, ...counts);
}

// Y coordinate of the baseline (value 0) and of the top gridline (the max).
export function chartBounds({ height, padding }: ChartSize): { top: number; bottom: number } {
  return { top: padding.top, bottom: height - padding.bottom };
}

// One bar per count, evenly spaced with a gap, drawn up from the baseline. Zero counts get a zero-height bar.
export function barRects(counts: readonly number[], size: ChartSize): BarRect[] {
  const { padding, width } = size;
  const { top, bottom } = chartBounds(size);
  const max = chartMax(counts);
  const slot = (width - padding.left - padding.right) / Math.max(1, counts.length);
  const barWidth = slot * 0.6;
  return counts.map((count, i) => {
    const height = ((bottom - top) * count) / max;
    return { x: padding.left + slot * i + (slot - barWidth) / 2, y: bottom - height, width: barWidth, height };
  });
}

// One point per count, spread from the left to the right padding edge.
export function linePoints(counts: readonly number[], size: ChartSize): LinePoint[] {
  const { padding, width } = size;
  const { top, bottom } = chartBounds(size);
  const max = chartMax(counts);
  const span = width - padding.left - padding.right;
  return counts.map((count, i) => ({
    x: counts.length > 1 ? padding.left + (span * i) / (counts.length - 1) : padding.left + span / 2,
    y: bottom - ((bottom - top) * count) / max,
  }));
}
