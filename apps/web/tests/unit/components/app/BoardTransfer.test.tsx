import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCard, emptyBoard } from "@/lib/board";
import { serializeBoard } from "@/lib/storage";
import { loadBoard, saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { Board } from "@/components/board/Board";
import { BoardTransfer } from "@/components/app/BoardTransfer";

const fileOf = (content: string) => new File([content], "board.json", { type: "application/json" });
const importedBoard = () => addCard(emptyBoard(), "Imported card", { id: "imp" });

function setup() {
  const user = userEvent.setup();
  render(
    <>
      <BoardTransfer />
      <Board />
    </>,
  );
  const input = screen.getByLabelText("Import board file") as HTMLInputElement;
  return { user, input };
}

describe("<BoardTransfer />", () => {
  beforeEach(() => {
    localStorage.clear();
    saveBoard(addCard(emptyBoard(), "Existing card", { id: "old" }));
    resetBoardStore();
  });
  afterEach(() => vi.restoreAllMocks());

  it("has accessible Export and Import buttons", () => {
    setup();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
  });

  it("replaces the board after confirming a valid file", async () => {
    const { user, input } = setup();

    await user.upload(input, fileOf(serializeBoard(importedBoard())));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(/replace the current board/i);
    expect(screen.getByText("Existing card")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Replace" }));

    expect(screen.getByText("Imported card")).toBeInTheDocument();
    expect(screen.queryByText("Existing card")).not.toBeInTheDocument();
    expect(loadBoard().columns.todo.map((c) => c.title)).toEqual(["Imported card"]);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("imports an old file without priority or due date", async () => {
    const { user, input } = setup();
    const old = { columns: { todo: [{ id: "o", title: "Old file card", createdAt: "2024-01-01T00:00:00.000Z" }], doing: [], done: [] } };

    await user.upload(input, fileOf(JSON.stringify(old)));
    await user.click(await screen.findByRole("button", { name: "Replace" }));

    expect(screen.getByText("Old file card")).toBeInTheDocument();
    expect(loadBoard().columns.todo[0].priority).toBe("medium");
  });

  it("leaves the board untouched when cancelled, and allows picking the same file again", async () => {
    const { user, input } = setup();
    const file = fileOf(serializeBoard(importedBoard()));

    await user.upload(input, file);
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("Existing card")).toBeInTheDocument();
    expect(loadBoard().columns.todo[0].title).toBe("Existing card");

    await user.upload(input, file);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("shows an alert for an invalid file and keeps the board", async () => {
    const { user, input } = setup();

    await user.upload(input, fileOf('{"hello":"world"}'));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not a kanban board/i);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("Existing card")).toBeInTheDocument();

    await user.upload(input, fileOf("not json"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/not valid json/i));
    expect(loadBoard().columns.todo[0].title).toBe("Existing card");
  });

  it("downloads the board as a dated JSON file", async () => {
    const { user } = setup();
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(/^kanban-board-\d{4}-\d{2}-\d{2}\.json$/);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
