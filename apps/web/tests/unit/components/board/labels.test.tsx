import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCard, emptyBoard, setLabels } from "@/lib/board";
import { saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { Board } from "@/components/board/Board";

const column = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}`) });

function seed() {
  let board = emptyBoard();
  board = addCard(board, "Fix crash", { id: "a" });
  board = addCard(board, "Style page", { id: "b" });
  board = addCard(board, "Plain", { id: "c" });
  board = setLabels(board, "a", ["bug"]);
  board = setLabels(board, "b", ["design"]);
  saveBoard(board);
}

describe("<Board /> labels", () => {
  beforeEach(() => {
    resetBoardStore();
    seed();
  });
  afterEach(() => vi.restoreAllMocks());

  it("filters by clicking a chip, combines with search and clears", async () => {
    const user = userEvent.setup();
    render(<Board />);
    await user.click(screen.getByRole("button", { name: 'Filter by label "bug"' }));

    const todo = column("To do");
    expect(within(todo).getByText("Fix crash")).toBeInTheDocument();
    expect(within(todo).queryByText("Style page")).not.toBeInTheDocument();
    expect(within(todo).queryByText("Plain")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Filter by label")).toHaveValue("bug");

    await user.type(screen.getByLabelText("Search cards"), "style");
    expect(within(column("To do")).getByText("No matching cards")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    await user.click(screen.getByRole("button", { name: "Clear label filter" }));
    expect(within(column("To do")).getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByLabelText("Filter by label")).toHaveValue("");
  });

  it("filters from the select, which offers the labels in use", async () => {
    const user = userEvent.setup();
    render(<Board />);
    const select = screen.getByLabelText("Filter by label");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["All labels", "bug", "design"]);
    await user.selectOptions(select, "design");
    expect(within(column("To do")).getByText("Style page")).toBeInTheDocument();
    expect(within(column("To do")).queryByText("Fix crash")).not.toBeInTheDocument();
  });

  it("lapses when no card has the label any more", async () => {
    const user = userEvent.setup();
    render(<Board />);
    await user.click(screen.getByRole("button", { name: 'Filter by label "bug"' }));
    await user.click(screen.getByRole("button", { name: "Fix crash" }));
    await user.click(screen.getByRole("button", { name: "Delete card" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete card" })).getByRole("button", { name: "Delete" }));
    expect(within(column("To do")).getByText("Style page")).toBeInTheDocument();
    expect(within(column("To do")).getByText("Plain")).toBeInTheDocument();
  });

  it("keeps summary stats on the whole board", async () => {
    const user = userEvent.setup();
    render(<Board />);
    await user.click(screen.getByRole("button", { name: 'Filter by label "bug"' }));
    expect(screen.getByRole("region", { name: "Board summary" })).toHaveTextContent("3 cards total");
  });
});
