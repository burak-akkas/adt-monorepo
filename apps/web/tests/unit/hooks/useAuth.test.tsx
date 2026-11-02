import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useSession, signOut } = vi.hoisted(() => ({ useSession: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: { useSession, signOut } }));

import { useAuth } from "@/hooks/useAuth";

beforeEach(() => {
  useSession.mockReset();
  signOut.mockReset();
});

describe("useAuth", () => {
  it("is loading while the session is pending", () => {
    useSession.mockReturnValue({ data: null, isPending: true, error: null });
    expect(renderHook(() => useAuth()).result.current.status).toBe("loading");
  });

  it("is anonymous without a session", () => {
    useSession.mockReturnValue({ data: null, isPending: false, error: null });
    expect(renderHook(() => useAuth()).result.current.status).toBe("anonymous");
  });

  it("is authenticated with a user", () => {
    useSession.mockReturnValue({
      data: { user: { id: "1", email: "a@example.test", name: "a" } },
      isPending: false,
      error: null,
    });
    const { result } = renderHook(() => useAuth());
    expect(result.current.status).toBe("authenticated");
    expect(result.current.user?.email).toBe("a@example.test");
  });

  it("treats a failed session call as anonymous", () => {
    useSession.mockReturnValue({ data: null, isPending: false, error: { status: 500 } });
    expect(renderHook(() => useAuth()).result.current.status).toBe("anonymous");
  });

  it("logout calls signOut and swallows failures", async () => {
    useSession.mockReturnValue({ data: null, isPending: false, error: null });
    signOut.mockRejectedValue(new Error("offline"));
    await expect(renderHook(() => useAuth()).result.current.logout()).resolves.toBeUndefined();
    expect(signOut).toHaveBeenCalled();
  });
});
