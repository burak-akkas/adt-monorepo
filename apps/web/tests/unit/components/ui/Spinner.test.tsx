import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "@/components/ui";

describe("<Spinner />", () => {
  it("is decorative without a label", () => {
    const { container } = render(<Spinner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("is announced as a status with a label", () => {
    render(<Spinner label="Loading account" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading account");
  });

  it("stops spinning for reduced motion and follows the text colour", () => {
    const { container } = render(<Spinner size="lg" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("animate-spin", "motion-reduce:animate-none", "size-8");
    expect(svg?.querySelector("circle")).toHaveAttribute("stroke", "currentColor");
  });
});
