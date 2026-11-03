import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShareDialog } from "@/components/app/ShareDialog";

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  listMembers: vi.fn(),
  inviteMember: vi.fn(),
  removeMember: vi.fn(),
}));

const { ApiError, listMembers, inviteMember, removeMember } = await import("@/lib/api-client");

const members = [{ id: "m1", email: "one@example.test" }];

function setup() {
  const onClose = vi.fn();
  render(<ShareDialog boardId="b1" boardName="Work" onClose={onClose} />);
  return { user: userEvent.setup(), onClose };
}

const emailField = () => screen.getByRole("textbox", { name: "Email" });

beforeEach(() => {
  vi.mocked(listMembers).mockReset().mockResolvedValue({ owner: { email: "owner@example.test" }, members });
  vi.mocked(inviteMember).mockReset();
  vi.mocked(removeMember).mockReset().mockResolvedValue(undefined);
});

describe("<ShareDialog />", () => {
  it("says that no email is sent and lists who has access", async () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Share board" })).toBeInTheDocument();
    expect(screen.getByText(/No email is sent/)).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "People with access" });
    expect(within(list).getByText("owner@example.test")).toBeInTheDocument();
    expect(within(list).getByText("one@example.test")).toBeInTheDocument();
    expect(listMembers).toHaveBeenCalledWith("b1", expect.any(AbortSignal));
  });

  it("adds a person and clears the field", async () => {
    vi.mocked(inviteMember).mockResolvedValue({ id: "m2", email: "two@example.test" });
    const { user } = setup();
    await screen.findByText("one@example.test");
    await user.type(emailField(), "two@example.test");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(inviteMember).toHaveBeenCalledWith("b1", "two@example.test");
    expect(await screen.findByText("two@example.test")).toBeInTheDocument();
    expect(emailField()).toHaveValue("");
  });

  it("adds a person with the Enter key", async () => {
    vi.mocked(inviteMember).mockResolvedValue({ id: "m2", email: "two@example.test" });
    const { user } = setup();
    await screen.findByText("one@example.test");
    await user.type(emailField(), "two@example.test{Enter}");
    expect(await screen.findByText("two@example.test")).toBeInTheDocument();
  });

  it("removes a person", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Remove one@example.test" }));
    expect(removeMember).toHaveBeenCalledWith("b1", "m1");
    await vi.waitFor(() => expect(screen.queryByText("one@example.test")).not.toBeInTheDocument());
  });

  it("shows the server message for an invalid or own email", async () => {
    vi.mocked(inviteMember).mockRejectedValue(new ApiError("validation", 400, "You already own this board"));
    const { user } = setup();
    await screen.findByText("one@example.test");
    await user.type(emailField(), "owner@example.test");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You already own this board");
    expect(emailField()).toHaveAttribute("aria-invalid", "true");
  });

  it("says a generic validation error means the email is invalid", async () => {
    vi.mocked(inviteMember).mockRejectedValue(new ApiError("validation", 400, "The data was rejected."));
    const { user } = setup();
    await screen.findByText("one@example.test");
    await user.type(emailField(), "nope");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid email address.");
  });

  it("shows an error for a duplicate", async () => {
    vi.mocked(inviteMember).mockRejectedValue(new ApiError("conflict", 409, "Already invited"));
    const { user } = setup();
    await screen.findByText("one@example.test");
    await user.type(emailField(), "one@example.test");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This person already has access.");
  });

  it("asks for an email when the field is empty", async () => {
    const { user } = setup();
    await screen.findByText("one@example.test");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter an email address.");
    expect(inviteMember).not.toHaveBeenCalled();
  });

  it("closes with Done", async () => {
    const { user, onClose } = setup();
    await screen.findByText("one@example.test");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows when the list cannot be loaded", async () => {
    vi.mocked(listMembers).mockRejectedValue(new ApiError("forbidden", 403, "You are not allowed to do this."));
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("You are not allowed to do this.");
  });
});
