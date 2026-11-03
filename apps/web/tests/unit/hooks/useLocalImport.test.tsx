import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalImport } from "@/hooks/useLocalImport";
import { ApiError } from "@/lib/api-client";
import { emptyBoard } from "@/lib/board";
import * as localImport from "@/lib/localImport";
import { STORAGE_KEY } from "@/lib/storage";

vi.mock("@/lib/localImport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/localImport")>()),
  importLocalBoards: vi.fn(),
}));

const importLocalBoards = vi.mocked(localImport.importLocalBoards);
const failed = [{ id: "b", name: "B", board: emptyBoard(), error: new ApiError("network", 0, "down"), transient: true }];

function seed() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ boards: [{ id: "b", name: "B", board: emptyBoard() }], currentId: "b" }));
}

beforeEach(() => {
  localStorage.clear();
  importLocalBoards.mockReset();
});

describe("useLocalImport", () => {
  it("stays idle without local boards", () => {
    const { result } = renderHook(() => useLocalImport({ email: "a@example.test" }));
    expect(result.current.state).toEqual({ phase: "idle" });
    expect(importLocalBoards).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    seed();
    renderHook(() => useLocalImport({ email: "a@example.test", enabled: false }));
    expect(importLocalBoards).not.toHaveBeenCalled();
  });

  it("runs once, also under strict mode, and reports counts and email", async () => {
    seed();
    importLocalBoards.mockResolvedValue({ status: "done", imported: 2, alreadyImported: 1, failed: [] });
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useLocalImport({ email: "a@example.test" }), { wrapper });
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    expect(importLocalBoards).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ phase: "done", imported: 2, alreadyImported: 1, failed: [], email: "a@example.test" });
  });

  it("returns to idle when there was nothing to import", async () => {
    seed();
    importLocalBoards.mockResolvedValue({ status: "nothing" });
    const { result } = renderHook(() => useLocalImport({ email: "a@example.test" }));
    await waitFor(() => expect(importLocalBoards).toHaveBeenCalled());
    await waitFor(() => expect(result.current.state).toEqual({ phase: "idle" }));
  });

  it("retry runs again and keeps counting earlier imports", async () => {
    seed();
    importLocalBoards.mockResolvedValueOnce({ status: "done", imported: 1, alreadyImported: 0, failed });
    const { result } = renderHook(() => useLocalImport({ email: "a@example.test" }));
    await waitFor(() => expect(result.current.state).toMatchObject({ phase: "done", failed }));
    importLocalBoards.mockResolvedValueOnce({ status: "done", imported: 1, alreadyImported: 0, failed: [] });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state).toMatchObject({ phase: "done", imported: 2, failed: [] }));
    expect(importLocalBoards).toHaveBeenCalledTimes(2);
  });

  it("dismiss hides the banner and leaves storage alone", async () => {
    seed();
    const before = localStorage.getItem(STORAGE_KEY);
    importLocalBoards.mockResolvedValue({ status: "done", imported: 0, alreadyImported: 0, failed });
    const { result } = renderHook(() => useLocalImport({ email: "a@example.test" }));
    await waitFor(() => expect(result.current.state.phase).toBe("done"));
    act(() => result.current.dismiss());
    expect(result.current.state).toEqual({ phase: "idle" });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });
});
