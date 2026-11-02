import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCard, addList, emptyBoard, moveCard, setInsightsList } from "@/lib/board";
import { saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { Board } from "@/components/board/Board";
import { TopBar } from "@/components/app/TopBar";

// Column titles in board order (without the card count badge).
const headings = () =>
  Array.from(document.querySelectorAll('h2[id^="column-"]')).map((h) => h.firstChild?.textContent?.trim());

async function openManager() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Manage lists" }));
  return { user, dialog: screen.getByRole("dialog", { name: "Manage lists" }) };
}

describe("<Board /> custom lists", () => {
  beforeEach(() => resetBoardStore());
  afterEach(() => vi.restoreAllMocks());

  it("adds a list", async () => {
    saveBoard(emptyBoard());
    render(<Board />);
    const { user, dialog } = await openManager();
    await user.type(within(dialog).getByLabelText("New list name"), "Review");
    await user.click(within(dialog).getByRole("button", { name: "Add list" }));
    expect(headings()).toContain("Review");
    expect(within(dialog).getByLabelText("New list name")).toHaveValue("");
  });

  it("shows an error for an empty, duplicate or too long name and saves nothing", async () => {
    saveBoard(emptyBoard());
    render(<Board />);
    const { user, dialog } = await openManager();
    const input = within(dialog).getByLabelText("New list name");
    await user.click(within(dialog).getByRole("button", { name: "Add list" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("must not be empty");
    await user.type(input, "doing");
    await user.click(within(dialog).getByRole("button", { name: "Add list" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("already exists");
    await user.clear(input);
    await user.type(input, "x".repeat(40));
    await user.click(within(dialog).getByRole("button", { name: "Add list" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("at most 30");
    expect(headings()).toEqual(["To do", "Doing", "Done"]);
  });

  it("renames a list and shows the new name in the move buttons", async () => {
    saveBoard(addCard(emptyBoard(), "Task", { id: "t" }));
    render(<Board />);
    const { user, dialog } = await openManager();
    const input = within(dialog).getByLabelText('Name of list "To do"');
    await user.clear(input);
    await user.type(input, "Backlog");
    await user.click(within(dialog).getByRole("button", { name: 'Rename list "To do"' }));
    expect(headings()[0]).toBe("Backlog");
    expect(within(dialog).getByLabelText('Name of list "Backlog"')).toBeInTheDocument();
  });

  it("rejects a rename to an existing name", async () => {
    saveBoard(emptyBoard());
    render(<Board />);
    const { user, dialog } = await openManager();
    const input = within(dialog).getByLabelText('Name of list "To do"');
    await user.clear(input);
    await user.type(input, "DONE");
    await user.click(within(dialog).getByRole("button", { name: 'Rename list "To do"' }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("already exists");
    expect(headings()[0]).toBe("To do");
  });

  it("reorders lists with the keyboard-reachable buttons", async () => {
    saveBoard(emptyBoard());
    render(<Board />);
    const { user, dialog } = await openManager();
    expect(within(dialog).getByRole("button", { name: 'Move list "To do" left' })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: 'Move list "Done" right' })).toBeDisabled();
    const right = within(dialog).getByRole("button", { name: 'Move list "To do" right' });
    right.focus();
    await user.keyboard("{Enter}");
    expect(headings()).toEqual(["Doing", "To do", "Done"]);
    await user.click(within(dialog).getByRole("button", { name: 'Move list "Done" left' }));
    expect(headings()).toEqual(["Doing", "Done", "To do"]);
  });

  it("deletes an empty list after confirmation", async () => {
    saveBoard(addList(emptyBoard(), "Review", { id: "r" }));
    render(<Board />);
    const { user, dialog } = await openManager();
    await user.click(within(dialog).getByRole("button", { name: 'Delete list "Review"' }));
    const confirm = screen.getByRole("dialog", { name: "Delete list" });
    expect(within(confirm).getByText('Delete the empty list "Review"?')).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(headings()).toContain("Review");
    await user.click(within(dialog).getByRole("button", { name: 'Delete list "Review"' }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete list" })).getByRole("button", { name: "Delete" }));
    expect(headings()).not.toContain("Review");
  });

  it("moves the cards to the chosen list before deleting a list with cards", async () => {
    saveBoard(addCard(addList(emptyBoard(), "Review", { id: "r" }), "Task", { id: "t" }));
    render(<Board />);
    const { user, dialog } = await openManager();
    await user.click(within(dialog).getByRole("button", { name: 'Delete list "To do"' }));
    const group = within(dialog).getByRole("group", { name: 'Move cards out of "To do"' });
    await user.selectOptions(within(group).getByRole("combobox"), "Review");
    await user.click(within(group).getByRole("button", { name: "Move cards and delete list" }));
    expect(headings()).toEqual(["Doing", "Done", "Review"]);
    const review = screen.getByRole("region", { name: /^Review/ });
    expect(within(review).getByText("Task")).toBeInTheDocument();
  });

  it("cannot delete the last list", async () => {
    saveBoard({ ...emptyBoard(), lists: [{ id: "todo", name: "To do" }], columns: { todo: [] } });
    render(<Board />);
    const { dialog } = await openManager();
    expect(within(dialog).getByRole("button", { name: 'Delete list "To do"' })).toBeDisabled();
  });

  it("works with WIP limits, moving and archive on a custom list", async () => {
    saveBoard(moveCard(addCard(addList(emptyBoard(), "Review", { id: "r" }), "Task", { id: "t" }), "t", "r"));
    const user = userEvent.setup();
    render(
      <>
        <TopBar />
        <Board />
      </>,
    );
    const review = screen.getByRole("region", { name: /^Review/ });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.type(screen.getByLabelText("WIP limit for Review"), "1{Enter}");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(within(review).getByText("1 / 1")).toBeInTheDocument();
    await user.click(within(review).getByRole("button", { name: "Task" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Status")).toHaveValue("r");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await user.click(within(review).getByRole("button", { name: "Archive all cards in Review" }));
    expect(screen.getByRole("button", { name: "Archived (1)" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(within(screen.getByRole("region", { name: /^Review/ })).getByText("Task")).toBeInTheDocument();
  });

  it("lets insights use any list as in progress and done, chosen in Settings", async () => {
    saveBoard(addList(emptyBoard(), "Review", { id: "r" }));
    const user = userEvent.setup();
    render(
      <>
        <TopBar />
        <Board />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const settings = screen.getByRole("dialog", { name: "Settings" });
    expect(within(settings).getByLabelText("In progress list")).toHaveValue("doing");
    await user.selectOptions(within(settings).getByLabelText("In progress list"), "Review");
    await user.selectOptions(within(settings).getByLabelText("Done list"), "Not set");
    await user.click(within(settings).getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Board insights" }));
    const panel = screen.getByRole("dialog", { name: "Board insights" });
    expect(within(panel).queryByLabelText("In progress list")).not.toBeInTheDocument();
    expect(within(panel).getByRole("table", { name: "Cards in Review per day" })).toBeInTheDocument();
  });

  it("points insights to Settings when no list is chosen", async () => {
    saveBoard(setInsightsList(setInsightsList(emptyBoard(), "done", undefined), "doing", undefined));
    const user = userEvent.setup();
    render(<Board />);
    await user.click(screen.getByRole("button", { name: "Board insights" }));
    const panel = screen.getByRole("dialog", { name: "Board insights" });
    expect(within(panel).getByText("Choose the in-progress and done lists in Settings.")).toBeInTheDocument();
    expect(within(panel).queryByRole("combobox")).not.toBeInTheDocument();
  });
});
