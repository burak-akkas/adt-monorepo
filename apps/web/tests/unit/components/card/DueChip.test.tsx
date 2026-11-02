import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DueChip } from "@/components/card/DueChip";

describe("DueChip", () => {
  it.each([
    ["overdue", /Overdue/],
    ["today", /Due today/],
    ["tomorrow", /Due tomorrow/],
  ] as const)("spells out the %s status as text", (status, text) => {
    render(<DueChip status={status} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
