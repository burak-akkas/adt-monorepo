import { act, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCard, emptyBoard, moveCard, setCover, setDueDate, type Board } from "@/lib/board";
import { CalendarView } from "@/components/views/CalendarView";
import { CARD_DRAG_TYPE } from "@/components/card/CardItem";

function seed() {
  let b = emptyBoard();
  b = addCard(b, "Pay rent", { id: "rent" });
  b = addCard(b, "Old task", { id: "old" });
  b = addCard(b, "Shipped", { id: "shipped" });
  b = addCard(b, "Someday", { id: "someday" });
  b = setDueDate(b, "rent", "2026-03-20");
  b = setDueDate(b, "old", "2026-03-02");
  b = setDueDate(b, "shipped", "2026-03-01");
  b = moveCard(b, "shipped", "done");
  b = setCover(b, "rent", "blue");
  return b;
}

// Holds the board in a variable so tests can run the updater functions the view hands out.
function setup(board: Board = seed()) {
  const state = { board };
  const onOpen = vi.fn();
  const onUpdateBoard = vi.fn((fn: (b: Board) => Board) => {
    state.board = fn(state.board);
  });
  const view = render(<CalendarView board={board} onOpen={onOpen} onUpdateBoard={onUpdateBoard} />);
  return { state, onOpen, onUpdateBoard, view };
}

const day = (label: string) => screen.getByRole("cell", { name: label });

function dataTransfer() {
  const store = new Map<string, string>();
  return {
    types: [] as string[],
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? "",
    dropEffect: "",
    effectAllowed: "",
  };
}

describe("<CalendarView />", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 2, 15, 12));
  });
  afterEach(() => vi.useRealTimers());

  it("shows the current month with cards on their due day", () => {
    setup();
    expect(screen.getByRole("heading", { name: /March 2026/ })).toBeInTheDocument();
    expect(within(day("March 20, 2026")).getByRole("button", { name: "Pay rent" })).toBeInTheDocument();
    expect(within(day("March 2, 2026")).getByRole("button", { name: "Old task Overdue" })).toBeInTheDocument();
    expect(day("March 15, 2026")).toHaveAttribute("aria-current", "date");
  });

  it("shows the cover color on the card", () => {
    setup();
    const chip = within(day("March 20, 2026")).getByRole("listitem");
    expect(chip.querySelector(".bg-blue-500")).not.toBeNull();
  });

  it("navigates with Previous, Next and Today", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: /April 2026/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("heading", { name: /February 2026/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("heading", { name: /March 2026/ })).toBeInTheDocument();
  });

  it("marks overdue open cards with text but not cards in the done list or upcoming ones", () => {
    setup();
    expect(within(day("March 2, 2026")).getByText("Overdue")).toBeInTheDocument();
    expect(within(day("March 1, 2026")).queryByText("Overdue")).not.toBeInTheDocument();
    expect(within(day("March 20, 2026")).queryByText("Overdue")).not.toBeInTheDocument();
    expect(within(day("March 2, 2026")).getByRole("button", { name: "Old task Overdue" })).toBeInTheDocument();
  });

  it("opens a card when clicked", async () => {
    const user = userEvent.setup();
    const { onOpen } = setup();
    await user.click(within(day("March 20, 2026")).getByRole("button", { name: "Pay rent" }));
    expect(onOpen).toHaveBeenCalledWith("rent");
  });

  it("lists cards without a due date under Unscheduled", () => {
    setup();
    const panel = screen.getByRole("region", { name: "Unscheduled" });
    expect(within(panel).getByRole("button", { name: "Someday" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Pay rent" })).not.toBeInTheDocument();
  });

  it("shows an empty state when everything is scheduled", () => {
    setup(setDueDate(addCard(emptyBoard(), "A", { id: "a" }), "a", "2026-03-10"));
    expect(screen.getByText("No unscheduled cards")).toBeInTheDocument();
  });

  it("moves a card to a date with the Move to date dialog and records the activity", async () => {
    const user = userEvent.setup();
    const { state } = setup();
    await user.click(screen.getByRole("button", { name: "Move Pay rent to date" }));
    const dialog = screen.getByRole("dialog", { name: "Move to date" });
    const input = within(dialog).getByLabelText("New due date");
    expect(input).toHaveValue("2026-03-20");
    fireEvent.change(input, { target: { value: "2026-03-25" } });
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    const card = state.board.columns.todo.find((c) => c.id === "rent");
    expect(card?.dueDate).toBe("2026-03-25");
    expect(card?.activity?.[0]).toMatchObject({ type: "dueDate", from: "2026-03-20", to: "2026-03-25" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("schedules an unscheduled card with Move to date", async () => {
    const user = userEvent.setup();
    const { state } = setup();
    await user.click(screen.getByRole("button", { name: "Move Someday to date" }));
    const dialog = screen.getByRole("dialog", { name: "Move to date" });
    // Defaults to today.
    expect(within(dialog).getByLabelText("New due date")).toHaveValue("2026-03-15");
    await user.click(within(dialog).getByRole("button", { name: "Move" }));
    expect(state.board.columns.todo.find((c) => c.id === "someday")?.dueDate).toBe("2026-03-15");
  });

  it("disables Move for an empty date and does nothing on Cancel", async () => {
    const user = userEvent.setup();
    const { onUpdateBoard } = setup();
    await user.click(screen.getByRole("button", { name: "Move Pay rent to date" }));
    const dialog = screen.getByRole("dialog", { name: "Move to date" });
    fireEvent.change(within(dialog).getByLabelText("New due date"), { target: { value: "" } });
    expect(within(dialog).getByRole("button", { name: "Move" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onUpdateBoard).not.toHaveBeenCalled();
  });

  it("moves a card to another day by drag and drop, with the same activity", () => {
    const { state } = setup();
    const transfer = dataTransfer();
    const chip = within(day("March 20, 2026")).getByRole("listitem");
    fireEvent.dragStart(chip, { dataTransfer: transfer });
    transfer.types = [CARD_DRAG_TYPE];
    const target = day("March 22, 2026");
    const over = createEvent.dragOver(target, { dataTransfer: transfer });
    act(() => {
      fireEvent(target, over);
    });
    expect(over.defaultPrevented).toBe(true);
    fireEvent.drop(target, { dataTransfer: transfer });

    const card = state.board.columns.todo.find((c) => c.id === "rent");
    expect(card?.dueDate).toBe("2026-03-22");
    expect(card?.activity?.[0]).toMatchObject({ type: "dueDate", from: "2026-03-20", to: "2026-03-22" });
  });

  it("schedules an unscheduled card dropped on a day", () => {
    const { state } = setup();
    const transfer = dataTransfer();
    const panel = screen.getByRole("region", { name: "Unscheduled" });
    fireEvent.dragStart(within(panel).getByRole("listitem"), { dataTransfer: transfer });
    fireEvent.drop(day("March 9, 2026"), { dataTransfer: transfer });
    expect(state.board.columns.todo.find((c) => c.id === "someday")?.dueDate).toBe("2026-03-09");
  });

  it("ignores a drop that is not a card", () => {
    const { onUpdateBoard } = setup();
    fireEvent.drop(day("March 9, 2026"), { dataTransfer: dataTransfer() });
    expect(onUpdateBoard).not.toHaveBeenCalled();
  });

  it("dropping on the card's own day leaves the board unchanged", () => {
    const { state } = setup();
    const before = state.board;
    const transfer = dataTransfer();
    fireEvent.dragStart(within(day("March 20, 2026")).getByRole("listitem"), { dataTransfer: transfer });
    fireEvent.drop(day("March 20, 2026"), { dataTransfer: transfer });
    expect(state.board).toBe(before);
  });
});
