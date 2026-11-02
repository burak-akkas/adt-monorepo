import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addCard,
  addComment,
  deleteComment,
  editComment,
  emptyBoard,
  findCard,
  MAX_COMMENT_LENGTH,
  type Board as BoardData,
} from "@/lib/board";
import { saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { resetCommentOrderStore } from "@/hooks/useCommentOrder";
import { COMMENT_ORDER_KEY } from "@/lib/commentOrder";
import { Board } from "@/components/board/Board";
import { CardComments } from "@/components/card/CardComments";

// Holds the comments in state through the pure lib functions, like the dialog does through the board.
function Harness({ onBoard }: { onBoard?: (board: BoardData) => void }) {
  const [board, setBoard] = useState(() => {
    let b = addCard(emptyBoard(), "Task", { id: "a" });
    b = addComment(b, "a", "First comment", { id: "c1", now: new Date(Date.now() - 5 * 60_000) });
    return addComment(b, "a", "Second comment", { id: "c2", now: new Date(Date.now() - 2 * 3600_000) });
  });
  const apply = (fn: (b: BoardData) => BoardData) => {
    const next = fn(board);
    setBoard(next);
    onBoard?.(next);
  };
  return (
    <CardComments
      comments={findCard(board, "a")!.card.comments ?? []}
      onAdd={(text) => apply((b) => addComment(b, "a", text))}
      onEdit={(id, text) => apply((b) => editComment(b, "a", id, text))}
      onDelete={(id) => apply((b) => deleteComment(b, "a", id))}
    />
  );
}

describe("<CardComments />", () => {
  it("lists comments in stored order with a relative time", () => {
    render(<Harness />);
    const items = within(screen.getByRole("list", { name: "Comments" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("First comment");
    expect(items[0]).toHaveTextContent("5 minutes ago");
    expect(items[1]).toHaveTextContent("Second comment");
    expect(items[1]).toHaveTextContent("2 hours ago");
  });

  it("offers the exact time on hover (title) and keyboard focus (tooltip)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const items = within(screen.getByRole("list", { name: "Comments" })).getAllByRole("listitem");
    const time = within(items[0]).getByText("5 minutes ago");
    expect(time).toHaveAttribute("title", expect.stringMatching(/\d/));
    expect(time).toHaveAttribute("tabindex", "0");
    const tooltip = within(items[0]).getByRole("tooltip");
    expect(tooltip).toHaveTextContent(time.getAttribute("title")!);
    expect(time).toHaveAccessibleDescription(time.getAttribute("title")!);
    await user.tab(); // the order toggle comes first
    await user.tab();
    expect(time).toHaveFocus();
  });

  it("keeps Add comment disabled while blank, posts, clears the field and limits the length", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByLabelText("New comment");
    expect(field).toHaveAttribute("maxlength", String(MAX_COMMENT_LENGTH));
    expect(screen.getByRole("button", { name: "Add comment" })).toBeDisabled();
    await user.type(field, "   ");
    expect(screen.getByRole("button", { name: "Add comment" })).toBeDisabled();
    await user.type(field, "Third{Enter}line");
    expect(field).toHaveValue("   Third\nline");
    await user.click(screen.getByRole("button", { name: "Add comment" }));
    expect(field).toHaveValue("");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[2]).toHaveTextContent("Third");
    expect(items[2]).toHaveTextContent("just now");
  });

  it("shows a Ctrl+Enter hint", () => {
    render(<Harness />);
    expect(screen.getByText("Ctrl+Enter to post")).toBeVisible();
  });

  it.each([
    ["Ctrl+Enter", "{Control>}{Enter}{/Control}"],
    ["Cmd+Enter", "{Meta>}{Enter}{/Meta}"],
  ])("posts the draft with %s without inserting a newline", async (_name, keys) => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByLabelText("New comment");
    await user.type(field, "Quick");
    await user.keyboard(keys);
    expect(field).toHaveValue("");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[2]).toHaveTextContent("Quick");
  });

  it("does not post on plain Enter or Shift+Enter", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByLabelText("New comment");
    await user.type(field, "a{Enter}b{Shift>}{Enter}{/Shift}c");
    expect(field).toHaveValue("a\nb\nc");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("does not post a whitespace-only draft with Ctrl+Enter", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByLabelText("New comment");
    await user.type(field, "   ");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(field).toHaveValue("   ");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("does not post or save from the edit textarea with Ctrl+Enter", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("New comment"), "Draft");
    await user.click(screen.getByRole("button", { name: "Edit comment 1" }));
    await user.type(screen.getByRole("textbox", { name: "Edit comment 1" }), " more");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(screen.getByRole("textbox", { name: "Edit comment 1" })).toBeInTheDocument();
    expect(screen.getByLabelText("New comment")).toHaveValue("Draft");
    expect(screen.queryByText("edited")).not.toBeInTheDocument();
  });

  it("edits a comment and marks it edited", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByText("edited")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit comment 1" }));
    const field = screen.getByRole("textbox", { name: "Edit comment 1" });
    expect(field).toHaveFocus();
    await user.clear(field);
    await user.type(field, "Changed");
    await user.click(screen.getByRole("button", { name: "Save comment" }));
    const first = screen.getAllByRole("listitem")[0];
    expect(first).toHaveTextContent("Changed");
    expect(within(first).getByText("edited")).toBeInTheDocument();
  });

  it("cancels an edit with Escape and keeps the original text", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Edit comment 2" }));
    await user.type(screen.getByRole("textbox", { name: "Edit comment 2" }), " more");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Edit comment 2" })).not.toBeInTheDocument();
    expect(screen.getByText("Second comment")).toBeInTheDocument();
    expect(screen.queryByText("edited")).not.toBeInTheDocument();
  });

  it("cannot save a blank edit", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Edit comment 1" }));
    await user.clear(screen.getByRole("textbox", { name: "Edit comment 1" }));
    expect(screen.getByRole("button", { name: "Save comment" })).toBeDisabled();
  });

  it("deletes only after confirmation, moving focus to Confirm delete and back to the new comment field", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Delete comment 1" }));
    expect(screen.getByText("Delete this comment?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm delete" })).toHaveFocus();
    expect(screen.getByText("First comment")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByText("Delete this comment?")).not.toBeInTheDocument();
    expect(screen.getByText("First comment")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete comment 1" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(screen.queryByText("First comment")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByLabelText("New comment")).toHaveFocus();
  });

  it("shows plain Comments at zero and the count otherwise", () => {
    const props = { onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() };
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `x${i}`, text: `T${i}`, createdAt: new Date().toISOString() }));
    const { rerender } = render(<CardComments comments={[]} {...props} />);
    expect(screen.getByRole("heading", { name: "Comments" })).toHaveTextContent(/^Comments$/);
    expect(screen.queryByRole("list", { name: "Comments" })).not.toBeInTheDocument();
    rerender(<CardComments comments={make(1)} {...props} />);
    expect(screen.getByRole("heading", { name: "Comments (1)" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Comments" })).toBeInTheDocument();
    rerender(<CardComments comments={make(3)} {...props} />);
    expect(screen.getByRole("heading", { name: "Comments (3)" })).toBeInTheDocument();
  });

  it("updates the count after adding and deleting comments", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "Comments (2)" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("New comment"), "Third");
    await user.click(screen.getByRole("button", { name: "Add comment" }));
    expect(screen.getByRole("heading", { name: "Comments (3)" })).toBeInTheDocument();
    for (let remaining = 2; remaining >= 1; remaining -= 1) {
      await user.click(screen.getByRole("button", { name: "Delete comment 1" }));
      await user.click(screen.getByRole("button", { name: "Confirm delete" }));
      expect(screen.getByRole("heading", { name: `Comments (${remaining})` })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "Delete comment 1" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(screen.getByRole("heading", { name: "Comments" })).toHaveTextContent(/^Comments$/);
  });

  it("renders HTML-like text literally", () => {
    render(<CardComments comments={[{ id: "x", text: "<b>bold</b>", createdAt: new Date().toISOString() }]} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("<b>bold</b>")).toBeInTheDocument();
  });
});

describe("comments in the board", () => {
  beforeEach(() => resetBoardStore());
  afterEach(() => vi.restoreAllMocks());

  const column = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}`) });

  function seed(count: number) {
    let b = addCard(emptyBoard(), "Alpha", { id: "a" });
    for (let i = 1; i <= count; i += 1) {
      b = addComment(b, "a", `Note ${i}`, { id: `c${i}` });
    }
    saveBoard(b);
  }

  it("shows a count badge with an accessible name, and nothing at zero", () => {
    seed(0);
    const { unmount } = render(<Board />);
    expect(screen.queryByLabelText(/comment/)).not.toBeInTheDocument();
    unmount();
    resetBoardStore();
    seed(1);
    const one = render(<Board />);
    expect(within(column("To do")).getByLabelText("1 comment")).toBeInTheDocument();
    one.unmount();
    resetBoardStore();
    seed(3);
    render(<Board />);
    expect(within(column("To do")).getByLabelText("3 comments")).toBeInTheDocument();
  });

  it("adds a comment from the dialog without a discard prompt, updates the badge and keeps comments on Save", async () => {
    const user = userEvent.setup();
    seed(0);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Board />);

    await user.click(screen.getByRole("button", { name: "Alpha" }));
    const dialog = screen.getByRole("dialog", { name: "Alpha" });
    await user.type(within(dialog).getByLabelText("New comment"), "Hello there");
    await user.click(within(dialog).getByRole("button", { name: "Add comment" }));
    expect(within(dialog).getByText("Hello there")).toBeInTheDocument();
    expect(screen.getByLabelText("1 comment")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Title"), "!");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("1 comment")).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Alpha!" }));
    expect(screen.getByText("Hello there")).toBeInTheDocument();
  });

  it("closes the dialog without a prompt after only commenting, and persists across reloads", async () => {
    const user = userEvent.setup();
    seed(0);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { unmount } = render(<Board />);
    await user.click(screen.getByRole("button", { name: "Alpha" }));
    await user.type(screen.getByLabelText("New comment"), "Kept");
    await user.click(screen.getByRole("button", { name: "Add comment" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    unmount();
    resetBoardStore();
    render(<Board />);
    expect(screen.getByLabelText("1 comment")).toBeInTheDocument();
  });

  it("Escape while editing a comment does not close the dialog", async () => {
    const user = userEvent.setup();
    seed(1);
    render(<Board />);
    await user.click(screen.getByRole("button", { name: "Alpha" }));
    await user.click(screen.getByRole("button", { name: "Edit comment 1" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Edit comment 1" })).not.toBeInTheDocument();
  });
});

describe("<CardComments /> order toggle", () => {
  beforeEach(() => {
    localStorage.clear();
    resetCommentOrderStore();
  });

  const texts = () =>
    within(screen.getByRole("list", { name: "Comments" }))
      .getAllByRole("listitem")
      .map((li) => li.querySelector("p")?.textContent);

  it("is oldest first by default and hidden with fewer than 2 comments", () => {
    const { unmount } = render(<CardComments comments={[]} onAdd={() => {}} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.queryByRole("button", { name: "Newest first" })).not.toBeInTheDocument();
    unmount();
    render(<Harness />);
    expect(texts()).toEqual(["First comment", "Second comment"]);
    expect(screen.getByRole("button", { name: "Newest first" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reverses the list, keeps chronological labels and persists the choice", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Newest first" }));
    expect(texts()).toEqual(["Second comment", "First comment"]);
    expect(screen.getByRole("button", { name: "Newest first" })).toHaveAttribute("aria-pressed", "true");
    const items = within(screen.getByRole("list", { name: "Comments" })).getAllByRole("listitem");
    expect(within(items[0]).getByRole("button", { name: "Edit comment 2" })).toBeInTheDocument();
    expect(localStorage.getItem(COMMENT_ORDER_KEY)).toBe("newest");

    unmount();
    resetCommentOrderStore();
    render(<Harness />);
    expect(texts()).toEqual(["Second comment", "First comment"]);
  });

  it("edits and deletes the right comment in newest-first order", async () => {
    const user = userEvent.setup();
    let latest: BoardData | undefined;
    render(<Harness onBoard={(b) => (latest = b)} />);
    await user.click(screen.getByRole("button", { name: "Newest first" }));

    await user.click(screen.getByRole("button", { name: "Edit comment 2" }));
    await user.clear(screen.getByRole("textbox", { name: "Edit comment 2" }));
    await user.type(screen.getByRole("textbox", { name: "Edit comment 2" }), "Changed");
    await user.click(screen.getByRole("button", { name: "Save comment" }));
    expect(texts()).toEqual(["Changed", "First comment"]);

    await user.click(screen.getByRole("button", { name: "Edit comment 1" }));
    await user.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(texts()).toEqual(["Changed", "First comment"]);

    await user.click(screen.getByRole("button", { name: "Delete comment 2" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(texts()).toEqual(["First comment"]);
    expect(findCard(latest!, "a")!.card.comments!.map((c) => c.id)).toEqual(["c1"]);
  });

  it("shows a newly added comment first in newest-first order", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Newest first" }));
    await user.type(screen.getByLabelText("New comment"), "Third comment");
    await user.click(screen.getByRole("button", { name: "Add comment" }));
    expect(texts()).toEqual(["Third comment", "Second comment", "First comment"]);
  });
});

describe("<CardComments /> copy", () => {
  const comments = [
    { id: "c1", text: "Line one\nLine two", createdAt: "2030-01-01T10:00:00.000Z", editedAt: "2030-01-02T10:00:00.000Z" },
    { id: "c2", text: "Second", createdAt: "2030-01-01T11:00:00.000Z" },
  ];
  const noop = () => undefined;

  it("copies exactly the comment text", async () => {
    const onCopy = vi.fn();
    const user = userEvent.setup();
    render(<CardComments comments={comments} onAdd={noop} onEdit={noop} onDelete={noop} onCopy={onCopy} />);
    await user.click(screen.getByRole("button", { name: "Copy comment 1" }));
    expect(onCopy).toHaveBeenCalledWith("Line one\nLine two");
  });

  it("hides Copy while editing or confirming delete", async () => {
    const user = userEvent.setup();
    render(<CardComments comments={comments} onAdd={noop} onEdit={noop} onDelete={noop} onCopy={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Edit comment 1" }));
    expect(screen.queryByRole("button", { name: "Copy comment 1" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete comment 2" }));
    expect(screen.queryByRole("button", { name: "Copy comment 2" })).not.toBeInTheDocument();
  });

  it("has no Copy button without onCopy", () => {
    render(<CardComments comments={comments} onAdd={noop} onEdit={noop} onDelete={noop} />);
    expect(screen.queryByRole("button", { name: /Copy comment/ })).not.toBeInTheDocument();
  });
});
