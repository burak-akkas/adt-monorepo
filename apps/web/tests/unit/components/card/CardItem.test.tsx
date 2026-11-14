import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardItem } from "@/components/card/CardItem";
import type { Card } from "@/lib/board";

const card = (extra: Partial<Card> = {}): Card => ({
  id: "a",
  title: "Task",
  createdAt: "2026-01-01T00:00:00.000Z",
  priority: "medium",
  ...extra,
});

const renderCard = (c: Card) =>
  render(
    <ul>
      <CardItem card={c} dueStatus={null} onOpen={() => {}} />
    </ul>,
  );

describe("<CardItem /> assignees", () => {
  it("shows assignee avatars", () => {
    renderCard(card({ assignees: ["a@example.test"] }));
    expect(screen.getByRole("listitem", { name: "Assigned to a@example.test" })).toBeInTheDocument();
  });

  it("shows an overflow item for more than three", () => {
    renderCard(card({ assignees: ["a", "b", "c", "d", "e"].map((n) => `${n}@example.test`) }));
    expect(screen.getByRole("listitem", { name: /^2 more assigned/ })).toHaveTextContent("+2");
  });

  it("renders a card without the field", () => {
    renderCard(card());
    expect(screen.getByRole("button", { name: "Task" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Assignees" })).not.toBeInTheDocument();
  });
});
