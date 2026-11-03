import { expect, test } from "@playwright/test";

const PASSWORD = "test-password-123";
const uniqueEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

test("sign-up, logout, login and board actions work through the /api proxy", async ({ page, context }) => {
  const email = uniqueEmail();

  await page.goto("register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  const session = (await context.cookies()).find((c) => c.name.includes("session_token"));
  expect(session).toBeDefined();
  expect(session?.httpOnly).toBe(true);

  const todo = page.getByRole("region", { name: /^To do/ });
  await page.getByLabel("New card title").fill("Through the proxy");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(todo.getByText("Through the proxy")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  expect((await context.cookies()).some((c) => c.name.includes("session_token"))).toBe(true);
});

test("a key sent by the browser does not break /api requests", async ({ request }) => {
  const response = await request.get("api/health", { headers: { "x-internal-api-key": "bogus" } });
  expect(response.ok()).toBe(true);
});
