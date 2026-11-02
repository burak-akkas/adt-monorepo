import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LabelChip } from "@/components/card/LabelChip";

describe("<LabelChip />", () => {
  it("is plain text without onClick", () => {
    render(<LabelChip label="Bug" />);
    expect(screen.getByText("Bug")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is a named button with onClick", async () => {
    const onClick = vi.fn();
    render(<LabelChip label="Bug" onClick={onClick} />);
    await userEvent.setup().click(screen.getByRole("button", { name: 'Filter by label "Bug"' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("uses the same color for the same name in any case", () => {
    render(
      <>
        <LabelChip label="Bug" />
        <LabelChip label="bug" />
      </>,
    );
    expect(screen.getByText("Bug").className).toBe(screen.getByText("bug").className);
  });
});
