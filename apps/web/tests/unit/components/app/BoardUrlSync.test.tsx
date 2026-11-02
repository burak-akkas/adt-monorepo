import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardSwitcher } from "@/components/app/BoardSwitcher";
import { BoardUrlSync } from "@/components/app/BoardUrlSync";
import { createBoardEntry, initialBoardList } from "@/lib/boards";
import { saveBoards } from "@/lib/storage";
import { resetBoardStore } from "@/hooks/useBoard";

const select = () => screen.getByRole("combobox", { name: "Board" });
const selectedName = () => (select() as HTMLSelectElement).selectedOptions[0]?.textContent;
const param = () => new URLSearchParams(window.location.search).get("board");

// Boards "a" (My board) and "b" (Work); `current` is the remembered one.
function seed(current: "a" | "b") {
  const list = createBoardEntry(initialBoardList("a"), "Work", "b");
  saveBoards({ ...list, currentId: current });
  resetBoardStore();
}

function setup() {
  const user = userEvent.setup();
  render(
    <>
      <BoardSwitcher />
      <BoardUrlSync />
    </>,
  );
  return { user };
}

describe("<BoardUrlSync />", () => {
  beforeEach(() => {
    localStorage.clear();
    resetBoardStore();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the board named in the URL", () => {
    seed("a");
    window.history.replaceState(null, "", "/?board=b");
    setup();
    expect(selectedName()).toBe("Work");
    expect(param()).toBe("b");
  });

  it("falls back to the first board for an unknown id", () => {
    seed("b");
    window.history.replaceState(null, "", "/?board=nope");
    setup();
    expect(selectedName()).toBe("My board");
    expect(param()).toBe("a");
  });

  it("opens the remembered board without a param, without adding a history entry", () => {
    seed("b");
    const before = window.history.length;
    setup();
    expect(selectedName()).toBe("Work");
    expect(param()).toBe("b");
    expect(window.history.length).toBe(before);
  });

  it("never writes the placeholder server id to the URL", () => {
    seed("b");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    setup();
    const urls = [...push.mock.calls, ...replace.mock.calls].map((call) => String(call[2]));
    expect(urls).not.toContain("?board=server");
    expect(push).not.toHaveBeenCalled();
  });

  it("pushes a history entry when a board is selected", async () => {
    seed("a");
    const { user } = setup();
    const before = window.history.length;
    await user.selectOptions(select(), "Work");
    expect(param()).toBe("b");
    expect(window.history.length).toBe(before + 1);
  });

  it("puts a new board in the URL, and the next current board after a delete", async () => {
    seed("a");
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Board actions" }));
    await user.click(screen.getByRole("menuitem", { name: "New board" }));
    await user.type(screen.getByLabelText("Board name"), "Third");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(selectedName()).toBe("Third");
    expect(param()).toBe((select() as HTMLSelectElement).value);
    expect(param()).not.toMatch(/^[ab]$/);

    await user.click(screen.getByRole("button", { name: "Board actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete board" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(selectedName()).toBe("My board");
    expect(param()).toBe("a");
  });

  it("switches board on popstate without pushing a new entry", async () => {
    seed("a");
    const { user } = setup();
    await user.selectOptions(select(), "Work");
    const push = vi.spyOn(window.history, "pushState");
    act(() => {
      window.history.replaceState(null, "", "?board=a");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(selectedName()).toBe("My board");
    expect(push).not.toHaveBeenCalled();
  });

  it("resolves an unknown id on popstate", async () => {
    seed("a");
    const { user } = setup();
    await user.selectOptions(select(), "Work");
    act(() => {
      window.history.replaceState(null, "", "?board=gone");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(selectedName()).toBe("My board");
    expect(param()).toBe("a");
  });
});
