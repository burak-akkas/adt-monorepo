import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteUser, push } = vi.hoisted(() => ({ deleteUser: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: { deleteUser } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { DeleteAccountSection } from "@/components/app/DeleteAccountSection";

beforeEach(() => {
  deleteUser.mockReset();
  push.mockReset();
});

async function startDelete(password: string) {
  const user = userEvent.setup();
  if (password) await user.type(screen.getByLabelText("Password to confirm deletion"), password);
  await user.click(screen.getByRole("button", { name: "Delete account" }));
  return user;
}

describe("DeleteAccountSection", () => {
  it("warns that deletion cannot be undone", () => {
    render(<DeleteAccountSection />);
    expect(screen.getByText(/cannot be\s+undone/)).toBeInTheDocument();
  });

  it("requires a password before asking for confirmation", async () => {
    render(<DeleteAccountSection />);
    await startDelete("");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your current password.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("deletes nothing until the dialog is confirmed, and Cancel backs out", async () => {
    render(<DeleteAccountSection />);
    const user = await startDelete("test-password-123");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(deleteUser).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("shows an error for a wrong password and stays on the page", async () => {
    deleteUser.mockResolvedValue({ error: { status: 400, code: "INVALID_PASSWORD" } });
    render(<DeleteAccountSection />);
    const user = await startDelete("wrong-password-1");
    await user.click(screen.getByRole("button", { name: "Yes, delete my account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Current password is incorrect.");
    expect(push).not.toHaveBeenCalled();
  });

  it("deletes with the password and returns home", async () => {
    deleteUser.mockResolvedValue({ data: { success: true }, error: null });
    render(<DeleteAccountSection />);
    const user = await startDelete("test-password-123");
    await user.click(screen.getByRole("button", { name: "Yes, delete my account" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(deleteUser).toHaveBeenCalledWith({ password: "test-password-123" });
  });
});
