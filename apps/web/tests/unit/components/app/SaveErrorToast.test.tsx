import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SaveErrorToast } from "@/components/app/SaveErrorToast";

const state = vi.hoisted(() => ({ error: null as string | null, dismiss: vi.fn() }));
vi.mock("@/hooks/useBoard", () => ({ useSaveError: () => state }));

describe("<SaveErrorToast />", () => {
  beforeEach(() => {
    state.error = null;
    state.dismiss.mockReset();
  });

  it("renders nothing without an error", () => {
    const { container } = render(<SaveErrorToast />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the message and dismisses it", async () => {
    state.error = "Could not save, the board was reset to the saved version.";
    render(<SaveErrorToast />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
    await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss" }));
    expect(state.dismiss).toHaveBeenCalledTimes(1);
  });
});
