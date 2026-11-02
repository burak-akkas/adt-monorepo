import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCard, addChecklistItem, emptyBoard, MAX_CHECKLIST_ITEM_LENGTH, toggleChecklistItem } from "@/lib/board";
import { saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { Board } from "@/components/board/Board";

function seed(items: string[] = []) {
  let board = addCard(emptyBoard(), "Plain", { id: "p" });
  board = addCard(board, "Task", { id: "t" });
  items.forEach((text, i) => {
    board = addChecklistItem(board, "t", text, { id: `i${i}` });
  });
  saveBoard(board);
}

async function openTask(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Task" }));
  return screen.getByRole("dialog", { name: "Task" });
}

describe("<Board /> checklist", () => {
  beforeEach(() => resetBoardStore());

  it("adds, ticks, edits, reorders and deletes items in the dialog", async () => {
    seed();
    const user = userEvent.setup();
    render(<Board />);
    const dialog = await openTask(user);

    const input = within(dialog).getByLabelText("New checklist item");
    expect(input).toHaveAttribute("maxlength", String(MAX_CHECKLIST_ITEM_LENGTH));
    await user.type(input, "  First{Enter}");
    await user.type(input, "Second");
    await user.click(within(dialog).getByRole("button", { name: "Add item" }));
    // Enter added the item without submitting (closing) the dialog.
    expect(screen.getByRole("dialog", { name: "Task" })).toBeInTheDocument();
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(2);

    await user.click(within(dialog).getByRole("checkbox", { name: "First" }));
    expect(within(dialog).getByRole("checkbox", { name: "First" })).toBeChecked();

    expect(within(dialog).getByRole("button", { name: 'Move up "First"' })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: 'Move down "Second"' })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: 'Move down "First"' }));
    expect(within(dialog).getAllByRole("checkbox").map((c) => (c as HTMLInputElement).checked)).toEqual([false, true]);

    await user.click(within(dialog).getByRole("button", { name: 'Edit checklist item "Second"' }));
    const edit = within(dialog).getByLabelText('Edit checklist item "Second"');
    await user.clear(edit);
    await user.type(edit, "Renamed{Enter}");
    expect(within(dialog).getByRole("checkbox", { name: "Renamed" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: 'Delete checklist item "Renamed"' }));
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(1);
  });

  it("Uncheck all is disabled until an item is ticked, then unticks everything", async () => {
    seed(["a", "b"]);
    const user = userEvent.setup();
    render(<Board />);
    const dialog = await openTask(user);
    const button = within(dialog).getByRole("button", { name: "Uncheck all" });
    expect(button).toBeDisabled();

    await user.click(within(dialog).getByRole("checkbox", { name: "a" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "b" }));
    expect(button).toBeEnabled();

    await user.click(button);
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(2);
    for (const box of within(dialog).getAllByRole("checkbox")) {
      expect(box).not.toBeChecked();
    }
    expect(button).toBeDisabled();
  });

  it("Uncheck all works from the keyboard and is disabled for an empty checklist", async () => {
    seed(["a"]);
    const user = userEvent.setup();
    render(<Board />);
    const dialog = await openTask(user);
    await user.click(within(dialog).getByRole("checkbox", { name: "a" }));
    within(dialog).getByRole("button", { name: "Uncheck all" }).focus();
    await user.keyboard("{Enter}");
    expect(within(dialog).getByRole("checkbox", { name: "a" })).not.toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: 'Delete checklist item "a"' }));
    expect(within(dialog).getByRole("button", { name: "Uncheck all" })).toBeDisabled();
  });

  it("Move completed to bottom is disabled when sorted, and reorders via click or keyboard", async () => {
    seed(["a", "b", "c"]);
    const user = userEvent.setup();
    render(<Board />);
    const dialog = await openTask(user);
    const button = within(dialog).getByRole("button", { name: "Move completed to bottom" });
    expect(button).toBeDisabled();

    await user.click(within(dialog).getByRole("checkbox", { name: "a" }));
    expect(button).toBeEnabled();
    await user.click(button);
    expect(within(dialog).getAllByRole("checkbox").map((c) => c.closest("label")?.textContent)).toEqual(["b", "c", "a"]);
    expect(button).toBeDisabled();

    await user.click(within(dialog).getByRole("checkbox", { name: "b" }));
    button.focus();
    await user.keyboard("{Enter}");
    expect(within(dialog).getAllByRole("checkbox").map((c) => c.closest("label")?.textContent)).toEqual(["c", "b", "a"]);
  });

  it("Delete completed is disabled until an item is ticked, then removes only the ticked items", async () => {
    seed(["a", "b", "c"]);
    const user = userEvent.setup();
    render(<Board />);
    const dialog = await openTask(user);
    const button = within(dialog).getByRole("button", { name: "Delete completed" });
    expect(button).toBeDisabled();

    await user.click(within(dialog).getByRole("checkbox", { name: "a" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "c" }));
    expect(button).toBeEnabled();

    await user.click(button);
    const boxes = within(dialog).getAllByRole("checkbox");
    expect(boxes).toHaveLength(1);
    expect(within(dialog).getByRole("checkbox", { name: "b" })).not.toBeChecked();
    expect(button).toBeDisabled();
  });

  it("Delete completed removes the whole list when every item is ticked, and is disabled with no checklist", async () => {
    seed(["a"]);
    const user = userEvent.setup();
    render(<Board />);
    const dialog = await openTask(user);
    await user.click(within(dialog).getByRole("checkbox", { name: "a" }));
    within(dialog).getByRole("button", { name: "Delete completed" }).focus();
    await user.keyboard("{Enter}");
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(dialog).queryByRole("list", { name: "Checklist items" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Delete completed" })).toBeDisabled();
  });

  it("shows an accessible 'N/M done' progress label that stays in sync", async () => {
    seed();
    const user = userEvent.setup();
    render(<Board />);
    const dialog = await openTask(user);
    expect(within(dialog).queryByText(/done$/)).not.toBeInTheDocument();

    const input = within(dialog).getByLabelText("New checklist item");
    await user.type(input, "a{Enter}");
    await user.type(input, "b{Enter}");
    expect(within(dialog).getByText("0/2 done")).toBeVisible();

    await user.click(within(dialog).getByRole("checkbox", { name: "a" }));
    expect(within(dialog).getByText("1/2 done")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("checkbox", { name: "b" }));
    expect(within(dialog).getByText("2/2 done")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("checkbox", { name: "a" }));
    expect(within(dialog).getByText("1/2 done")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Uncheck all" }));
    expect(within(dialog).getByText("0/2 done")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: 'Delete checklist item "a"' }));
    expect(within(dialog).getByText("0/1 done")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: 'Delete checklist item "b"' }));
    expect(within(dialog).queryByText(/done$/)).not.toBeInTheDocument();
  });

  it("shows an error for empty items and keeps the dialog open", async () => {
    seed();
    const user = userEvent.setup();
    render(<Board />);
    const dialog = await openTask(user);
    await user.type(within(dialog).getByLabelText("New checklist item"), "   {Enter}");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("must not be empty");
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("keeps checklist changes on Cancel without a discard prompt, and on Save", async () => {
    seed(["a"]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<Board />);
    let dialog = await openTask(user);
    await user.click(within(dialog).getByRole("checkbox", { name: "a" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "1 of 1 checklist items done" })).toBeInTheDocument();

    dialog = await openTask(user);
    await user.click(within(dialog).getByRole("checkbox", { name: "a" }));
    await user.type(within(dialog).getByLabelText("Title"), "!");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(screen.getByRole("img", { name: "0 of 1 checklist items done" })).toBeInTheDocument();
  });

  it("shows a progress badge only on cards with a checklist", () => {
    let board = addCard(emptyBoard(), "Plain", { id: "p" });
    board = addCard(board, "Task", { id: "t" });
    for (let i = 0; i < 5; i++) {
      board = addChecklistItem(board, "t", `item ${i}`, { id: `i${i}` });
    }
    board = toggleChecklistItem(toggleChecklistItem(board, "t", "i0"), "t", "i1");
    saveBoard(board);
    render(<Board />);
    const badge = screen.getByRole("img", { name: "2 of 5 checklist items done" });
    expect(badge).toHaveTextContent("2/5");
    expect(screen.getAllByRole("img", { name: /checklist items done/ })).toHaveLength(1);
  });
});
