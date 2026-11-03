import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ ready: false }));
vi.mock("@/hooks/useBoard", async () => {
  const { emptyBoard } = await import("@/lib/board");
  return {
    useBoard: () => [emptyBoard(), vi.fn()] as const,
    useBoards: () => ({ ready: state.ready, boards: [], currentId: "x" }),
    useSaveError: () => ({ error: null, dismiss: vi.fn() }),
  };
});

import { Board } from "@/components/board/Board";

describe("<Board /> while the boards load", () => {
  it("shows a loading message and no way to add a card", () => {
    state.ready = false;
    render(<Board />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your board");
    expect(screen.queryByLabelText("New card title")).not.toBeInTheDocument();
  });

  it("shows the board once it is ready", () => {
    state.ready = true;
    render(<Board />);
    expect(screen.queryByText("Loading your board…")).not.toBeInTheDocument();
    expect(screen.getByLabelText("New card title")).toBeInTheDocument();
  });
});
