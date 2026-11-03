import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCard, emptyBoard } from "@/lib/board";
import { serializeBoard } from "@/lib/storage";
import { BoardTransfer } from "@/components/app/BoardTransfer";

const hook = vi.hoisted(() => ({ update: vi.fn(), importBoardFile: vi.fn() }));
vi.mock("@/hooks/useBoard", async () => {
  const { emptyBoard } = await import("@/lib/board");
  return {
    useBoard: () => [emptyBoard(), hook.update] as const,
    useBoards: () => ({ importBoardFile: hook.importBoardFile }),
  };
});

describe("<BoardTransfer /> with server boards", () => {
  beforeEach(() => {
    hook.update.mockReset();
    hook.importBoardFile.mockReset();
  });

  it("adds the imported file as a new board instead of replacing the current one", async () => {
    const user = userEvent.setup();
    render(<BoardTransfer />);
    const board = addCard(emptyBoard(), "Imported card", { id: "imp" });
    const file = new File([serializeBoard(board)], "My export.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("Import board file"), file);

    expect(await screen.findByText("Add the imported board (1 card)?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(hook.importBoardFile).toHaveBeenCalledTimes(1));
    expect(hook.importBoardFile.mock.calls[0][1]).toBe("My export");
    expect(hook.importBoardFile.mock.calls[0][0].columns.todo.map((c: { title: string }) => c.title)).toEqual(["Imported card"]);
    expect(hook.update).not.toHaveBeenCalled();
  });
});
