import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Menu } from "@/components/ui";

function setup() {
  const user = userEvent.setup();
  const onA = vi.fn();
  const onB = vi.fn();
  const onC = vi.fn();
  render(
    <>
      <Menu
        label="Actions"
        icon="⋯"
        items={[
          { label: "Alpha", onSelect: onA },
          { label: "Beta", onSelect: onB, disabled: true },
          { label: "Gamma", onSelect: onC },
        ]}
      />
      <button>Outside</button>
    </>,
  );
  return { user, onA, onB, onC };
}

const trigger = () => screen.getByRole("button", { name: "Actions" });
const item = (name: string) => screen.getByRole("menuitem", { name });

describe("<Menu />", () => {
  it("has a collapsed trigger with menu semantics", () => {
    setup();
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens on click and focuses the first item", async () => {
    const { user } = setup();
    await user.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(item("Alpha")).toHaveFocus();
  });

  it.each([["{Enter}"], [" "], ["{ArrowDown}"]])("opens with %j from the keyboard", async (key) => {
    const { user } = setup();
    await user.tab();
    expect(trigger()).toHaveFocus();
    await user.keyboard(key);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(item("Alpha")).toHaveFocus();
  });

  it("opens on the last item with ArrowUp", async () => {
    const { user } = setup();
    await user.tab();
    await user.keyboard("{ArrowUp}");
    expect(item("Gamma")).toHaveFocus();
  });

  it("moves with arrows (wrapping), Home and End, skipping disabled items", async () => {
    const { user } = setup();
    await user.click(trigger());
    await user.keyboard("{ArrowDown}");
    expect(item("Gamma")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item("Alpha")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(item("Gamma")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(item("Alpha")).toHaveFocus();
    await user.keyboard("{End}");
    expect(item("Gamma")).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const { user } = setup();
    await user.click(trigger());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("closes on an outside click", async () => {
    const { user } = setup();
    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Tab", async () => {
    const { user } = setup();
    await user.click(trigger());
    await user.tab();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("selects an item with Enter, closing the menu first", async () => {
    const { user, onA } = setup();
    await user.click(trigger());
    await user.keyboard("{Enter}");
    expect(onA).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("announces disabled items and ignores selecting them", async () => {
    const { user, onB } = setup();
    await user.click(trigger());
    expect(item("Beta")).toHaveAttribute("aria-disabled", "true");
    await user.click(item("Beta"));
    expect(onB).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});
