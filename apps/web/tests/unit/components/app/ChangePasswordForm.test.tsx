import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { changePassword } = vi.hoisted(() => ({ changePassword: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: { changePassword } }));

import { ChangePasswordForm } from "@/components/app/ChangePasswordForm";

beforeEach(() => {
  changePassword.mockReset();
});

async function fill(current: string, next: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  return user;
}

describe("ChangePasswordForm", () => {
  it("shows a weak password error without calling the server", async () => {
    render(<ChangePasswordForm />);
    const user = await fill("test-password-123", "short");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at least 10 characters");
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("shows an error for a wrong current password", async () => {
    changePassword.mockResolvedValue({ error: { status: 400, code: "INVALID_PASSWORD" } });
    render(<ChangePasswordForm />);
    const user = await fill("wrong-password-1", "a-new-password-1");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Current password is incorrect.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("revokes other sessions, shows success and clears the fields", async () => {
    changePassword.mockResolvedValue({ data: {}, error: null });
    render(<ChangePasswordForm />);
    const user = await fill("test-password-123", "a-new-password-1");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Password changed");
    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: "test-password-123",
      newPassword: "a-new-password-1",
      revokeOtherSessions: true,
    });
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(screen.getByLabelText("New password")).toHaveValue("");
  });

  it("shows a generic error when the call throws", async () => {
    changePassword.mockRejectedValue(new Error("offline"));
    render(<ChangePasswordForm />);
    const user = await fill("test-password-123", "a-new-password-1");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });
});
