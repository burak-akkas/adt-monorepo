import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_LABEL_LENGTH, MAX_NOTES_LENGTH, type Card } from "@/lib/board";
import { CardDialog } from "@/components/card/CardDialog";

const card: Card = {
  id: "a",
  title: "Write docs",
  createdAt: "2030-01-01T10:00:00.000Z",
  priority: "medium",
  notes: "Some notes",
  dueDate: "2030-02-03",
};

function setup(overrides: Partial<Card> = {}, onDuplicate?: () => void, onArchive?: () => void) {
  const onSave = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  const onUpdateBoard = vi.fn();
  render(
    <CardDialog
      card={{ ...card, ...overrides }}
      column="todo"
      onSave={onSave}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      onArchive={onArchive}
      onClose={onClose}
      onUpdateBoard={onUpdateBoard}
    />,
  );
  return { onSave, onDelete, onClose, onUpdateBoard, user: userEvent.setup() };
}

function renderCopy(onCopyText: () => Promise<"copied" | { text: string }>) {
  render(
    <CardDialog card={card} column="todo" onSave={vi.fn()} onDelete={vi.fn()} onCopyText={onCopyText} onClose={vi.fn()} onUpdateBoard={vi.fn()} />,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("<CardDialog /> size", () => {
  it("uses the wide dialog size", () => {
    setup();
    expect(screen.getByRole("dialog")).toHaveClass("max-w-3xl");
  });
});

describe("<CardDialog /> activity", () => {
  it("shows the stored log read-only and unaffected by editing the draft", async () => {
    const { user } = setup({
      activity: [
        { id: "2", at: "2030-01-01T11:00:00.000Z", type: "priority", from: "low", to: "medium" },
        { id: "1", at: "2030-01-01T10:00:00.000Z", type: "created" },
      ],
    });
    const log = screen.getByRole("list", { name: "Activity" });
    expect(screen.getByRole("heading", { name: "Activity" })).toBeInTheDocument();
    expect(within(log).getAllByRole("listitem")).toHaveLength(2);
    await user.selectOptions(screen.getByLabelText("Priority"), "high");
    expect(within(log).getAllByRole("listitem")).toHaveLength(2);
  });

  it("says there is no activity for cards without a log", () => {
    setup();
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });
});

describe("<CardDialog />", () => {
  it("is a dialog named by the card title with a heading", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Write docs" });
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "Write docs" })).toBeInTheDocument();
  });

  it("prefills the fields and shows the created date read-only", () => {
    setup();
    expect(screen.getByLabelText("Title")).toHaveValue("Write docs");
    expect(screen.getByLabelText("Description")).toHaveValue("Some notes");
    expect(screen.getByLabelText("Status")).toHaveValue("todo");
    expect(screen.getByLabelText("Priority")).toHaveValue("medium");
    expect(screen.getByLabelText("Due date")).toHaveValue("2030-02-03");
    expect(screen.getByText(/^Created/).querySelector("time")).toHaveAttribute("datetime", card.createdAt);
  });

  it("shows an error and blocks Save for an empty title", async () => {
    const { user, onSave } = setup();
    await user.clear(screen.getByLabelText("Title"));
    expect(screen.getByRole("alert")).toHaveTextContent("Title must not be empty");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("limits the description length", () => {
    setup();
    expect(screen.getByLabelText("Description")).toHaveAttribute("maxlength", String(MAX_NOTES_LENGTH));
  });

  it("shows a visible character count that follows the description", async () => {
    const { user } = setup({ notes: undefined });
    const description = screen.getByLabelText("Description");
    const count = screen.getByText("0 characters");
    expect(count).toBeVisible();
    expect(count).not.toHaveAttribute("aria-hidden");
    expect(description).toHaveAccessibleDescription("0 characters");
    await user.type(description, "a");
    expect(screen.getByText("1 character")).toBeInTheDocument();
    await user.type(description, "bc");
    expect(screen.getByText("3 characters")).toBeInTheDocument();
    await user.clear(description);
    expect(screen.getByText("0 characters")).toBeInTheDocument();
  });

  it("counts existing notes on open", () => {
    setup();
    expect(screen.getByText("10 characters")).toBeInTheDocument();
  });

  it("clears the due date", async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole("button", { name: "Clear due date" }));
    expect(screen.getByLabelText("Due date")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dueDate: undefined }));
  });

  it("sets the due date from the Today, Tomorrow and Next week buttons", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2024, 1, 28, 12));
    try {
      const { user, onSave } = setup({ dueDate: undefined });
      const group = screen.getByRole("group", { name: "Quick picks" });
      expect(screen.queryByRole("button", { name: "Clear due date" })).not.toBeInTheDocument();

      await user.click(within(group).getByRole("button", { name: "Today" }));
      expect(screen.getByLabelText("Due date")).toHaveValue("2024-02-28");
      expect(screen.getByRole("button", { name: "Clear due date" })).toBeInTheDocument();
      await user.click(within(group).getByRole("button", { name: "Tomorrow" }));
      expect(screen.getByLabelText("Due date")).toHaveValue("2024-02-29");
      await user.click(within(group).getByRole("button", { name: "Next week" }));
      expect(screen.getByLabelText("Due date")).toHaveValue("2024-03-06");
      expect(onSave).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dueDate: "2024-03-06" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("replaces an existing due date when a quick button is used", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2024, 11, 31, 12));
    try {
      const { user } = setup();
      expect(screen.getByLabelText("Due date")).toHaveValue("2030-02-03");
      await user.click(screen.getByRole("button", { name: "Tomorrow" }));
      expect(screen.getByLabelText("Due date")).toHaveValue("2025-01-01");
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves all edits at once", async () => {
    const { user, onSave } = setup();
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Ship docs");
    await user.clear(screen.getByLabelText("Description"));
    await user.selectOptions(screen.getByLabelText("Status"), "doing");
    await user.selectOptions(screen.getByLabelText("Priority"), "high");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      title: "Ship docs",
      notes: undefined,
      priority: "high",
      dueDate: "2030-02-03",
      column: "doing",
      labels: [],
    });
  });

  it("adds labels with the keyboard, rejects bad input with a visible message and removes labels", async () => {
    const { user, onSave } = setup({ labels: ["Bug"] });
    expect(screen.getByRole("button", { name: "Remove label Bug" })).toBeInTheDocument();

    const input = screen.getByLabelText("Labels");
    await user.type(input, "  design {Enter}");
    expect(onSave).not.toHaveBeenCalled();
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: "Remove label design" })).toBeInTheDocument();

    await user.type(input, "BUG{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("already exists");

    await user.clear(input);
    await user.type(input, "   {Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("must not be empty");

    await user.type(input, "x".repeat(MAX_LABEL_LENGTH + 1));
    await user.click(screen.getByRole("button", { name: "Add label" }));
    expect(screen.getByRole("alert")).toHaveTextContent(`at most ${MAX_LABEL_LENGTH} characters`);

    await user.click(screen.getByRole("button", { name: "Remove label Bug" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ labels: ["design"] }));
  });

  it("asks before discarding when only labels changed", async () => {
    const { user, onClose } = setup();
    await user.type(screen.getByLabelText("Labels"), "bug{Enter}");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Discard changes" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes without asking when Cancel is used with no changes", async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Discard changes" })).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before discarding, keeps the edits on Cancel and closes on Discard", async () => {
    const { user, onClose } = setup();
    await user.type(screen.getByLabelText("Title"), "!");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const confirm = screen.getByRole("dialog", { name: "Discard changes" });
    expect(within(confirm).getByText("Discard your unsaved changes?")).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Discard changes" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Title")).toHaveValue("Write docs!");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(within(screen.getByRole("dialog", { name: "Discard changes" })).getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("routes Escape (cancel event) through the same close logic", () => {
    const { onClose } = setup();
    const dialog = screen.getByRole("dialog");
    const event = createEvent("cancel", dialog, { cancelable: true });
    fireEvent(dialog, event);
    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Discard changes" })).not.toBeInTheDocument();
  });

  it("confirms Escape and backdrop closes when dirty, and Escape in the confirm only cancels it", async () => {
    const { user, onClose } = setup();
    await user.type(screen.getByLabelText("Title"), "!");
    const dialog = screen.getByRole("dialog", { name: "Write docs" });
    fireEvent(dialog, createEvent("cancel", dialog, { cancelable: true }));
    const confirm = screen.getByRole("dialog", { name: "Discard changes" });
    fireEvent(confirm, createEvent("cancel", confirm, { cancelable: true }));
    expect(screen.queryByRole("dialog", { name: "Discard changes" })).not.toBeInTheDocument();
    await user.click(dialog);
    expect(screen.getByRole("dialog", { name: "Discard changes" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on a backdrop click but not on a click inside the dialog", async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByLabelText("Title"));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("deletes only after confirmation", async () => {
    const { user, onDelete, onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Delete card" }));
    const confirm = screen.getByRole("dialog", { name: "Delete card" });
    expect(within(confirm).getByText('Delete "Write docs"?')).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete card" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete card" })).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("duplicates with the mouse and with the keyboard", async () => {
    const onDuplicate = vi.fn();
    const { user } = setup({}, onDuplicate);
    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    screen.getByRole("button", { name: "Duplicate" }).focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onDuplicate).toHaveBeenCalledTimes(3);
  });

  it("copies as text with the mouse and with the keyboard", async () => {
    const onCopyText = vi.fn().mockResolvedValue("copied");
    const user = userEvent.setup();
    renderCopy(onCopyText);
    await user.click(screen.getByRole("button", { name: "Copy as text" }));
    expect(onCopyText).toHaveBeenCalledTimes(1);
    screen.getByRole("button", { name: "Copy as text" }).focus();
    await user.keyboard("{Enter}");
    expect(onCopyText).toHaveBeenCalledTimes(2);
  });

  it("confirms a successful copy", async () => {
    const user = userEvent.setup();
    renderCopy(vi.fn().mockResolvedValue("copied"));
    await user.click(screen.getByRole("button", { name: "Copy as text" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
  });

  it("shows the text to copy by hand when copying fails, and can be dismissed", async () => {
    const user = userEvent.setup();
    renderCopy(vi.fn().mockResolvedValue({ text: "Write docs\n\n[ ] one" }));
    await user.click(screen.getByRole("button", { name: "Copy as text" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Copy the text by hand");
    expect(status).toHaveTextContent("[ ] one");
    await user.click(within(status).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("has no Copy as text button without the callback", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Copy as text" })).not.toBeInTheDocument();
  });

  it("archives with the mouse and the keyboard, and explains that unsaved edits are not saved", async () => {
    const onArchive = vi.fn();
    const { user } = setup({}, undefined, onArchive);
    const button = screen.getByRole("button", { name: "Archive" });
    expect(button).toHaveAttribute("title", "Archives the saved card (unsaved edits are not saved)");
    await user.click(button);
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onArchive).toHaveBeenCalledTimes(3);
  });

  it("has no Archive button without onArchive", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });
});

describe("<CardDialog /> copy comment", () => {
  const withComment: Card = {
    ...card,
    comments: [{ id: "c1", text: "Hello\nworld", createdAt: "2030-01-01T10:00:00.000Z" }],
  };

  function renderWithComment() {
    const onUpdateBoard = vi.fn();
    const onClose = vi.fn();
    render(<CardDialog card={withComment} column="todo" onSave={vi.fn()} onDelete={vi.fn()} onClose={onClose} onUpdateBoard={onUpdateBoard} />);
    return { onUpdateBoard, onClose, user: userEvent.setup() };
  }

  it("writes the comment to the clipboard and confirms", async () => {
    const { onUpdateBoard, onClose, user } = renderWithComment();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(screen.getByRole("button", { name: "Copy comment 1" }));
    expect(writeText).toHaveBeenCalledWith("Hello\nworld");
    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
    expect(onUpdateBoard).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the comment to copy by hand when the clipboard fails, and can dismiss it", async () => {
    const { user } = renderWithComment();
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    await user.click(screen.getByRole("button", { name: "Copy comment 1" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Copy the comment by hand");
    expect(status).toHaveTextContent("Hello");
    await user.click(within(status).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
