import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Surface } from "@/components/ui/Surface";
import { Toast, ToastAction } from "@/components/ui/Toast";

describe("<Toast />", () => {
  it("is a status region with its children", () => {
    render(
      <Toast>
        <span>Archived 2 cards</span>
      </Toast>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Archived 2 cards");
  });
});

describe("<ToastAction />", () => {
  it("is a named button that calls onClick", async () => {
    const onClick = vi.fn();
    render(<ToastAction onClick={onClick}>Undo</ToastAction>);
    const button = screen.getByRole("button", { name: "Undo" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("underline", "font-semibold");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("<Surface />", () => {
  it("is a named region on the surface color and merges className", () => {
    render(
      <Surface aria-label="Panel" className="text-sm">
        Content
      </Surface>,
    );
    expect(screen.getByRole("region", { name: "Panel" })).toHaveClass("bg-surface", "border-line", "text-sm");
  });
});
