import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { addCard, emptyBoard, moveCard } from "@/lib/board";
import { saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { Board } from "@/components/board/Board";

function seed(titles: string[], doing = 0) {
  let board = emptyBoard();
  titles.forEach((title, i) => {
    board = addCard(board, title, { id: `c${i}` });
    if (i < doing) {
      board = moveCard(board, `c${i}`, "doing");
    }
  });
  saveBoard(board);
}

describe("list card count in <Board />", () => {
  beforeEach(() => resetBoardStore());

  it("shows 0 for an empty list and the real count for others", () => {
    seed(["A", "B", "C"], 1);
    render(<Board />);
    expect(screen.getByRole("heading", { name: "To do2" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Doing1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Done0" })).toBeInTheDocument();
  });

  it("updates when a card is added", async () => {
    const user = userEvent.setup();
    seed(["A"]);
    render(<Board />);
    await user.type(screen.getByLabelText("New card title"), "B");
    await user.click(screen.getByRole("button", { name: "Add card" }));
    expect(screen.getByRole("heading", { name: "To do2" })).toBeInTheDocument();
  });

  it("updates in both lists when a card is moved", async () => {
    const user = userEvent.setup();
    seed(["A", "B"]);
    render(<Board />);
    await user.click(screen.getByRole("button", { name: "B" }));
    await user.selectOptions(within(screen.getByRole("dialog")).getByLabelText("Status"), "Doing");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    expect(screen.getByRole("heading", { name: "To do1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Doing1" })).toBeInTheDocument();
  });

  it("drops archived cards from the count and restores them on undo", async () => {
    const user = userEvent.setup();
    seed(["A", "B"], 2);
    render(<Board />);
    await user.click(screen.getByRole("button", { name: "Archive all cards in Doing" }));
    expect(screen.getByRole("heading", { name: "Doing0" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("heading", { name: "Doing2" })).toBeInTheDocument();
  });

  it("is not reduced by an active search", async () => {
    const user = userEvent.setup();
    seed(["Alpha", "Beta", "Gamma"]);
    render(<Board />);
    await user.type(screen.getByLabelText("Search cards"), "Alpha");
    expect(screen.getByRole("heading", { name: "To do3" })).toBeInTheDocument();
  });
});
