import { expect, test } from "@playwright/test";

// tools/start-stack.sh sets the sign-up limit for the e2e stack to 200 per minute and visitor.
const STACK_LIMIT = 200;

// Outside Vercel the web app takes the visitor's address from x-forwarded-for, so each test can be its own
// visitor and never use up the bucket the other tests share.
const randomVisitor = () => `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

test("too many attempts show a friendly message on the register page, and another visitor is unaffected", async ({
  browser,
  baseURL,
}) => {
  const visitor = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": randomVisitor() } });
  const other = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": randomVisitor() } });
  try {
    // Invalid emails fail fast with 400 but still count towards the limit.
    for (let i = 0; i < STACK_LIMIT; i++) {
      const response = await visitor.request.post("api/auth/sign-up/email", {
        data: { name: "x", email: "not-an-email", password: "test-password-123" },
      });
      expect(response.status()).toBe(400);
    }

    const page = await visitor.newPage();
    await page.goto("register");
    await page.getByLabel("Email").fill(`rate-${Date.now()}@example.test`);
    await page.getByLabel("Password").fill("test-password-123");
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("Too many attempts, try again in");

    const otherPage = await other.newPage();
    await otherPage.goto("register");
    await otherPage.getByLabel("Email").fill(`rate-other-${Date.now()}@example.test`);
    await otherPage.getByLabel("Password").fill("test-password-123");
    await otherPage.getByRole("button", { name: "Register", exact: true }).click();
    await expect(otherPage.getByRole("button", { name: "Log out" })).toBeVisible();
  } finally {
    await visitor.close();
    await other.close();
  }
});

test("the login page shows the same message when the limit is reached", async ({ browser, baseURL }) => {
  const visitor = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": randomVisitor() } });
  try {
    // Wrong password for an unknown address would hash on each try; a malformed email is rejected before that.
    for (let i = 0; i < STACK_LIMIT; i++) {
      const response = await visitor.request.post("api/auth/sign-in/email", {
        data: { email: "not-an-email", password: "x" },
      });
      expect(response.status()).toBe(400);
    }
    const page = await visitor.newPage();
    await page.goto("login");
    await page.getByLabel("Email").fill("a@example.test");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("Too many attempts, try again in");
  } finally {
    await visitor.close();
  }
});
