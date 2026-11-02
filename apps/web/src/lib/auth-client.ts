import { createAuthClient } from "better-auth/react";

export const AUTH_BASE_PATH = "/api/auth";

// The browser only talks to its own origin; Next.js forwards /api/* to the API.
// During SSR there is no window, so fall back to a placeholder origin (session calls only run in the browser).
export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? "http://localhost:3000" : window.location.origin,
  basePath: AUTH_BASE_PATH,
});
