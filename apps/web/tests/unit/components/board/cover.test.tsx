import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { addCard, emptyBoard, setCover } from "@/lib/board";
import { saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { Board } from "@/components/board/Board";

describe("<Board /> cover color", () => {
  beforeEach(() => {
    resetBoardStore();
    let board = addCard(emptyBoard(), "Colored", { id: "a" });
    board = addCard(board, "Plain", { id: "b" });
    saveBoard(setCover(board, "a", "blue"));
  });

  const item = (title: string) => screen.getByRole("button", { name: title }).closest("li") as HTMLElement;

  it("shows a stripe and an accessible description only on colored cards", () => {
    render(<Board />);
    const colored = item("Colored");
    expect(within(colored).getByTestId("cover-stripe")).toHaveAttribute("data-cover", "blue");
    expect(colored).toHaveAccessibleDescription("Cover color: Blue");
    const plain = item("Plain");
    expect(within(plain).queryByTestId("cover-stripe")).not.toBeInTheDocument();
    expect(plain).not.toHaveAttribute("aria-describedby");
  });

  it("sets and clears the color from the dialog", async () => {
    const user = userEvent.setup();
    render(<Board />);
    await user.click(screen.getByRole("button", { name: "Plain" }));
    await user.click(screen.getByRole("radio", { name: "Cover color: Orange" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(item("Plain")).toHaveAccessibleDescription("Cover color: Orange");

    await user.click(screen.getByRole("button", { name: "Plain" }));
    await user.click(screen.getByRole("radio", { name: "Cover color: None" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(within(item("Plain")).queryByTestId("cover-stripe")).not.toBeInTheDocument();
  });
});
