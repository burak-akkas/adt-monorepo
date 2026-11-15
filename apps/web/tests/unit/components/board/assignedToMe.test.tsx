import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCard, assignToCard, emptyBoard, setLabels, unassignFromCard } from "@/lib/board";
import { saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { Board } from "@/components/board/Board";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ status: "authenticated", user: { id: "u1", email: "Me@Example.test" }, logout: vi.fn() }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  listMembers: vi.fn().mockResolvedValue({
    owner: { email: "me@example.test" },
    members: [{ id: "m1", email: "other@example.test" }],
  }),
}));

const column = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}`) });
const toggle = () => screen.getByRole("button", { name: /^Assigned to me/ });

function seed() {
  let board = emptyBoard();
  board = addCard(board, "Fix crash", { id: "a" });
  board = addCard(board, "Style page", { id: "b" });
  board = addCard(board, "Other's task", { id: "c" });
  board = addCard(board, "Plain", { id: "d" });
  board = assignToCard(board, "a", "me@example.test");
  board = assignToCard(board, "b", "me@example.test");
  board = assignToCard(board, "c", "other@example.test");
  board = setLabels(board, "a", ["bug"]);
  board = setLabels(board, "b", ["design"]);
  saveBoard(board);
}

describe("<Board /> assigned to me", () => {
  beforeEach(() => {
    resetBoardStore();
    seed();
  });

  it("shows only my cards and combines with search and the label filter", async () => {
    const user = userEvent.setup();
    render(<Board />);
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(toggle()).toHaveTextContent("Assigned to me: 2");

    await user.click(toggle());
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    const todo = column("To do");
    expect(within(todo).getByText("Fix crash")).toBeInTheDocument();
    expect(within(todo).getByText("Style page")).toBeInTheDocument();
    expect(within(todo).queryByText("Other's task")).not.toBeInTheDocument();
    expect(within(todo).queryByText("Plain")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Search cards"), "style");
    expect(within(column("To do")).queryByText("Fix crash")).not.toBeInTheDocument();
    expect(within(column("To do")).getByText("Style page")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    await user.selectOptions(screen.getByLabelText("Filter by label"), "bug");
    expect(within(column("To do")).getByText("Fix crash")).toBeInTheDocument();
    expect(within(column("To do")).queryByText("Style page")).not.toBeInTheDocument();

    // Turning the toggle off shows every card again.
    await user.click(screen.getByRole("button", { name: "Clear label filter" }));
    await user.click(toggle());
    expect(within(column("To do")).getByText("Plain")).toBeInTheDocument();
  });

  it("turns itself off when no card is assigned to me any more", async () => {
    const user = userEvent.setup();
    render(<Board />);
    await user.click(toggle());

    await user.click(screen.getByRole("button", { name: "Fix crash" }));
    const dialog = screen.getByRole("dialog", { name: "Fix crash" });
    await user.click(await within(dialog).findByRole("checkbox", { name: "me@example.test" }));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Style page" }));
    const second = screen.getByRole("dialog", { name: "Style page" });
    await user.click(await within(second).findByRole("checkbox", { name: "me@example.test" }));
    await user.click(within(second).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /^Assigned to me/ })).not.toBeInTheDocument());
    expect(within(column("To do")).getByText("Plain")).toBeInTheDocument();
    expect(within(column("To do")).getByText("Other's task")).toBeInTheDocument();
  });

  it("is hidden when nothing is assigned to me", () => {
    resetBoardStore();
    let board = addCard(emptyBoard(), "Plain", { id: "d" });
    board = assignToCard(board, "d", "other@example.test");
    board = unassignFromCard(board, "d", "nobody@example.test");
    saveBoard(board);
    render(<Board />);
    expect(screen.queryByRole("button", { name: /^Assigned to me/ })).not.toBeInTheDocument();
  });
});
