import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/ui";

function setup() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<ConfirmDialog title="Delete thing" message="Really delete it?" confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel} />);
  return { onConfirm, onCancel, user: userEvent.setup() };
}

describe("<ConfirmDialog />", () => {
  it("is a dialog named by its title and shows the message", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Delete thing" })).toHaveAttribute("open");
    expect(screen.getByText("Really delete it?")).toBeInTheDocument();
  });

  it("focuses the safe Cancel action first", () => {
    setup();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("confirms with the confirm button", async () => {
    const { user, onConfirm, onCancel } = setup();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels with the Cancel button, with Escape and with a backdrop click", async () => {
    const { user, onConfirm, onCancel } = setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const dialog = screen.getByRole("dialog");
    const event = createEvent("cancel", dialog, { cancelable: true });
    fireEvent(dialog, event);
    expect(event.defaultPrevented).toBe(true);
    await user.click(dialog);
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("is operable with the keyboard", async () => {
    const { user, onConfirm, onCancel } = setup();
    await user.keyboard("{Tab}{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
