import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { addCard, addList, emptyBoard, moveCard, setDueDate, setWipLimit } from "@/lib/board";
import { saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { Board } from "@/components/board/Board";

const column = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}`) });

function boardWith(titles: string[], doing: number, limit?: number) {
  let board = emptyBoard();
  titles.forEach((title, i) => {
    board = addCard(board, title, { id: `c${i}` });
    if (i < doing) {
      board = moveCard(board, `c${i}`, "doing");
    }
  });
  if (limit !== undefined) {
    board = setWipLimit(board, "doing", limit);
  }
  saveBoard(board);
}

describe("WIP limits in <Board />", () => {
  beforeEach(() => resetBoardStore());

  it("shows only the count when there is no limit", () => {
    boardWith(["A", "B"], 2);
    render(<Board />);
    expect(screen.getByRole("heading", { name: "Doing2" })).toBeInTheDocument();
  });

  it("shows count / limit for a limit set in Settings", () => {
    boardWith(["A", "B"], 2, 4);
    render(<Board />);
    expect(screen.getByRole("heading", { name: "Doing2 / 4" })).toBeInTheDocument();
    expect(screen.queryByText(/limit by/)).not.toBeInTheDocument();
    expect(screen.queryByText("At limit")).not.toBeInTheDocument();
  });

  it("has no limit editor in the column header", () => {
    boardWith(["A"], 1, 3);
    render(<Board />);
    expect(screen.queryByRole("button", { name: /WIP limit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /(Set|Edit) limit/ })).not.toBeInTheDocument();
  });

  it("flags the at-limit state with text", () => {
    boardWith(["A", "B"], 2, 2);
    render(<Board />);
    expect(within(column("Doing")).getByText("At limit")).toBeInTheDocument();
  });

  it("flags the over-limit state with the number", () => {
    boardWith(["A", "B", "C"], 3, 1);
    render(<Board />);
    expect(within(column("Doing")).getByText("Over limit by 2")).toBeInTheDocument();
  });

  it("is never blocked: moving into a full column works and warns", async () => {
    const user = userEvent.setup();
    boardWith(["A", "B"], 1, 1);
    render(<Board />);
    expect(screen.getByText("At limit")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "B" }));
    await user.selectOptions(within(screen.getByRole("dialog")).getByLabelText("Status"), "Doing");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    expect(within(column("Doing")).getByText("B")).toBeInTheDocument();
    expect(screen.getByText("Over limit by 1")).toBeInTheDocument();
  });

  it("compares the real count to the limit while searching", async () => {
    const user = userEvent.setup();
    boardWith(["Alpha", "Beta", "Gamma"], 3, 3);
    render(<Board />);

    await user.type(screen.getByLabelText("Search cards"), "Alpha");
    expect(screen.getByRole("heading", { name: "Doing3 / 3" })).toBeInTheDocument();
    expect(screen.getByText("At limit")).toBeInTheDocument();
  });
});

describe("list name tooltip", () => {
  const LONG = "Quarterly roadmap review items";

  beforeEach(() => resetBoardStore());

  it("puts the full name, without the count, in a title on the expanded header", () => {
    saveBoard(addCard(addList(emptyBoard(), LONG, { id: "r" }), "Task", { id: "t" }));
    render(<Board />);

    const heading = screen.getByRole("heading", { name: new RegExp(`^${LONG}`) });
    const name = within(heading).getByText(LONG);
    expect(name).toHaveAttribute("title", LONG);
  });

  it("puts the full name in a title on the collapsed header", async () => {
    const user = userEvent.setup();
    saveBoard(addList(emptyBoard(), LONG, { id: "r" }));
    render(<Board />);

    await user.click(screen.getByRole("button", { name: `Collapse ${LONG}` }));
    const heading = screen.getByRole("heading", { name: new RegExp(`^${LONG}`) });
    expect(within(heading).getByText(LONG)).toHaveAttribute("title", LONG);
  });
});

describe("overdue badge", () => {
  beforeEach(() => resetBoardStore());

  function overdueBoard() {
    let board = addCard(emptyBoard(), "Late", { id: "l" });
    board = addCard(board, "Later", { id: "m" });
    board = addCard(board, "Fine", { id: "f" });
    board = setDueDate(board, "l", "2000-01-01");
    board = setDueDate(board, "m", "2000-01-02");
    saveBoard(board);
  }

  it("shows 'N overdue' next to the count and hides it at zero", () => {
    overdueBoard();
    render(<Board />);
    expect(within(column("To do")).getByText("2 overdue")).toBeInTheDocument();
    expect(within(column("Doing")).queryByText(/overdue/)).not.toBeInTheDocument();
  });

  it("stays visible when the list is collapsed or filtered", async () => {
    const user = userEvent.setup();
    overdueBoard();
    render(<Board />);
    await user.type(screen.getByLabelText("Search cards"), "Fine");
    expect(within(column("To do")).getByText("2 overdue")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Collapse To do" }));
    expect(within(column("To do")).getByText("2 overdue")).toBeInTheDocument();
  });

  it("is never shown on the done list", () => {
    saveBoard(setDueDate(moveCard(addCard(emptyBoard(), "Old", { id: "o" }), "o", "done"), "o", "2000-01-01"));
    render(<Board />);
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });
});

describe("column header icon buttons", () => {
  beforeEach(() => resetBoardStore());

  it("collapse is an icon-only button with a name, a tooltip and aria-expanded", async () => {
    const user = userEvent.setup();
    boardWith(["A"], 1);
    render(<Board />);

    const collapse = screen.getByRole("button", { name: "Collapse Doing", expanded: true });
    expect(collapse).toHaveAttribute("title", "Collapse Doing");
    expect(collapse).toHaveTextContent("");
    await user.click(collapse);
    const expand = screen.getByRole("button", { name: "Expand Doing", expanded: false });
    expect(expand).toHaveAttribute("title", "Expand Doing");
    expect(expand).toHaveTextContent("");
  });

  it("archive is an icon-only button, disabled when empty and shows the undo toast", async () => {
    const user = userEvent.setup();
    boardWith(["A"], 1);
    render(<Board />);

    expect(screen.getByRole("button", { name: "Archive all cards in To do" })).toBeDisabled();
    const archive = screen.getByRole("button", { name: "Archive all cards in Doing" });
    expect(archive).toHaveAttribute("title", "Archive all cards in Doing");
    expect(archive).toHaveTextContent("");
    await user.click(archive);
    expect(screen.getByRole("status")).toHaveTextContent("Archived 1 card");
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });
});
