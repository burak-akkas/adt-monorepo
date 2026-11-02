import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.spec.ts"],
    // The specs sign up and in many times from one address. Relaxed auth rate limits keep them from tripping it;
    // auth.spec.ts sets the real defaults for its own rate limit tests.
    env: { AUTH_RATE_LIMIT_SIGN_IN_MAX: "100000", AUTH_RATE_LIMIT_MAX: "100000" },
  },
});
