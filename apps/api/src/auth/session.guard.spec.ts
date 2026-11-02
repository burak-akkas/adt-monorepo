import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { SessionGuard, type AuthedRequest } from "./session.guard.js";
import type { Auth } from "./auth.js";

function contextFor(request: Partial<AuthedRequest>) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function guardWith(session: { user: { id: string } } | null) {
  const getSession = vi.fn().mockResolvedValue(session);
  return { guard: new SessionGuard({ api: { getSession } } as unknown as Auth), getSession };
}

describe("SessionGuard", () => {
  it("answers 401 without a session", async () => {
    const { guard } = guardWith(null);
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("sets the user id from the session and lets the request through", async () => {
    const { guard, getSession } = guardWith({ user: { id: "user-1" } });
    const request: Partial<AuthedRequest> = { headers: { cookie: "better-auth.session_token=abc" } };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.userId).toBe("user-1");
    expect(getSession.mock.calls[0][0].headers.get("cookie")).toBe("better-auth.session_token=abc");
  });
});
