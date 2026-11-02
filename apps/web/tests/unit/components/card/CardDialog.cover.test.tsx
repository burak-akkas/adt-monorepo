import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/board";
import { CardDialog } from "@/components/card/CardDialog";

const card: Card = { id: "a", title: "Write docs", createdAt: "2030-01-01T10:00:00.000Z", priority: "medium" };

function setup(overrides: Partial<Card> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <CardDialog
      card={{ ...card, ...overrides }}
      column="todo"
      onSave={onSave}
      onDelete={vi.fn()}
      onClose={onClose}
      onUpdateBoard={vi.fn()}
    />,
  );
  return { onSave, onClose, user: userEvent.setup() };
}

const group = () => screen.getByRole("radiogroup", { name: "Cover color" });

afterEach(() => vi.restoreAllMocks());

describe("<CardDialog /> cover color", () => {
  it("offers None and eight colors with accessible names, None checked by default", () => {
    setup();
    const radios = within(group()).getAllByRole("radio");
    expect(radios).toHaveLength(9);
    expect(screen.getByRole("radio", { name: "Cover color: Blue" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Cover color: None" })).toBeChecked();
    expect(screen.queryByTestId("cover-preview")).not.toBeInTheDocument();
  });

  it("checks the current color and shows a preview", () => {
    setup({ cover: "green" });
    expect(screen.getByRole("radio", { name: "Cover color: Green" })).toBeChecked();
    expect(screen.getByTestId("cover-preview")).toBeInTheDocument();
  });

  it("saves the chosen color", async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole("radio", { name: "Cover color: Blue" }));
    expect(screen.getByTestId("cover-preview")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ cover: "blue" }));
  });

  it("clears the color with None", async () => {
    const { user, onSave } = setup({ cover: "red" });
    await user.click(screen.getByRole("radio", { name: "Cover color: None" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ cover: undefined }));
    expect(onSave.mock.calls[0][0]).toHaveProperty("cover");
  });

  it("works with the keyboard", async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole("radio", { name: "Cover color: None" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Cover color: Red" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ cover: "red" }));
  });

  it("treats a color change as unsaved and discards it on cancel", async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole("radio", { name: "Cover color: Pink" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const confirm = screen.getByRole("dialog", { name: "Discard changes" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(within(screen.getByRole("dialog", { name: "Discard changes" })).getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not prompt when the color is unchanged", async () => {
    const { user, onClose } = setup({ cover: "teal" });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Discard changes" })).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });
});
