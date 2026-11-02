import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/board";
import { ArchivePanel } from "@/components/panels/ArchivePanel";

function card(id: string, title: string): Card {
  return { id, title, createdAt: "2026-06-10T12:00:00.000Z", priority: "medium" };
}

function renderPanel(cards: Card[], onRestore = vi.fn(), onDelete = vi.fn()) {
  const ui = (list: Card[]) => <ArchivePanel id="archive" cards={list} onRestore={onRestore} onDelete={onDelete} />;
  const result = render(ui(cards));
  return { ...result, rerenderWith: (list: Card[]) => result.rerender(ui(list)), onRestore, onDelete };
}

describe("<ArchivePanel /> count", () => {
  it("shows a singular count for one card", () => {
    renderPanel([card("a", "Alpha")]);
    expect(screen.getByText("1 archived card")).toBeInTheDocument();
  });

  it("shows a plural count for several cards", () => {
    renderPanel([card("a", "Alpha"), card("b", "Beta"), card("c", "Gamma")]);
    expect(screen.getByText("3 archived cards")).toBeInTheDocument();
  });

  it("updates when cards are removed", () => {
    const { rerenderWith } = renderPanel([card("a", "Alpha"), card("b", "Beta")]);
    expect(screen.getByText("2 archived cards")).toBeInTheDocument();
    rerenderWith([card("b", "Beta")]);
    expect(screen.getByText("1 archived card")).toBeInTheDocument();
  });

  it("shows only the empty state, with no count line, when there are no cards", () => {
    renderPanel([]);
    expect(screen.getByText("No archived cards")).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ archived cards?$/)).not.toBeInTheDocument();
  });

  it("keeps the Restore and Delete buttons working with their accessible names", async () => {
    const user = userEvent.setup();
    const { onRestore, onDelete } = renderPanel([card("a", "Alpha")]);
    await user.click(screen.getByRole("button", { name: 'Restore "Alpha"' }));
    await user.click(screen.getByRole("button", { name: 'Delete "Alpha" permanently' }));
    expect(onRestore).toHaveBeenCalledWith("a");
    expect(onDelete).toHaveBeenCalledWith("a");
  });
});
