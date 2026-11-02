import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { addCard, emptyBoard, moveCard, setLabels, setPriority } from "@/lib/board";
import { TableView } from "@/components/views/TableView";

function seed() {
  let b = emptyBoard();
  b = addCard(b, "Banana", { id: "a" });
  b = addCard(b, "Apple", { id: "b" });
  b = addCard(b, "Cherry", { id: "c" });
  b = setPriority(b, "a", "high");
  b = setLabels(b, "b", ["fruit"]);
  b = moveCard(b, "c", "doing");
  return b;
}

const bodyTitles = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent);

describe("<TableView />", () => {
  it("shows all columns and every open card", () => {
    render(<TableView board={seed()} onOpen={() => {}} />);
    for (const name of ["Title", "List", "Priority", "Due date", "Labels", "Checklist", "Last activity"]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }
    expect(bodyTitles()).toHaveLength(3);
  });

  it("sorts with header buttons and sets aria-sort", async () => {
    const user = userEvent.setup();
    render(<TableView board={seed()} onOpen={() => {}} />);
    const header = screen.getByRole("columnheader", { name: "Title" });
    expect(header).not.toHaveAttribute("aria-sort");
    expect(screen.getByRole("columnheader", { name: /Last activity/ })).toHaveAttribute("aria-sort", "descending");

    await user.click(within(header).getByRole("button"));
    expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(bodyTitles()).toEqual(["Apple", "Banana", "Cherry"]);
    expect(screen.getByRole("columnheader", { name: /Last activity/ })).not.toHaveAttribute("aria-sort");

    await user.click(within(header).getByRole("button"));
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(bodyTitles()).toEqual(["Cherry", "Banana", "Apple"]);
  });

  it("sorts from the keyboard", async () => {
    const user = userEvent.setup();
    render(<TableView board={seed()} onOpen={() => {}} />);
    within(screen.getByRole("columnheader", { name: "Priority" })).getByRole("button").focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("columnheader", { name: "Priority" })).toHaveAttribute("aria-sort", "ascending");
    expect(bodyTitles()[2]).toBe("Banana");
  });

  it("filters by list and by label", async () => {
    const user = userEvent.setup();
    render(<TableView board={seed()} onOpen={() => {}} />);
    await user.selectOptions(screen.getByLabelText("Filter table by list"), "Doing");
    expect(bodyTitles()).toEqual(["Cherry"]);
    await user.selectOptions(screen.getByLabelText("Filter table by list"), "All lists");
    await user.selectOptions(screen.getByLabelText("Filter table by label"), "fruit");
    expect(bodyTitles()).toEqual(["Apple"]);
    await user.selectOptions(screen.getByLabelText("Filter table by list"), "Doing");
    expect(screen.getByText("No matching cards")).toBeInTheDocument();
  });

  it("opens a card from the title button (keyboard) and from a row click", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<TableView board={seed()} onOpen={onOpen} />);
    screen.getByRole("button", { name: "Banana" }).focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenLastCalledWith("a");
    await user.click(within(screen.getByRole("button", { name: "Apple" }).closest("tr")!).getByText("To do"));
    expect(onOpen).toHaveBeenLastCalledWith("b");
  });
});
