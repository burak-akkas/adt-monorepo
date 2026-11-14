import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssigneeAvatars } from "@/components/card/AssigneeAvatars";

describe("<AssigneeAvatars />", () => {
  it("renders nothing without assignees", () => {
    const { container, rerender } = render(<AssigneeAvatars />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AssigneeAvatars assignees={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an avatar with an accessible name per assignee, with light and dark styles", () => {
    render(<AssigneeAvatars assignees={["a@example.test", "b@example.test"]} />);
    const first = screen.getByRole("listitem", { name: "Assigned to a@example.test" });
    expect(first).toHaveTextContent("A");
    expect(first.className).toContain("bg-zinc-200");
    expect(first.className).toContain("dark:bg-zinc-700");
    expect(screen.getByRole("listitem", { name: "Assigned to b@example.test" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Assignees" })).toBeInTheDocument();
  });

  it("shows three avatars and a +n item with its own name beyond that", () => {
    const emails = ["a", "b", "c", "d", "e"].map((n) => `${n}@example.test`);
    render(<AssigneeAvatars assignees={emails} />);
    expect(screen.getAllByRole("listitem", { name: /^Assigned to / })).toHaveLength(3);
    const more = screen.getByRole("listitem", { name: "2 more assigned: d@example.test, e@example.test" });
    expect(more).toHaveTextContent("+2");
  });

  it("has no overflow item at exactly max", () => {
    render(<AssigneeAvatars assignees={["a@example.test", "b@example.test", "c@example.test"]} />);
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });
});
