import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { addCard, emptyBoard, setDueDate } from "@/lib/board";
import { saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { Board } from "@/components/board/Board";

function seed() {
  let board = addCard(emptyBoard(), "Late card", { id: "late" });
  board = setDueDate(board, "late", "2000-01-01");
  saveBoard(board);
}

describe("<Board /> insights", () => {
  beforeEach(() => resetBoardStore());

  it("opens a dialog and closes with Escape, returning focus to the opener", async () => {
    seed();
    const user = userEvent.setup();
    render(<Board />);
    const opener = screen.getByRole("button", { name: "Board insights" });
    await user.click(opener);
    expect(screen.getByRole("dialog", { name: "Board insights" })).toBeInTheDocument();
    // jsdom does not turn Escape into the dialog's `cancel` event, so dispatch it directly.
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("closes with the Close button and returns focus", async () => {
    seed();
    const user = userEvent.setup();
    render(<Board />);
    const opener = screen.getByRole("button", { name: "Board insights" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("shows the current board's overdue cards and opens the card details", async () => {
    seed();
    const user = userEvent.setup();
    render(<Board />);
    await user.click(screen.getByRole("button", { name: "Board insights" }));
    await user.click(screen.getByRole("button", { name: /^Open "Late card" \(due / }));
    expect(screen.queryByRole("dialog", { name: "Board insights" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Late card" })).toBeInTheDocument();
  });

  it("shows empty states for a board without data", async () => {
    saveBoard(emptyBoard());
    const user = userEvent.setup();
    render(<Board />);
    await user.click(screen.getByRole("button", { name: "Board insights" }));
    expect(screen.getByText("No overdue cards")).toBeInTheDocument();
  });
});
