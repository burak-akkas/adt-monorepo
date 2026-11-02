import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { addCard, emptyBoard } from "@/lib/board";
import { saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { Board } from "@/components/board/Board";
import { KeyboardShortcuts } from "@/components/app/KeyboardShortcuts";

function renderPage() {
  return render(
    <>
      <KeyboardShortcuts />
      <Board />
    </>,
  );
}

// jsdom does not turn Escape into the dialog's `cancel` event, so dispatch it directly.
function pressEscape() {
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
}

describe("<KeyboardShortcuts />", () => {
  beforeEach(() => resetBoardStore());

  it("focuses the new card title with n without typing it", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.keyboard("n");

    expect(screen.getByLabelText("New card title")).toHaveFocus();
    expect(screen.getByLabelText("New card title")).toHaveValue("");
  });

  it("focuses the search box with / without typing it", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.keyboard("/");

    expect(screen.getByLabelText("Search cards")).toHaveFocus();
    expect(screen.getByLabelText("Search cards")).toHaveValue("");
  });

  it("opens the help dialog with ? listing every shortcut", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.keyboard("?");

    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveTextContent("n");
    expect(dialog).toHaveTextContent("Focus the new card title");
    expect(dialog).toHaveTextContent("/");
    expect(dialog).toHaveTextContent("Focus the card search");
    expect(dialog).toHaveTextContent("?");
    expect(dialog).toHaveTextContent("Show this help");
  });

  it("ignores shortcuts while typing in inputs", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText("New card title"));
    await user.keyboard("n?/");
    expect(screen.getByLabelText("New card title")).toHaveValue("n?/");

    await user.click(screen.getByLabelText("Search cards"));
    await user.keyboard("n?");
    expect(screen.getByLabelText("Search cards")).toHaveValue("n?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores shortcuts while typing in a textarea or select", async () => {
    const user = userEvent.setup();
    saveBoard(addCard(emptyBoard(), "Ship it", { id: "a" }));
    renderPage();

    await user.click(screen.getByRole("button", { name: "Ship it" }));
    const dialog = screen.getByRole("dialog", { name: "Ship it" });
    const description = screen.getByLabelText("Description");
    await user.click(description);
    await user.keyboard("n/?");
    expect(description).toHaveValue("n/?");

    screen.getByLabelText("Status").focus();
    await user.keyboard("n?");
    expect(dialog).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
  });

  it("ignores shortcuts while a dialog is open", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.keyboard("?");
    await user.keyboard("/");
    expect(screen.getByLabelText("Search cards")).not.toHaveFocus();
    await user.keyboard("n");
    expect(screen.getByLabelText("New card title")).not.toHaveFocus();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("ignores shortcuts with Ctrl, Meta or Alt held", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.keyboard("{Control>}n{/Control}");
    await user.keyboard("{Meta>}/{/Meta}");
    await user.keyboard("{Alt>}?{/Alt}");

    expect(screen.getByLabelText("New card title")).not.toHaveFocus();
    expect(screen.getByLabelText("Search cards")).not.toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens from the button and returns focus to it on Escape", async () => {
    const user = userEvent.setup();
    renderPage();
    const button = screen.getByRole("button", { name: "Keyboard shortcuts" });

    await user.click(button);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();

    pressEscape();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("closes with the Close button", async () => {
    const user = userEvent.setup();
    renderPage();
    const button = screen.getByRole("button", { name: "Keyboard shortcuts" });

    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("returns focus to the previously focused element when opened with ?", async () => {
    const user = userEvent.setup();
    saveBoard(addCard(emptyBoard(), "Ship it", { id: "a" }));
    renderPage();
    const move = screen.getByRole("button", { name: "Ship it" });
    move.focus();

    await user.keyboard("?");
    pressEscape();

    await waitFor(() => expect(move).toHaveFocus());
  });

  it("falls back to the button when nothing was focused", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.keyboard("?");
    pressEscape();

    await waitFor(() => expect(screen.getByRole("button", { name: "Keyboard shortcuts" })).toHaveFocus());
  });
});
