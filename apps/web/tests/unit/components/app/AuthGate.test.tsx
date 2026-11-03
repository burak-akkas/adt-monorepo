import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  status: "loading" as "loading" | "anonymous" | "authenticated",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }), usePathname: () => "/" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ status: mocks.status, user: null, logout: vi.fn() }) }));

import { AuthGate } from "@/components/app/AuthGate";
import { UNAUTHORIZED_EVENT } from "@/lib/api-client";

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.status = "loading";
  window.history.replaceState(null, "", "/");
});

const gate = () => (
  <AuthGate>
    <p>board</p>
  </AuthGate>
);

describe("AuthGate", () => {
  it("renders nothing while loading", () => {
    render(gate());
    expect(screen.queryByText("board")).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("redirects an anonymous visitor to login with next", () => {
    mocks.status = "anonymous";
    window.history.replaceState(null, "", "/?board=x");
    render(gate());
    expect(screen.queryByText("board")).not.toBeInTheDocument();
    expect(mocks.replace).toHaveBeenCalledWith("/login?next=%2F%3Fboard%3Dx");
  });

  it("renders the children when authenticated", () => {
    mocks.status = "authenticated";
    render(gate());
    expect(screen.getByText("board")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("treats a 401 event as a logout", () => {
    mocks.status = "authenticated";
    render(gate());
    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    });
    expect(mocks.replace).toHaveBeenCalledWith("/login?next=%2F");
  });
});
