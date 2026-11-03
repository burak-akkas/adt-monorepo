import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  status: "loading" as "loading" | "anonymous" | "authenticated",
  getSession: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { getSession: mocks.getSession, $store: { notify: mocks.notify } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }), usePathname: () => "/" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ status: mocks.status, user: null, logout: vi.fn() }) }));

import { AuthGate } from "@/components/app/AuthGate";
import { UNAUTHORIZED_EVENT } from "@/lib/api-client";

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.getSession.mockReset();
  mocks.notify.mockReset();
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

  it("redirects an anonymous visitor to login with next", async () => {
    mocks.status = "anonymous";
    mocks.getSession.mockResolvedValue({ data: null });
    window.history.replaceState(null, "", "/?board=x");
    render(gate());
    expect(screen.queryByText("board")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login?next=%2F%3Fboard%3Dx"));
  });

  it("redirects when the session check fails", async () => {
    mocks.status = "anonymous";
    mocks.getSession.mockRejectedValue(new Error("offline"));
    render(gate());
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login?next=%2F"));
  });

  it("does not redirect, and refreshes the session, when the server says the user is signed in", async () => {
    mocks.status = "anonymous";
    mocks.getSession.mockResolvedValue({ data: { user: { id: "u" } } });
    render(gate());
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith("$sessionSignal"));
    expect(mocks.replace).not.toHaveBeenCalled();
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
