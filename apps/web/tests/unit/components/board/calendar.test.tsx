import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCard, emptyBoard, setDueDate, todayString } from "@/lib/board";
import { saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { Board } from "@/components/board/Board";

// Keep the real better-auth session client (and its timers) out of these board tests.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ status: "anonymous", user: null, logout: vi.fn() }),
}));

describe("<Board /> calendar view", () => {
  beforeEach(() => resetBoardStore());

  it("switches to the calendar, shows a card on its day and remembers the view after a remount", async () => {
    saveBoard(setDueDate(addCard(emptyBoard(), "Pay rent", { id: "rent" }), "rent", todayString()));
    const user = userEvent.setup();
    const { unmount } = render(<Board />);
    await user.click(screen.getByRole("radio", { name: "Calendar" }));
    expect(screen.getByRole("button", { name: "Next month" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Pay rent/ })).toBeInTheDocument();
    expect(screen.getByText("Due today")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /^To do/ })).not.toBeInTheDocument();

    unmount();
    resetBoardStore();
    render(<Board />);
    expect(screen.getByRole("radio", { name: "Calendar" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Next month" })).toBeInTheDocument();
  });

  it("opens the card dialog from the calendar", async () => {
    saveBoard(setDueDate(addCard(emptyBoard(), "Pay rent", { id: "rent" }), "rent", todayString()));
    const user = userEvent.setup();
    render(<Board />);
    await user.click(screen.getByRole("radio", { name: "Calendar" }));
    await user.click(screen.getByRole("button", { name: /^Pay rent/ }));
    expect(screen.getByRole("dialog", { name: "Pay rent" })).toBeInTheDocument();
  });
});
