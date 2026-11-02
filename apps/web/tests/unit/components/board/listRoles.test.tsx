import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyBoard, renameList, setInsightsList } from "@/lib/board";
import { saveBoard } from "../../../support/testStorage";
import { resetBoardStore } from "@/hooks/useBoard";
import { Board } from "@/components/board/Board";
import { TopBar } from "@/components/app/TopBar";

const region = (name: RegExp) => screen.getByRole("region", { name });

describe("<Board /> done and in-progress markers", () => {
  beforeEach(() => resetBoardStore());

  it("marks the default Doing and Done lists only", () => {
    saveBoard(emptyBoard());
    render(<Board />);
    expect(within(region(/^Done/)).getByText("Done list")).toBeInTheDocument();
    expect(within(region(/^Doing/)).getByText("In progress list")).toBeInTheDocument();
    expect(within(region(/^To do/)).queryByText(/list$/)).not.toBeInTheDocument();
  });

  it("keeps the marker on a renamed Done list", () => {
    saveBoard(setInsightsList(renameList(emptyBoard(), "done", "Shipped"), "done", "done"));
    render(<Board />);
    expect(within(region(/^Shipped/)).getByText("Done list")).toBeInTheDocument();
  });

  it("shows no marker when no list is designated", () => {
    saveBoard(setInsightsList(setInsightsList(emptyBoard(), "done", undefined), "doing", undefined));
    render(<Board />);
    expect(screen.queryByText("Done list")).not.toBeInTheDocument();
    expect(screen.queryByText("In progress list")).not.toBeInTheDocument();
  });

  it("moves the marker when the Settings selection changes", async () => {
    saveBoard(emptyBoard());
    render(
      <>
        <TopBar />
        <Board />
      </>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const panel = screen.getByRole("dialog", { name: "Settings" });
    await user.selectOptions(within(panel).getByLabelText("Done list"), "To do");
    expect(within(region(/^To do/)).getByText("Done list")).toBeInTheDocument();
    expect(within(region(/^Done/)).queryByText("Done list")).not.toBeInTheDocument();
  });
});
