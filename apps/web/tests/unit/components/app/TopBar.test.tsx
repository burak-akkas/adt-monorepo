import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyBoard } from "@/lib/board";
import { saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { Board } from "@/components/board/Board";
import { TopBar } from "@/components/app/TopBar";

beforeEach(() => {
  localStorage.clear();
  resetBoardStore();
  saveBoard(emptyBoard());
});

describe("TopBar", () => {
  it("is a banner with the title, board selector and the two icon buttons in order", () => {
    render(<TopBar />);
    const banner = screen.getByRole("banner");
    const title = within(banner).getByRole("heading", { level: 1, name: "Kanban" });
    const select = within(banner).getByRole("combobox", { name: "Board" });
    const shortcuts = within(banner).getByRole("button", { name: "Keyboard shortcuts" });
    const settings = within(banner).getByRole("button", { name: "Settings" });
    const follows = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(title, select)).toBe(true);
    expect(follows(select, shortcuts)).toBe(true);
    expect(follows(shortcuts, settings)).toBe(true);
  });

  it("gives both icon buttons a title", () => {
    render(<TopBar />);
    expect(screen.getByRole("button", { name: "Keyboard shortcuts" })).toHaveAttribute("title", "Keyboard shortcuts");
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute("title", "Settings");
  });

  it("opens Settings from the icon and returns focus to it on close", async () => {
    const user = userEvent.setup();
    render(<TopBar />);
    const button = screen.getByRole("button", { name: "Settings" });
    await user.click(button);
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("opens the shortcuts dialog from the icon and with ?", async () => {
    const user = userEvent.setup();
    render(<TopBar />);
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Keyboard shortcuts" })).toHaveFocus());
    await user.keyboard("?");
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });

  it("no longer leaves a Settings button in the board toolbar", () => {
    render(<Board />);
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
  });
});
