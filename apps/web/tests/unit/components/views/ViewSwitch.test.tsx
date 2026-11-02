import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ViewSwitch } from "@/components/views/ViewSwitch";

describe("<ViewSwitch />", () => {
  it("is a named group with a single selected option", () => {
    render(<ViewSwitch value="table" onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "View" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Table" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Board" })).not.toBeChecked();
  });

  it("calls onChange on click", async () => {
    const onChange = vi.fn();
    render(<ViewSwitch value="board" onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("radio", { name: "Table" }));
    expect(onChange).toHaveBeenCalledWith("table");
  });

  it("is operable with the keyboard", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ViewSwitch value="board" onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole("radio", { name: "Board" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("calendar");
  });

  it("offers Board, Calendar and Table", async () => {
    const onChange = vi.fn();
    render(<ViewSwitch value="board" onChange={onChange} />);
    expect(screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual(["board", "calendar", "table"]);
    await userEvent.setup().click(screen.getByRole("radio", { name: "Calendar" }));
    expect(onChange).toHaveBeenCalledWith("calendar");
  });
});
