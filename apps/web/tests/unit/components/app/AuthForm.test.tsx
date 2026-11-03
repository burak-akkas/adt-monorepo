import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { signUp, signIn, push, state } = vi.hoisted(() => ({
  signUp: vi.fn(),
  signIn: vi.fn(),
  push: vi.fn(),
  state: { next: null as string | null },
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { signUp: { email: signUp }, signIn: { email: signIn } } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(state.next === null ? "" : { next: state.next }),
}));

import { AuthForm } from "@/components/app/AuthForm";

beforeEach(() => {
  signUp.mockReset();
  signIn.mockReset();
  push.mockReset();
  state.next = null;
});

async function fill(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  return user;
}

describe("AuthForm", () => {
  it("has labelled fields and a submit button", () => {
    render(<AuthForm mode="register" />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  });

  it("shows a weak password error without calling the server", async () => {
    render(<AuthForm mode="register" />);
    const user = await fill("a@example.test", "short");
    await user.click(screen.getByRole("button", { name: "Register" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Password must be at least 10 characters.");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("shows an error for a taken email", async () => {
    signUp.mockResolvedValue({ error: { status: 422, code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" } });
    render(<AuthForm mode="register" />);
    const user = await fill("a@example.test", "test-password-123");
    await user.click(screen.getByRole("button", { name: "Register" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("An account with this email already exists.");
    expect(push).not.toHaveBeenCalled();
  });

  it("redirects to the board after a successful register", async () => {
    signUp.mockResolvedValue({ data: {}, error: null });
    render(<AuthForm mode="register" />);
    const user = await fill("A@Example.test", "test-password-123");
    await user.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ email: "a@example.test" }), expect.anything());
  });

  it.each([
    ["login", signIn, "Log in"],
    ["register", signUp, "Register"],
  ] as const)("announces a rate limit on %s, with the wait from X-Retry-After", async (mode, call, button) => {
    call.mockImplementation(async (_body, options) => {
      options.onError({ response: new Response(null, { status: 429, headers: { "X-Retry-After": "42" } }) });
      return { error: { status: 429 } };
    });
    render(<AuthForm mode={mode} />);
    const user = await fill("a@example.test", "test-password-123");
    await user.click(screen.getByRole("button", { name: button }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts, try again in 42 seconds.");
    expect(push).not.toHaveBeenCalled();
  });

  it("says 'in a minute' when a 429 has no wait", async () => {
    signIn.mockResolvedValue({ error: { status: 429 } });
    render(<AuthForm mode="login" />);
    const user = await fill("a@example.test", "test-password-123");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts, try again in a minute.");
  });

  it("redirects after a successful login", async () => {
    signIn.mockResolvedValue({ data: {}, error: null });
    render(<AuthForm mode="login" />);
    const user = await fill("a@example.test", "test-password-123");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("shows the same login error whatever the cause", async () => {
    const messages: string[] = [];
    for (const code of ["INVALID_EMAIL_OR_PASSWORD", "USER_NOT_FOUND"]) {
      signIn.mockResolvedValue({ error: { status: 401, code } });
      const { unmount } = render(<AuthForm mode="login" />);
      const user = await fill("a@example.test", "test-password-123");
      await user.click(screen.getByRole("button", { name: "Log in" }));
      messages.push((await screen.findByRole("alert")).textContent ?? "");
      unmount();
    }
    expect(messages[0]).toBe("Invalid email or password.");
    expect(messages[1]).toBe(messages[0]);
  });

  it("shows a generic error when the call throws", async () => {
    signIn.mockRejectedValue(new Error("offline"));
    render(<AuthForm mode="login" />);
    const user = await fill("a@example.test", "test-password-123");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
  });

  describe("next", () => {
    it.each([
      ["login", signIn, "Log in"],
      ["register", signUp, "Register"],
    ] as const)("goes to next after %s", async (mode, call, button) => {
      state.next = "/?board=x";
      call.mockResolvedValue({ data: {}, error: null });
      render(<AuthForm mode={mode} />);
      const user = await fill("a@example.test", "test-password-123");
      await user.click(screen.getByRole("button", { name: button }));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/?board=x"));
    });

    it.each(["//evil.com", "https://evil.com", "/\\evil"])("ignores the unsafe next %s", async (bad) => {
      state.next = bad;
      signIn.mockResolvedValue({ data: {}, error: null });
      render(<AuthForm mode="login" />);
      const user = await fill("a@example.test", "test-password-123");
      await user.click(screen.getByRole("button", { name: "Log in" }));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    });

    it("keeps a safe next on the cross-link", () => {
      state.next = "/a?b=c";
      render(<AuthForm mode="login" />);
      expect(screen.getByRole("link", { name: "Register" })).toHaveAttribute("href", "/register?next=%2Fa%3Fb%3Dc");
    });

    it("drops an unsafe next from the cross-link", () => {
      state.next = "//evil.com";
      render(<AuthForm mode="login" />);
      expect(screen.getByRole("link", { name: "Register" })).toHaveAttribute("href", "/register");
    });
  });
});
