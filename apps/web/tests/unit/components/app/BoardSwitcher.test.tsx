import { act, createEvent, fireEvent, render, screen, waitFor, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Board } from "@/components/board/Board";
import { BoardSwitcher } from "@/components/app/BoardSwitcher";
import { resetBoardStore } from "@/hooks/useBoard";

function setup() {
  const user = userEvent.setup();
  render(
    <>
      <BoardSwitcher />
      <Board />
    </>,
  );
  return { user };
}

const select = () => screen.getByRole("combobox", { name: "Board" });
const selectedName = () => (select() as HTMLSelectElement).selectedOptions[0]?.textContent;
const optionNames =() => within(select()).getAllByRole("option").map((o) => o.textContent);

async function choose(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole("button", { name: "Board actions" }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

async function create(user: ReturnType<typeof userEvent.setup>, name: string) {
  await choose(user, "New board");
  const input = screen.getByLabelText("Board name");
  await user.clear(input);
  await user.type(input, name);
  await user.click(screen.getByRole("button", { name: "Create" }));
}

describe("<BoardSwitcher />", () => {
  beforeEach(() => {
    localStorage.clear();
    resetBoardStore();
  });

  it("shows the current board and lists all boards", async () => {
    const { user } = setup();
    expect(selectedName()).toBe("My board");
    await create(user, "Work");
    expect(optionNames()).toEqual(["My board", "Work"]);
    expect(selectedName()).toBe("Work");
  });

  it("styles the board select like the label filter select", () => {
    setup();
    const board = select();
    const filter = screen.getByRole("combobox", { name: "Filter by label" });
    expect(board).toHaveClass("px-3", "py-2");
    expect(board).not.toHaveClass("text-xs");
    expect(filter).toHaveClass("px-3", "py-2");
    expect(filter).not.toHaveClass("text-xs");
  });

  it("switches boards by keyboard and keeps cards per board", async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText("New card title"), "Mine");
    await user.click(screen.getByRole("button", { name: "Add card" }));
    await create(user, "Work");
    expect(screen.queryByText("Mine")).not.toBeInTheDocument();

    await user.tab();
    expect(select()).toHaveFocus();
    await user.selectOptions(select(), "My board");
    expect(selectedName()).toBe("My board");
    expect(screen.getByText("Mine")).toBeInTheDocument();
  });

  describe("create", () => {
    it("shows the character limit and creates an empty current board", async () => {
      const { user } = setup();
      await choose(user, "New board");
      expect(screen.getByText(/up to 40 characters/i)).toBeInTheDocument();
      await user.type(screen.getByLabelText("Board name"), "Work");
      await user.click(screen.getByRole("button", { name: "Create" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(selectedName()).toBe("Work");
      expect(screen.getByRole("region", { name: /^To do/ })).toBeInTheDocument();
    });

    it.each([
      ["empty", "   ", /must not be empty/i],
      ["too long", "x".repeat(41), /at most 40/i],
      ["duplicate (case-insensitive)", "MY BOARD", /already exists/i],
    ])("rejects a %s name and adds nothing", async (_label, name, message) => {
      const { user } = setup();
      await choose(user, "New board");
      const input = screen.getByLabelText("Board name");
      if (name.trim()) {
        await user.click(input);
        await user.paste(name);
      }
      await user.click(screen.getByRole("button", { name: "Create" }));
      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(input).toHaveAttribute("aria-invalid", "true");
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(optionNames()).toEqual(["My board"]);
    });
  });

  describe("duplicate", () => {
    it("copies the current board with its cards by keyboard and selects the copy", async () => {
      const { user } = setup();
      await user.type(screen.getByLabelText("New card title"), "Mine");
      await user.click(screen.getByRole("button", { name: "Add card" }));

      await user.click(screen.getByRole("button", { name: "Board actions" }));
      expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toContain("Duplicate board");
      await user.click(screen.getByRole("menuitem", { name: "Duplicate board" }));

      expect(optionNames()).toEqual(["My board", "My board (copy)"]);
      expect(selectedName()).toBe("My board (copy)");
      expect(screen.getByText("Mine")).toBeInTheDocument();
    });

    it("numbers a second copy", async () => {
      const { user } = setup();
      await choose(user, "Duplicate board");
      await user.selectOptions(select(), "My board");
      await choose(user, "Duplicate board");
      expect(optionNames()).toEqual(["My board", "My board (copy)", "My board (copy 2)"]);
    });
  });

  describe("rename", () => {
    it("is prefilled and renames the current board", async () => {
      const { user } = setup();
      await choose(user, "Rename board");
      const input = screen.getByLabelText("Board name");
      expect(input).toHaveValue("My board");
      await user.clear(input);
      await user.type(input, "Home");
      await user.click(screen.getByRole("button", { name: "Rename" }));
      expect(optionNames()).toEqual(["Home"]);
    });

    it("allows changing only the casing, and rejects duplicates without changing anything", async () => {
      const { user } = setup();
      await create(user, "Work");
      await choose(user, "Rename board");
      let input = screen.getByLabelText("Board name");
      await user.clear(input);
      await user.type(input, "my board");
      await user.click(screen.getByRole("button", { name: "Rename" }));
      expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i);
      expect(optionNames()).toEqual(["My board", "Work"]);

      input = screen.getByLabelText("Board name");
      await user.clear(input);
      await user.type(input, "WORK");
      await user.click(screen.getByRole("button", { name: "Rename" }));
      expect(optionNames()).toEqual(["My board", "WORK"]);
    });
  });

  describe("delete", () => {
    it("is disabled for the last board", async () => {
      const { user } = setup();
      await user.click(screen.getByRole("button", { name: "Board actions" }));
      const item = screen.getByRole("menuitem", { name: "Delete board" });
      expect(item).toHaveAttribute("aria-disabled", "true");
      await user.click(item);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("keeps the board when cancelled or escaped", async () => {
      const { user } = setup();
      await create(user, "Work");
      await choose(user, "Delete board");
      expect(screen.getByRole("dialog")).toHaveTextContent(/delete .work. and all its cards/i);
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(optionNames()).toEqual(["My board", "Work"]);

      await choose(user, "Delete board");
      const dialog = screen.getByRole("dialog");
      fireEvent(dialog, createEvent("cancel", dialog, { cancelable: true }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(optionNames()).toEqual(["My board", "Work"]);
    });

    it("removes the board after confirming and makes another current", async () => {
      const { user } = setup();
      await create(user, "Work");
      await choose(user, "Delete board");
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
      expect(optionNames()).toEqual(["My board"]);
      expect(selectedName()).toBe("My board");
    });
  });

  describe("collapse empty lists", () => {
    const item = (name: string) => screen.getByRole("menuitem", { name });

    it("collapses only the empty lists, then disables itself", async () => {
      const { user } = setup();
      await user.type(screen.getByLabelText("New card title"), "Task");
      await user.click(screen.getByRole("button", { name: "Add card" }));

      await user.click(screen.getByRole("button", { name: "Board actions" }));
      expect(item("Collapse empty lists")).not.toHaveAttribute("aria-disabled", "true");
      await user.click(item("Collapse empty lists"));
      expect(screen.getByRole("button", { name: "Collapse To do" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Expand Doing" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Expand Done" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Board actions" }));
      expect(item("Collapse empty lists")).toHaveAttribute("aria-disabled", "true");
    });

    it("works by keyboard", async () => {
      const { user } = setup();
      await user.click(screen.getByRole("button", { name: "Board actions" }));
      item("Collapse empty lists").focus();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("button", { name: "Expand To do" })).toBeInTheDocument();
    });
  });

  describe("collapse and expand all lists", () => {
    const item = (name: string) => screen.getByRole("menuitem", { name });

    it("disables Expand all when nothing is collapsed and Collapse all when everything is", async () => {
      const { user } = setup();
      await user.click(screen.getByRole("button", { name: "Board actions" }));
      expect(item("Expand all lists")).toHaveAttribute("aria-disabled", "true");
      expect(item("Collapse all lists")).not.toHaveAttribute("aria-disabled", "true");
      await user.click(item("Collapse all lists"));

      await user.click(screen.getByRole("button", { name: "Board actions" }));
      expect(item("Collapse all lists")).toHaveAttribute("aria-disabled", "true");
      expect(item("Expand all lists")).not.toHaveAttribute("aria-disabled", "true");
    });

    it("collapses and expands every list", async () => {
      const { user } = setup();
      await choose(user, "Collapse all lists");
      for (const name of ["To do", "Doing", "Done"]) {
        expect(screen.getByRole("button", { name: `Expand ${name}` })).toBeInTheDocument();
      }
      await choose(user, "Expand all lists");
      for (const name of ["To do", "Doing", "Done"]) {
        expect(screen.getByRole("button", { name: `Collapse ${name}` })).toBeInTheDocument();
      }
    });

    it("works by keyboard and only affects the current board", async () => {
      const { user } = setup();
      await user.click(screen.getByRole("button", { name: "Board actions" }));
      item("Collapse all lists").focus();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("button", { name: "Expand Done" })).toBeInTheDocument();

      await create(user, "Work");
      expect(screen.getByRole("button", { name: "Collapse Done" })).toBeInTheDocument();
      await user.selectOptions(select(), "My board");
      expect(screen.getByRole("button", { name: "Expand Done" })).toBeInTheDocument();
    });
  });

  describe("sort lists by due date", () => {
    async function addDated(user: ReturnType<typeof userEvent.setup>, title: string, due?: string) {
      await user.type(screen.getByLabelText("New card title"), title);
      await user.click(screen.getByRole("button", { name: "Add card" }));
      const card = await screen.findByRole("button", { name: title });
      if (!due) return;
      await user.click(card);
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Due date"), due);
      await user.click(within(dialog).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }
    const todoTitles = () =>
      within(screen.getByRole("region", { name: /^To do/ }))
        .getAllByRole("button", { name: /^(Late|Early|None)$/ })
        .map((b) => b.textContent);

    it("is disabled while no card has a due date", async () => {
      const { user } = setup();
      await addDated(user, "None");
      await user.click(screen.getByRole("button", { name: "Board actions" }));
      expect(screen.getByRole("menuitem", { name: "Sort lists by due date" })).toHaveAttribute("aria-disabled", "true");
    });

    it("sorts by click and by keyboard", async () => {
      const { user } = setup();
      await addDated(user, "Late", "2031-01-01");
      await addDated(user, "None");
      await addDated(user, "Early", "2030-01-01");
      expect(todoTitles()).toEqual(["Late", "None", "Early"]);

      await choose(user, "Sort lists by due date");
      expect(todoTitles()).toEqual(["Early", "Late", "None"]);

      await user.click(screen.getByRole("button", { name: "Board actions" }));
      const item = screen.getByRole("menuitem", { name: "Sort lists by due date" });
      expect(item).not.toHaveAttribute("aria-disabled", "true");
      item.focus();
      await user.keyboard("{Enter}");
      expect(todoTitles()).toEqual(["Early", "Late", "None"]);
    });
  });

  describe("copy board link", () => {
    function stubClipboard(clipboard: { writeText: (text: string) => Promise<void> } | undefined) {
      Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    }
    const currentLink = () =>
      new URL(`?board=${encodeURIComponent((select() as HTMLSelectElement).value)}`, window.location.href).href;

    afterEach(() => {
      vi.useRealTimers();
    });

    it("copies the absolute link by keyboard, confirms, and the confirmation goes away on its own", async () => {
      const { user } = setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      stubClipboard({ writeText });
      await user.click(screen.getByRole("button", { name: "Board actions" }));
      screen.getByRole("menuitem", { name: "Copy board link" }).focus();
      await user.keyboard("{Enter}");
      expect(writeText).toHaveBeenCalledWith(currentLink());
      expect(await screen.findByRole("status")).toHaveTextContent("Link copied");
      await waitForElementToBeRemoved(() => screen.queryByRole("status"), { timeout: 4500 });
    }, 10000);

    it("copies the link of the newly selected board", async () => {
      const { user } = setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      stubClipboard({ writeText });
      await choose(user, "Copy board link");
      const first = writeText.mock.calls[0][0] as string;
      await create(user, "Work");
      await choose(user, "Copy board link");
      const second = writeText.mock.calls[1][0] as string;
      expect(second).toBe(currentLink());
      expect(second).not.toBe(first);
    });

    it("shows the link when the clipboard rejects", async () => {
      const { user } = setup();
      stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
      await choose(user, "Copy board link");
      const status = await screen.findByRole("status");
      expect(status).toHaveTextContent(currentLink());
      expect(status).not.toHaveTextContent("Link copied");
      await user.click(within(status).getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("shows the link when the clipboard API is missing", async () => {
      const { user } = setup();
      stubClipboard(undefined);
      await choose(user, "Copy board link");
      expect(await screen.findByRole("status")).toHaveTextContent(currentLink());
    });
  });

  describe("copy as Markdown", () => {
    function stubClipboard(clipboard: { writeText: (text: string) => Promise<void> } | undefined) {
      Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    }
    const expected = "# My board\n\n## To do\n- Pay rent\n\n## Doing\n_No cards_\n\n## Done\n_No cards_\n";

    async function addCard(user: ReturnType<typeof userEvent.setup>, title: string) {
      await user.type(screen.getByLabelText("New card title"), title);
      await user.click(screen.getByRole("button", { name: "Add card" }));
    }

    it("copies the board by keyboard, confirms, and the confirmation goes away on its own", async () => {
      const { user } = setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      stubClipboard({ writeText });
      await addCard(user, "Pay rent");
      await user.click(screen.getByRole("button", { name: "Board actions" }));
      screen.getByRole("menuitem", { name: "Copy as Markdown" }).focus();
      await user.keyboard("{Enter}");
      expect(writeText).toHaveBeenCalledWith(expected);
      expect(await screen.findByRole("status")).toHaveTextContent("Copied as Markdown");
      await waitForElementToBeRemoved(() => screen.queryByRole("status"), { timeout: 4500 });
    }, 10000);

    it("shows the Markdown when the clipboard rejects, and it can be dismissed", async () => {
      const { user } = setup();
      stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
      await addCard(user, "Pay rent");
      await choose(user, "Copy as Markdown");
      const status = await screen.findByRole("status");
      expect(status).not.toHaveTextContent("Copied as Markdown");
      expect(status.querySelector("pre")?.textContent).toBe(expected);
      await user.click(within(status).getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("shows the Markdown when the clipboard API is missing", async () => {
      const { user } = setup();
      stubClipboard(undefined);
      await choose(user, "Copy as Markdown");
      expect(await screen.findByRole("status")).toHaveTextContent("# My board");
    });
  });

  // Adds a card, moves it to Done and saves. Board.closeDialog moves focus in a requestAnimationFrame after
  // Save; if that frame fires during the next user.type() it steals focus and the typed title is lost.
  // So wait for the dialog to close and flush that frame before returning.
  async function addCardAsDone(user: ReturnType<typeof userEvent.setup>, title: string) {
    await user.type(screen.getByLabelText("New card title"), title);
    await user.click(screen.getByRole("button", { name: "Add card" }));
    await user.click(await screen.findByRole("button", { name: title }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Status"), "Done");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }

  describe("archive done cards", () => {
    const addDone = addCardAsDone;

    it("is disabled while the done list is empty", async () => {
      const { user } = setup();
      await user.click(screen.getByRole("button", { name: "Board actions" }));
      const item = screen.getByRole("menuitem", { name: "Archive done cards" });
      expect(item).toHaveAttribute("aria-disabled", "true");
      await user.click(item);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("changes nothing when cancelled", async () => {
      const { user } = setup();
      await addDone(user, "Alpha");
      await choose(user, "Archive done cards");
      expect(screen.getByRole("dialog")).toHaveTextContent(/archive all 1 card in the done list/i);
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(within(screen.getByRole("region", { name: /^Done/ })).getByText("Alpha")).toBeInTheDocument();
    });

    it("archives only the done list after confirming", async () => {
      const { user } = setup();
      await user.type(screen.getByLabelText("New card title"), "Keep");
      await user.click(screen.getByRole("button", { name: "Add card" }));
      await addDone(user, "Alpha");
      await addDone(user, "Beta");
      await choose(user, "Archive done cards");
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
      expect(screen.queryByText("Beta")).not.toBeInTheDocument();
      expect(within(screen.getByRole("region", { name: /^To do/ })).getByText("Keep")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Board actions" }));
      expect(screen.getByRole("menuitem", { name: "Archive done cards" })).toHaveAttribute("aria-disabled", "true");
    });
  });

  describe("empty archive", () => {
    async function archiveCards(user: ReturnType<typeof userEvent.setup>, titles: string[]) {
      for (const title of titles) {
        await addCardAsDone(user, title);
      }
      await choose(user, "Archive done cards");
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    }

    it("is disabled while the archive is empty", async () => {
      const { user } = setup();
      await user.click(screen.getByRole("button", { name: "Board actions" }));
      const item = screen.getByRole("menuitem", { name: "Empty archive" });
      expect(item).toHaveAttribute("aria-disabled", "true");
      await user.click(item);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("asks with the singular count and keeps the archive when cancelled or escaped", async () => {
      const { user } = setup();
      await archiveCards(user, ["Alpha"]);
      await choose(user, "Empty archive");
      expect(screen.getByRole("dialog")).toHaveTextContent(/delete 1 card from the archive\? this cannot be undone/i);
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await choose(user, "Empty archive");
      const dialog = screen.getByRole("dialog");
      fireEvent(dialog, createEvent("cancel", dialog, { cancelable: true }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Archived (1)" })).toBeInTheDocument();
    });

    it("deletes all archived cards after confirming and disables the item again", async () => {
      const { user } = setup();
      await archiveCards(user, ["Alpha", "Beta"]);
      await choose(user, "Empty archive");
      expect(screen.getByRole("dialog")).toHaveTextContent(/delete 2 cards from the archive/i);
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Archived (0)" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Board actions" }));
      expect(screen.getByRole("menuitem", { name: "Empty archive" })).toHaveAttribute("aria-disabled", "true");
    });
  });

  it("shows a single Board actions button instead of separate board buttons", () => {
    setup();
    const trigger = screen.getByRole("button", { name: "Board actions" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    for (const name of ["New board", "Rename board", "Delete board"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("remembers the last used board", async () => {
    const { user } = setup();
    await create(user, "Work");
    resetBoardStore();
    document.body.innerHTML = "";
    setup();
    expect(selectedName()).toBe("Work");
  });
});
