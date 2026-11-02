import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPreferenceStore } from "@/hooks/createPreferenceStore";
import { readPreference, writePreference } from "@/lib/preference";

const KEY = "test:pref-store";

function makeStore() {
  const load = vi.fn(() => readPreference(KEY, (raw) => raw ?? "default", "default"));
  const save = vi.fn((value: string) => writePreference(KEY, value));
  const store = createPreferenceStore<string>({ key: KEY, load, save, serverValue: "server" });
  return { store, load, save };
}

describe("createPreferenceStore", () => {
  beforeEach(() => localStorage.removeItem(KEY));

  it("loads the initial value from storage", () => {
    localStorage.setItem(KEY, "stored");
    const { store } = makeStore();
    const { result } = renderHook(() => store.useValue());
    expect(result.current[0]).toBe("stored");
  });

  it("falls back to the loader default when nothing is stored", () => {
    const { store } = makeStore();
    const { result } = renderHook(() => store.useValue());
    expect(result.current[0]).toBe("default");
  });

  it("sets, saves and re-renders", () => {
    const { store, save } = makeStore();
    const { result } = renderHook(() => store.useValue());
    act(() => result.current[1]("next"));
    expect(result.current[0]).toBe("next");
    expect(save).toHaveBeenCalledWith("next");
    expect(localStorage.getItem(KEY)).toBe("next");
  });

  it("keeps two consumers in sync", () => {
    const { store } = makeStore();
    const a = renderHook(() => store.useValue());
    const b = renderHook(() => store.useValue());
    act(() => a.result.current[1]("shared"));
    expect(b.result.current[0]).toBe("shared");
  });

  it("refreshes on a storage event for its key", () => {
    const { store } = makeStore();
    const { result } = renderHook(() => store.useValue());
    act(() => {
      localStorage.setItem(KEY, "other-tab");
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    });
    expect(result.current[0]).toBe("other-tab");
  });

  it("refreshes on a storage event with a null key (clear)", () => {
    localStorage.setItem(KEY, "before");
    const { store } = makeStore();
    const { result } = renderHook(() => store.useValue());
    expect(result.current[0]).toBe("before");
    act(() => {
      localStorage.removeItem(KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(result.current[0]).toBe("default");
  });

  it("ignores storage events for other keys", () => {
    const { store, load } = makeStore();
    const { result } = renderHook(() => store.useValue());
    const calls = load.mock.calls.length;
    act(() => {
      localStorage.setItem(KEY, "changed");
      window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    });
    expect(result.current[0]).toBe("default");
    expect(load.mock.calls.length).toBe(calls);
  });

  it("does not throw when storage is blocked", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    const { store } = makeStore();
    const { result } = renderHook(() => store.useValue());
    expect(result.current[0]).toBe("default");
    act(() => result.current[1]("still-works"));
    expect(result.current[0]).toBe("still-works");
    vi.restoreAllMocks();
  });

  it("renders the server value on the server", () => {
    const { store } = makeStore();
    function Probe() {
      const [value] = store.useValue();
      return <span>{value}</span>;
    }
    expect(renderToString(<Probe />)).toContain("server");
  });

  it("reset forces a re-read from storage", () => {
    const { store } = makeStore();
    const { result } = renderHook(() => store.useValue());
    act(() => result.current[1]("cached"));
    localStorage.setItem(KEY, "from-storage");
    store.reset();
    const fresh = renderHook(() => store.useValue());
    expect(fresh.result.current[0]).toBe("from-storage");
  });
});
