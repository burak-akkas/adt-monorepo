import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/Button";

describe("<Button />", () => {
  it("has its accessible name and defaults to type=button", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  });

  it("can be a submit button", () => {
    render(<Button type="submit">Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute("type", "submit");
  });

  it("is activated by click, Enter and Space", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByRole("button", { name: "Go" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("gives each variant its own look and merges className", () => {
    render(
      <>
        <Button variant="primary">Primary</Button>
        <Button variant="danger" className="ml-auto">
          Danger
        </Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Primary" })).toHaveClass("bg-accent");
    const danger = screen.getByRole("button", { name: "Danger" });
    expect(danger).toHaveClass("hover:text-danger", "ml-auto");
    expect(danger).not.toHaveClass("bg-accent");
  });

  it("forwards its ref", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>Ref</Button>);
    expect(ref.current).toBe(screen.getByRole("button", { name: "Ref" }));
  });
});
