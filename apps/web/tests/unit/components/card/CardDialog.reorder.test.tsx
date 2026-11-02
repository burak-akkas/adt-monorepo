import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/board";
import { CardDialog } from "@/components/card/CardDialog";

const card: Card = { id: "a", title: "Write docs", createdAt: "2030-01-01T10:00:00.000Z", priority: "medium" };

function setup(props: { canMoveToTop?: boolean; canMoveToBottom?: boolean } = {}) {
  const onMoveToTop = vi.fn();
  const onMoveToBottom = vi.fn();
  const onClose = vi.fn();
  render(
    <CardDialog
      card={card}
      column="todo"
      onSave={vi.fn()}
      onDelete={vi.fn()}
      onMoveToTop={onMoveToTop}
      onMoveToBottom={onMoveToBottom}
      onClose={onClose}
      onUpdateBoard={vi.fn()}
      {...props}
    />,
  );
  return { onMoveToTop, onMoveToBottom, onClose, user: userEvent.setup() };
}

describe("<CardDialog /> move to top / bottom", () => {
  it("calls the callbacks and keeps the dialog open", async () => {
    const { onMoveToTop, onMoveToBottom, onClose, user } = setup();
    await user.click(screen.getByRole("button", { name: "Move to top" }));
    await user.click(screen.getByRole("button", { name: "Move to bottom" }));
    expect(onMoveToTop).toHaveBeenCalledTimes(1);
    expect(onMoveToBottom).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("disables the buttons per the can* props", () => {
    setup({ canMoveToTop: false, canMoveToBottom: false });
    expect(screen.getByRole("button", { name: "Move to top" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move to bottom" })).toBeDisabled();
  });

  it("is not rendered without the callbacks", () => {
    render(<CardDialog card={card} column="todo" onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} onUpdateBoard={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Move to top" })).toBeNull();
  });
});
