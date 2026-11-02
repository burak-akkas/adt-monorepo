import { expect, test } from "@playwright/test";

// Goes through the web origin: Next.js forwards /api/auth/... to the API's /auth/...
test("sign-up through the web origin sets a session that get-session returns", async ({ request, baseURL }) => {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

  const signUp = await request.post("api/auth/sign-up/email", {
    data: { name: "E2E User", email, password: "test-password-123" },
  });
  expect(signUp.ok()).toBe(true);
  expect(signUp.headers()["set-cookie"]).toContain("session_token");

  const session = await request.get("api/auth/get-session");
  expect(session.ok()).toBe(true);
  const body = await session.json();
  expect(body.user.email).toBe(email);

  // Better Auth checks the Origin of cookie-bearing POSTs, as a browser would send it.
  const signOut = await request.post("api/auth/sign-out", {
    data: {},
    headers: { origin: new URL(baseURL ?? "http://localhost:3000/").origin },
  });
  expect(signOut.ok()).toBe(true);
  const after = await request.get("api/auth/get-session");
  expect(await after.json()).toBeNull();
});
