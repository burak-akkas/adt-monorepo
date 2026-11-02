import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_KEY } from "@/lib/theme";
import { resetThemeStore } from "@/hooks/useTheme";
import { emptyBoard, insightsListIds, MAX_WIP_LIMIT, setWipLimit } from "@/lib/board";
import type { Board } from "@/lib/board";
import { SettingsPanel } from "@/components/panels/SettingsPanel";

function Harness({ initial, onClose }: { initial: Board; onClose: () => void }) {
  const [board, setBoard] = useState(initial);
  return (
    <>
      <SettingsPanel board={board} onClose={onClose} onUpdateBoard={(change) => setBoard(change)} />
      <output data-testid="board">{JSON.stringify({ ids: insightsListIds(board), wip: board.wipLimits ?? {} })}</output>
    </>
  );
}

function renderPanel(board: Board = emptyBoard()) {
  const onClose = vi.fn();
  render(<Harness initial={board} onClose={onClose} />);
  return { onClose };
}

function state() {
  return JSON.parse(screen.getByTestId("board").textContent ?? "{}") as {
    ids: { doing?: string; done?: string };
    wip: Record<string, number>;
  };
}

describe("<SettingsPanel /> version line", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows the version and short commit", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "1.2.3");
    vi.stubEnv("NEXT_PUBLIC_COMMIT_SHA", "a1b2c3d4e5f6");
    renderPanel();
    expect(screen.getByText("Version 1.2.3 · a1b2c3d")).toBeInTheDocument();
  });

  it("shows only the version when the commit is unknown", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "1.2.3");
    vi.stubEnv("NEXT_PUBLIC_COMMIT_SHA", "");
    renderPanel();
    expect(screen.getByText("Version 1.2.3")).toBeInTheDocument();
  });
});

describe("<SettingsPanel />", () => {
  it("is a dialog titled Settings that closes with the Close button", async () => {
    const { onClose } = renderPanel();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has an Import / Export section with Export and Import buttons", () => {
    renderPanel();
    const section = screen.getByRole("region", { name: "Import / Export" });
    expect(within(section).getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Import" })).toBeInTheDocument();
    expect(within(section).getByLabelText("Import board file")).toBeInTheDocument();
  });

  it("shows an error for an invalid import file inside the dialog", async () => {
    renderPanel();
    const file = new File(['{"hello":"world"}'], "other.json", { type: "application/json" });
    await userEvent.upload(screen.getByLabelText("Import board file"), file);
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/not a Kanban board/);
  });

  it("sets and unsets the done and in progress lists", async () => {
    renderPanel();
    await userEvent.selectOptions(screen.getByLabelText("Done list"), "Doing");
    expect(state().ids.done).toBe("doing");
    expect(screen.getByText(/used for insights, archiving and overdue/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Done list"), "Not set");
    expect(state().ids.done).toBeUndefined();
  });

  it("hints when a list is not set", async () => {
    renderPanel();
    expect(screen.queryByText(/Pick the lists that mean/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Done list"), "Not set");
    expect(screen.getByText(/Pick the lists that mean in progress and done/)).toBeInTheDocument();
  });

  it("shows the current WIP limit of each list", () => {
    renderPanel(setWipLimit(emptyBoard(), "doing", 3));
    expect(screen.getByLabelText("WIP limit for Doing")).toHaveValue("3");
    expect(screen.getByText("Limit 3")).toBeInTheDocument();
    expect(screen.getByLabelText("WIP limit for To do")).toHaveValue("");
  });

  it("saves and clears a WIP limit", async () => {
    renderPanel();
    await userEvent.type(screen.getByLabelText("WIP limit for Doing"), "4{Enter}");
    expect(state().wip).toEqual({ doing: 4 });
    expect(screen.getByText("Limit 4")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear WIP limit for Doing" }));
    expect(state().wip).toEqual({});
    expect(screen.getByLabelText("WIP limit for Doing")).toHaveValue("");
  });

  describe("theme", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })),
      );
      localStorage.clear();
      delete document.documentElement.dataset.theme;
      resetThemeStore();
    });
    afterEach(() => vi.unstubAllGlobals());

    it("offers System, Light and Dark with System selected by default", () => {
      renderPanel();
      const group = screen.getByRole("radiogroup", { name: "Theme" });
      expect(within(group).getAllByRole("radio")).toHaveLength(3);
      expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    });

    it("applies and persists the chosen theme", async () => {
      renderPanel();
      await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
      expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    });

    it("shows a saved preference as selected", () => {
      localStorage.setItem(THEME_KEY, "light");
      resetThemeStore();
      renderPanel();
      expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    });
  });

  it.each(["0", "abc", String(MAX_WIP_LIMIT + 1)])("rejects the WIP limit %s", async (value) => {
    renderPanel();
    await userEvent.type(screen.getByLabelText("WIP limit for Doing"), `${value}{Enter}`);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(state().wip).toEqual({});
  });
});
