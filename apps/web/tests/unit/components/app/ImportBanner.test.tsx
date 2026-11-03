import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportBanner } from "@/components/app/ImportBanner";
import type { LocalImportState } from "@/hooks/useLocalImport";
import { ApiError } from "@/lib/api-client";
import { emptyBoard } from "@/lib/board";
import type { FailedBoard } from "@/lib/localImport";

const failure = (name: string, error: ApiError, transient: boolean): FailedBoard => ({
  id: name,
  name,
  board: emptyBoard(),
  error,
  transient,
});

const done = (imported: number, failed: FailedBoard[] = []): LocalImportState => ({
  phase: "done",
  imported,
  alreadyImported: 0,
  failed,
  email: "a@example.test",
});

afterEach(() => vi.restoreAllMocks());

describe("ImportBanner", () => {
  it("renders nothing when idle, running or empty", () => {
    for (const state of [{ phase: "idle" }, { phase: "running" }, done(0)] as LocalImportState[]) {
      const { container, unmount } = render(<ImportBanner state={state} onRetry={vi.fn()} onDismiss={vi.fn()} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("names the count and the account", () => {
    const { rerender } = render(<ImportBanner state={done(1)} onRetry={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("1 board from this browser was added to your account (a@example.test).");
    rerender(<ImportBanner state={done(3)} onRetry={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("3 boards from this browser were added to your account (a@example.test).");
  });

  it("lists failed boards with their reasons and shows Retry only for transient ones", async () => {
    const onRetry = vi.fn();
    const state = done(0, [
      failure("Offline", new ApiError("network", 0, "Could not reach the server."), true),
      failure("Broken", new ApiError("validation", 400, "Too many cards."), false),
      failure("Huge", new ApiError("validation", 413, "Payload too large."), false),
    ]);
    render(<ImportBanner state={state} onRetry={onRetry} onDismiss={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Offline: Could not reach the server.");
    expect(alert).toHaveTextContent("Broken: Too many cards.");
    expect(alert).toHaveTextContent("Huge: too large to import");
    expect(screen.getAllByRole("button", { name: /^Retry importing/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Retry importing Offline" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("downloads a failed board as JSON", async () => {
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ImportBanner state={done(0, [failure("Broken", new ApiError("validation", 400, "bad"), false)])} onRetry={vi.fn()} onDismiss={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Download Broken" }));
    expect(click).toHaveBeenCalledTimes(1);
    const calls = createObjectURL.mock.calls as unknown as [Blob][];
    expect(calls[0][0]).toBeInstanceOf(Blob);
    expect(await calls[0][0].text()).toContain('"columns"');
  });

  it("dismisses", async () => {
    const onDismiss = vi.fn();
    render(<ImportBanner state={done(2)} onRetry={vi.fn()} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
