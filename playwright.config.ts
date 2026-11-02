import { defineConfig } from "@playwright/test";

// E2E_BASE_URL is set by CI and QA to the running stack.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000/",
    channel: "chrome",
    trace: "retain-on-failure",
  },
});
