import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardUrlSync } from "@/components/app/BoardUrlSync";

const hook = vi.hoisted(() => ({
  ready: false,
  boards: [] as { id: string; name: string }[],
  currentId: "server",
  selectBoard: vi.fn(),
}));
vi.mock("@/hooks/useBoard", () => ({ useBoards: () => hook }));

describe("<BoardUrlSync /> while boards load", () => {
  beforeEach(() => {
    hook.ready = false;
    hook.boards = [{ id: "server", name: "Loading" }];
    hook.currentId = "server";
    hook.selectBoard.mockReset();
    window.history.replaceState(null, "", "/?board=b");
  });

  it("keeps the URL and selects nothing until the boards are ready", () => {
    render(<BoardUrlSync />);
    expect(hook.selectBoard).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?board=b");
  });

  it("opens the board from the URL once ready", () => {
    const { rerender } = render(<BoardUrlSync />);
    hook.ready = true;
    hook.boards = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    hook.currentId = "a";
    rerender(<BoardUrlSync />);
    expect(hook.selectBoard).toHaveBeenCalledWith("b");
    expect(window.location.search).toBe("?board=b");
  });
});
