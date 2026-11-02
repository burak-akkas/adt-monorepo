import { defineConfig } from "@playwright/test";

// E2E_BASE_URL points the suite at a stack that's already running elsewhere (QA). Without it, the suite uses
// the stack on port 3000, starting it if needed. The database must be up: docker compose up -d --wait db.
const remoteURL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: remoteURL ?? "http://localhost:3000/",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: remoteURL
    ? undefined
    : {
        command: "npm run stack",
        url: "http://localhost:3000/",
        reuseExistingServer: true,
        timeout: 240_000,
      },
});
