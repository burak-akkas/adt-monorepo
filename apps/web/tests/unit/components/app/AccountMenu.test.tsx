import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useAuth, logout } = vi.hoisted(() => ({ useAuth: vi.fn(), logout: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth }));

import { AccountMenu } from "@/components/app/AccountMenu";

beforeEach(() => {
  logout.mockReset();
});

describe("AccountMenu", () => {
  it("shows a loading indicator and no links while loading", () => {
    useAuth.mockReturnValue({ status: "loading", user: null, logout });
    render(<AccountMenu />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading account");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows Log in and Register links when anonymous", () => {
    useAuth.mockReturnValue({ status: "anonymous", user: null, logout });
    render(<AccountMenu />);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Register" })).toHaveAttribute("href", "/register");
  });

  it("shows the email and a Log out button when authenticated", async () => {
    useAuth.mockReturnValue({ status: "authenticated", user: { id: "1", email: "a@example.test" }, logout });
    render(<AccountMenu />);
    expect(screen.getByText("a@example.test")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
    expect(screen.queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));
    expect(logout).toHaveBeenCalled();
  });
});
