import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  importLocalBoards: vi.fn(),
  hasLocalBoards: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ status: "authenticated", user: { id: "u", email: "a@example.test" }, logout: vi.fn() }),
}));
vi.mock("@/lib/localImport", () => ({
  importLocalBoards: mocks.importLocalBoards,
  hasLocalBoards: mocks.hasLocalBoards,
}));

import { LocalImport } from "@/components/app/LocalImport";

const failure = {
  id: "b1",
  name: "Work",
  board: { columns: {}, lists: [], archive: [] },
  error: { status: 503, message: "Service unavailable" },
  transient: true,
};

const page = () => (
  <LocalImport>
    <p>board</p>
  </LocalImport>
);

beforeEach(() => {
  mocks.importLocalBoards.mockReset();
  mocks.hasLocalBoards.mockReset();
});

describe("<LocalImport />", () => {
  it("shows the board at once when nothing is saved in this browser", async () => {
    mocks.hasLocalBoards.mockReturnValue(false);
    render(page());
    expect(await screen.findByText("board")).toBeInTheDocument();
    expect(mocks.importLocalBoards).not.toHaveBeenCalled();
  });

  it("holds the board back until the import has finished, then says what was added", async () => {
    mocks.hasLocalBoards.mockReturnValue(true);
    let finish: (value: unknown) => void = () => {};
    mocks.importLocalBoards.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(page());
    expect(screen.queryByText("board")).not.toBeInTheDocument();
    finish({ status: "done", imported: 2, alreadyImported: 0, failed: [] });
    expect(await screen.findByText("board")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 boards from this browser were added to your account (a@example.test).");
  });

  it("keeps the board usable after a failed import and offers Retry", async () => {
    mocks.hasLocalBoards.mockReturnValue(true);
    mocks.importLocalBoards.mockResolvedValueOnce({ status: "done", imported: 0, alreadyImported: 0, failed: [failure] });
    render(page());
    expect(await screen.findByText("board")).toBeInTheDocument();
    mocks.importLocalBoards.mockResolvedValueOnce({ status: "done", imported: 1, alreadyImported: 0, failed: [] });
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry importing Work" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 board from this browser was added"));
    expect(mocks.importLocalBoards).toHaveBeenCalledTimes(2);
  });
});
