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
  it("renders nothing while loading", () => {
    useAuth.mockReturnValue({ status: "loading", user: null, logout });
    const { container } = render(<AccountMenu />);
    expect(container).toBeEmptyDOMElement();
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
    expect(screen.queryByRole("link", { name: "Log in" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));
    expect(logout).toHaveBeenCalled();
  });
});
