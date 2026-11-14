import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BoardStats } from "@/lib/board";
import { SummaryBar } from "@/components/board/SummaryBar";

const stats: BoardStats = { total: 4, done: 1, percentDone: 25, overdue: 0, dueToday: 0, highOpen: 0 };

function setup(props: { count: number; only?: boolean }) {
  const onToggleAssignedToMe = vi.fn();
  render(
    <SummaryBar
      stats={stats}
      overdueOnly={false}
      onToggleOverdue={vi.fn()}
      dueTodayOnly={false}
      onToggleDueToday={vi.fn()}
      assignedToMeCount={props.count}
      assignedToMeOnly={props.only ?? false}
      onToggleAssignedToMe={onToggleAssignedToMe}
      collapsed={false}
      onToggleCollapsed={vi.fn()}
    />,
  );
  return { onToggleAssignedToMe };
}

describe("<SummaryBar /> assigned to me", () => {
  it("is hidden when no card is assigned to me", () => {
    setup({ count: 0 });
    expect(screen.queryByRole("button", { name: /Assigned to me/ })).not.toBeInTheDocument();
  });

  it("is an unpressed toggle with an accessible name and calls the handler", async () => {
    const { onToggleAssignedToMe } = setup({ count: 2 });
    const button = screen.getByRole("button", { name: "Assigned to me: 2. Show only cards assigned to me" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveTextContent("Assigned to me: 2");
    await userEvent.setup().click(button);
    expect(onToggleAssignedToMe).toHaveBeenCalledTimes(1);
  });

  it("is pressed while the filter is on", () => {
    setup({ count: 2, only: true });
    expect(screen.getByRole("button", { name: "Assigned to me: 2. Show all cards" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
