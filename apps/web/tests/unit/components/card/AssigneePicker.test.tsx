import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssigneePicker } from "@/components/card/AssigneePicker";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  listMembers: vi.fn(),
}));

const { listMembers } = await import("@/lib/api-client");

function setup(assignees: string[] = []) {
  const onAssign = vi.fn();
  const onUnassign = vi.fn();
  render(<AssigneePicker boardId="b1" assignees={assignees} onAssign={onAssign} onUnassign={onUnassign} />);
  return { onAssign, onUnassign, user: userEvent.setup() };
}

describe("<AssigneePicker />", () => {
  beforeEach(() => {
    vi.mocked(listMembers).mockResolvedValue({
      owner: { email: "Owner@example.test" },
      members: [
        { id: "m1", email: "a@example.test" },
        { id: "m2", email: "OWNER@example.test" },
      ],
    });
  });
  afterEach(() => vi.resetAllMocks());

  it("lists the owner and members once each, lower-cased", async () => {
    setup();
    const group = await screen.findByRole("group", { name: "Assignees" });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox").map((c) => c.closest("label")?.textContent)).toEqual([
      "owner@example.test",
      "a@example.test",
    ]);
    expect(listMembers).toHaveBeenCalledWith("b1", expect.any(AbortSignal));
  });

  it("checks assigned people and assigns or removes on click", async () => {
    const { user, onAssign, onUnassign } = setup(["a@example.test"]);
    expect(await screen.findByRole("checkbox", { name: "a@example.test" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "owner@example.test" })).not.toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "owner@example.test" }));
    expect(onAssign).toHaveBeenCalledWith("owner@example.test");
    await user.click(screen.getByRole("checkbox", { name: "a@example.test" }));
    expect(onUnassign).toHaveBeenCalledWith("a@example.test");
  });

  it("supports several people at once", async () => {
    setup(["a@example.test", "owner@example.test"]);
    expect(await screen.findByRole("checkbox", { name: "a@example.test" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "owner@example.test" })).toBeChecked();
  });

  it("still lists an assignee who is no longer a member so they can be removed", async () => {
    const { user, onUnassign } = setup(["gone@example.test"]);
    const gone = await screen.findByRole("checkbox", { name: "gone@example.test" });
    expect(gone).toBeChecked();
    await user.click(gone);
    expect(onUnassign).toHaveBeenCalledWith("gone@example.test");
  });

  it("shows a message instead of the picker when the members cannot be loaded", async () => {
    vi.mocked(listMembers).mockRejectedValue(new Error("boom"));
    setup();
    expect(await screen.findByText("Could not load board members.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("checkbox")).not.toBeInTheDocument());
    expect(screen.queryByRole("group", { name: "Assignees" })).not.toBeInTheDocument();
  });
});
