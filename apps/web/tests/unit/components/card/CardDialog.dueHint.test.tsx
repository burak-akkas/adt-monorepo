import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { todayString, type Card } from "@/lib/board";
import { CardDialog } from "@/components/card/CardDialog";

const card: Card = { id: "a", title: "Write docs", createdAt: "2030-01-01T10:00:00.000Z", priority: "medium" };

function setup(overrides: Partial<Card> = {}) {
  render(
    <CardDialog
      card={{ ...card, ...overrides }}
      column="todo"
      onSave={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
      onUpdateBoard={vi.fn()}
    />,
  );
  return userEvent.setup();
}

describe("<CardDialog /> relative due date hint", () => {
  it("shows nothing when no due date is set", () => {
    setup();
    expect(screen.queryByTestId("due-hint")).not.toBeInTheDocument();
  });

  it("shows a hint for the current due date", () => {
    setup({ dueDate: "2000-01-01" });
    expect(screen.getByTestId("due-hint")).toHaveTextContent(/^Overdue by \d+ days$/);
  });

  it("updates when the date changes and disappears when cleared", async () => {
    const user = setup({ dueDate: "2000-01-01" });
    const input = screen.getByLabelText("Due date", { exact: true });
    await user.clear(input);
    await user.type(input, todayString());
    expect(screen.getByTestId("due-hint")).toHaveTextContent("Due today");
    await user.click(screen.getByRole("button", { name: "Clear due date" }));
    expect(screen.queryByTestId("due-hint")).not.toBeInTheDocument();
  });
});
