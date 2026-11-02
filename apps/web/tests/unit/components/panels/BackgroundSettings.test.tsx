import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { emptyBoard } from "@/lib/board";
import type { Board } from "@/lib/board";
import { BackgroundSettings } from "@/components/panels/BackgroundSettings";

function Harness({ initial }: { initial: Board }) {
  const [board, setBoard] = useState(initial);
  return (
    <>
      <BackgroundSettings board={board} onUpdateBoard={(change) => setBoard(change)} />
      <output data-testid="background">{JSON.stringify(board.background ?? null)}</output>
    </>
  );
}

const background = () => JSON.parse(screen.getByTestId("background").textContent ?? "null") as unknown;

describe("<BackgroundSettings />", () => {
  it("sets a color from the color picker", () => {
    render(<Harness initial={emptyBoard()} />);
    fireEvent.change(screen.getByLabelText("Background color"), { target: { value: "#336699" } });
    expect(background()).toEqual({ type: "color", value: "#336699" });
  });

  it("sets an image URL by keyboard and replaces the color", async () => {
    render(<Harness initial={{ ...emptyBoard(), background: { type: "color", value: "#336699" } }} />);
    await userEvent.type(screen.getByLabelText("Background image URL"), "https://example.com/a.jpg{Enter}");
    expect(background()).toEqual({ type: "image", url: "https://example.com/a.jpg" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an alert and saves nothing for an invalid or non-http URL", async () => {
    render(<Harness initial={emptyBoard()} />);
    await userEvent.type(screen.getByLabelText("Background image URL"), "javascript:alert(1){Enter}");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(background()).toBeNull();
  });

  it("resets the background", async () => {
    render(<Harness initial={{ ...emptyBoard(), background: { type: "image", url: "https://example.com/a.jpg" } }} />);
    expect(screen.getByLabelText("Background image URL")).toHaveValue("https://example.com/a.jpg");
    await userEvent.click(screen.getByRole("button", { name: "Reset background" }));
    expect(background()).toBeNull();
    expect(screen.getByLabelText("Background image URL")).toHaveValue("");
  });
});
