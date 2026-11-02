import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetCommentOrderStore, useCommentOrder } from "@/hooks/useCommentOrder";
import { COMMENT_ORDER_KEY } from "@/lib/commentOrder";

describe("useCommentOrder", () => {
  beforeEach(() => {
    localStorage.clear();
    resetCommentOrderStore();
  });

  it("is oldest by default", () => {
    const { result } = renderHook(() => useCommentOrder());
    expect(result.current[0]).toBe("oldest");
  });

  it("reads the stored value", () => {
    localStorage.setItem(COMMENT_ORDER_KEY, "newest");
    const { result } = renderHook(() => useCommentOrder());
    expect(result.current[0]).toBe("newest");
  });

  it("persists when set and shares the value across components", () => {
    const first = renderHook(() => useCommentOrder());
    const second = renderHook(() => useCommentOrder());
    act(() => first.result.current[1]("newest"));
    expect(first.result.current[0]).toBe("newest");
    expect(second.result.current[0]).toBe("newest");
    expect(localStorage.getItem(COMMENT_ORDER_KEY)).toBe("newest");
    act(() => first.result.current[1]("oldest"));
    expect(second.result.current[0]).toBe("oldest");
    expect(localStorage.getItem(COMMENT_ORDER_KEY)).toBe("oldest");
  });

  it("reacts to storage events from another tab", () => {
    const { result } = renderHook(() => useCommentOrder());
    act(() => {
      localStorage.setItem(COMMENT_ORDER_KEY, "newest");
      window.dispatchEvent(new StorageEvent("storage", { key: COMMENT_ORDER_KEY }));
    });
    expect(result.current[0]).toBe("newest");
  });
});
