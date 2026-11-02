import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "@/components/ui/Dialog";

function setup() {
  const onRequestClose = vi.fn();
  render(
    <Dialog labelledBy="title" onRequestClose={onRequestClose}>
      <h2 id="title">Details</h2>
      <button type="button">Inside</button>
    </Dialog>,
  );
  return { onRequestClose };
}

describe("<Dialog />", () => {
  it("opens as a dialog named by labelledBy", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Details" })).toHaveAttribute("open");
  });

  it("is max-w-lg by default and max-w-3xl for size lg", () => {
    const { unmount } = render(
      <Dialog labelledBy="title" onRequestClose={vi.fn()}>
        <h2 id="title">Details</h2>
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toHaveClass("max-w-lg");
    unmount();
    render(
      <Dialog labelledBy="title" onRequestClose={vi.fn()} size="lg">
        <h2 id="title">Details</h2>
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toHaveClass("max-w-3xl");
    expect(screen.getByRole("dialog")).not.toHaveClass("max-w-lg");
  });

  it("asks to close on Escape (cancel) and keeps the dialog open itself", () => {
    const { onRequestClose } = setup();
    const notPrevented = fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
    expect(notPrevented).toBe(false);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("asks to close on a backdrop click but not on a click inside", async () => {
    const { onRequestClose } = setup();
    await userEvent.setup().click(screen.getByRole("button", { name: "Inside" }));
    expect(onRequestClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });
});
