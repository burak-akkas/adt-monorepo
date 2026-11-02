import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetSummaryCollapsedStore, useSummaryCollapsed } from "@/hooks/useSummaryCollapsed";
import { SUMMARY_COLLAPSED_KEY } from "@/lib/summaryCollapsed";

describe("useSummaryCollapsed", () => {
  beforeEach(() => resetSummaryCollapsedStore());

  it("is expanded by default", () => {
    const { result } = renderHook(() => useSummaryCollapsed());
    expect(result.current[0]).toBe(false);
  });

  it("reads the stored value", () => {
    localStorage.setItem(SUMMARY_COLLAPSED_KEY, "1");
    const { result } = renderHook(() => useSummaryCollapsed());
    expect(result.current[0]).toBe(true);
  });

  it("persists when set", () => {
    const { result } = renderHook(() => useSummaryCollapsed());
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem(SUMMARY_COLLAPSED_KEY)).toBe("1");
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem(SUMMARY_COLLAPSED_KEY)).toBe("0");
  });

  it("reacts to storage events from another tab", () => {
    const { result } = renderHook(() => useSummaryCollapsed());
    expect(result.current[0]).toBe(false);
    act(() => {
      localStorage.setItem(SUMMARY_COLLAPSED_KEY, "1");
      window.dispatchEvent(new StorageEvent("storage", { key: SUMMARY_COLLAPSED_KEY }));
    });
    expect(result.current[0]).toBe(true);
  });
});
