import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCard, emptyBoard, listCards, updateCard } from "@/lib/board";
import { saveAsTemplate } from "@/lib/templates";
import { saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { Board } from "@/components/board/Board";

function boardWithTemplate() {
  let board = addCard(emptyBoard(), "Release", { id: "c1" });
  board = updateCard(board, "c1", {
    title: "Release",
    notes: undefined,
    dueDate: undefined,
    column: "todo",
    labels: ["ops"],
    priority: "high",
  });
  return saveAsTemplate(board, "c1", "Release checklist", { id: "t1" });
}

describe("<Board /> templates", () => {
  beforeEach(() => resetBoardStore());
  afterEach(() => vi.restoreAllMocks());

  it("hides the template selects until a template exists", () => {
    saveBoard(emptyBoard());
    render(<Board />);
    expect(screen.queryByLabelText("From template")).not.toBeInTheDocument();
  });

  it("adds a plain card to the chosen list without templates", async () => {
    saveBoard(emptyBoard());
    render(<Board />);
    const user = userEvent.setup();
    expect(screen.getByLabelText("Target list")).toHaveValue("todo");
    await user.type(screen.getByLabelText("New card title"), "Plain");
    await user.selectOptions(screen.getByLabelText("Target list"), "Doing");
    await user.click(screen.getByRole("button", { name: "Add card" }));
    const doing = screen.getByRole("region", { name: /^Doing/ });
    expect(within(doing).getByRole("button", { name: "Plain" })).toBeInTheDocument();
    const todo = screen.getByRole("region", { name: /^To do/ });
    expect(within(todo).queryByRole("button", { name: "Plain" })).not.toBeInTheDocument();
  });

  it("saves a card as a template from the card dialog", async () => {
    saveBoard(addCard(emptyBoard(), "Plan trip", { id: "c1" }));
    render(<Board />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Plan trip" }));
    const dialog = screen.getByRole("dialog", { name: "Plan trip" });
    await user.click(within(dialog).getByRole("button", { name: "Save as template" }));
    expect(within(dialog).getByRole("status")).toHaveTextContent('Saved template "Plan trip"');
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("From template")).toBeInTheDocument();
  });

  it("adds a card from a template to the chosen list", async () => {
    saveBoard(boardWithTemplate());
    render(<Board />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("From template"), "Release checklist");
    expect(screen.getByLabelText("New card title")).toHaveValue("Release");
    await user.selectOptions(screen.getByLabelText("Target list"), "Doing");
    await user.click(screen.getByRole("button", { name: "Add card" }));
    const doing = screen.getByRole("region", { name: /^Doing/ });
    expect(within(doing).getByRole("button", { name: "Release" })).toBeInTheDocument();
    expect(within(doing).getByText("ops")).toBeInTheDocument();
    expect(screen.getByLabelText("New card title")).toHaveValue("");
    expect(screen.getByLabelText("From template")).toHaveValue("");
  });

  it("uses an edited title when adding from a template", async () => {
    saveBoard(boardWithTemplate());
    render(<Board />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("From template"), "Release checklist");
    await user.type(screen.getByLabelText("New card title"), " v2");
    await user.click(screen.getByRole("button", { name: "Add card" }));
    expect(screen.getAllByRole("button", { name: "Release v2" })).toHaveLength(1);
  });

  it("renames a template, rejects invalid names and deletes it", async () => {
    saveBoard(boardWithTemplate());
    render(<Board />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Templates" }));
    const dialog = screen.getByRole("dialog", { name: "Templates" });
    const input = within(dialog).getByLabelText('Name of template "Release checklist"');

    await user.clear(input);
    await user.click(within(dialog).getByRole("button", { name: 'Rename template "Release checklist"' }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("must not be empty");

    await user.type(input, "Ship it{Enter}");
    expect(within(dialog).getByLabelText('Name of template "Ship it"')).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: 'Delete template "Ship it"' }));
    const confirm = screen.getByRole("dialog", { name: "Delete template" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(within(dialog).getByLabelText('Name of template "Ship it"')).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: 'Delete template "Ship it"' }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete template" })).getByRole("button", { name: "Delete" }));
    expect(within(dialog).getByText(/No templates yet/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByLabelText("From template")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Templates" })).toHaveFocus());
  });

  it("keeps templates off the board", () => {
    saveBoard(boardWithTemplate());
    render(<Board />);
    const todo = screen.getByRole("region", { name: /^To do/ });
    expect(listCards(boardWithTemplate(), "todo")).toHaveLength(1);
    expect(within(todo).getAllByRole("button", { name: "Release" })).toHaveLength(1);
  });
});
