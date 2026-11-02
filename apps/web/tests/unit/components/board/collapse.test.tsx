import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { addCard, emptyBoard, moveCard, setWipLimit, toggleListCollapsed } from "@/lib/board";
import { saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { Board } from "@/components/board/Board";

function seed(collapsed = false) {
  let board = addCard(addCard(emptyBoard(), "A", { id: "a" }), "B", { id: "b" });
  board = moveCard(board, "b", "done");
  saveBoard(collapsed ? toggleListCollapsed(board, "done") : board);
}

describe("collapsing lists in <Board />", () => {
  beforeEach(() => resetBoardStore());

  it("every list has a Collapse button that is expanded", () => {
    seed();
    render(<Board />);
    for (const name of ["To do", "Doing", "Done"]) {
      expect(screen.getByRole("button", { name: `Collapse ${name}`, expanded: true })).toBeInTheDocument();
    }
  });

  it("collapses with the keyboard to a strip with name and count, and expands again", async () => {
    const user = userEvent.setup();
    seed();
    render(<Board />);

    screen.getByRole("button", { name: "Collapse Done" }).focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByRole("button", { name: "Expand Done", expanded: false })).toHaveFocus());
    expect(screen.getByRole("heading", { name: "Done1" })).toBeInTheDocument();
    expect(screen.queryByText("B")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive done cards in Done" })).not.toBeInTheDocument();

    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Collapse Done", expanded: true })).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive done cards in Done" })).toBeInTheDocument();
  });

  it("loads boards with collapsed lists and keeps the real count under a filter", async () => {
    const user = userEvent.setup();
    seed(true);
    render(<Board />);
    expect(screen.getByRole("button", { name: "Expand Done" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Search cards" }), "zzz");
    expect(screen.getByRole("heading", { name: "Done1" })).toBeInTheDocument();
  });

  it("returns focus to the toggle after collapsing and expanding", async () => {
    const user = userEvent.setup();
    seed();
    render(<Board />);

    await user.click(screen.getByRole("button", { name: "Collapse Done" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Expand Done" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Expand Done" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Collapse Done" })).toHaveFocus());
  });

  it("collapsing keeps the saved WIP limit", async () => {
    const user = userEvent.setup();
    saveBoard(setWipLimit(emptyBoard(), "done", 3));
    render(<Board />);

    await user.click(screen.getByRole("button", { name: "Collapse Done" }));
    expect(screen.getByRole("heading", { name: "Done0 / 3" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand Done" }));
    expect(screen.getByRole("heading", { name: "Done0 / 3" })).toBeInTheDocument();
  });

  it("counts a card moved into a collapsed list and shows it when expanded", async () => {
    const user = userEvent.setup();
    seed();
    render(<Board />);
    await user.click(screen.getByRole("button", { name: "Collapse Doing" }));
    await user.click(screen.getByRole("button", { name: "A" }));
    await user.selectOptions(within(screen.getByRole("dialog")).getByLabelText("Status"), "Doing");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    expect(screen.getByRole("heading", { name: "Doing1" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand Doing" }));
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});
