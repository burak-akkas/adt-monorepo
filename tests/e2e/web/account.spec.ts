import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "test-password-123";
const NEW_PASSWORD = "another-password-456";

const uniqueEmail = () => `e2e-account-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
const accountNav = (page: Page) => page.getByRole("navigation", { name: "Account" });
// Next.js adds its own role="alert" route announcer, so scope to the page's messages.
const formAlert = (page: Page) => page.locator("form").getByRole("alert");

const register = async (page: Page, email: string) => {
  await page.goto("./");
  await accountNav(page).getByRole("link", { name: "Register" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
};

const login = async (page: Page, email: string, password: string) => {
  await page.goto("./");
  await accountNav(page).getByRole("link", { name: "Log in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
};

const openAccount = async (page: Page) => {
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
};

test("a logged-out visitor on the account page is sent to the login page", async ({ page }) => {
  await page.goto("account");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("the account page shows the email", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, email);
  await openAccount(page);
  await expect(page.getByText(email)).toBeVisible();
});

test("change password: errors, then success keeps this session and ends other ones", async ({ page, browser, baseURL }) => {
  const email = uniqueEmail();
  await register(page, email);

  const other = await browser.newContext({ baseURL });
  try {
    const otherPage = await other.newPage();
    await login(otherPage, email, PASSWORD);
    await expect(otherPage.getByRole("button", { name: "Log out" })).toBeVisible();

    await openAccount(page);
    await page.getByLabel("Current password").fill("not-the-password-1");
    await page.getByLabel("New password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password", exact: true }).click();
    await expect(formAlert(page)).toHaveText("Current password is incorrect.");

    await page.getByLabel("Current password").fill(PASSWORD);
    await page.getByLabel("New password").fill("short");
    await page.getByRole("button", { name: "Change password", exact: true }).click();
    await expect(formAlert(page)).toContainText("at least 10 characters");

    await page.getByLabel("Current password").fill(PASSWORD);
    await page.getByLabel("New password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Password changed");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();

    const response = await other.request.get("api/auth/get-session");
    expect(await response.json()).toBeNull();
  } finally {
    await other.close();
  }

  await page.goto("./");
  await page.getByRole("button", { name: "Log out" }).click();
  await login(page, email, PASSWORD);
  await expect(page.locator("form").getByRole("alert")).toHaveText("Invalid email or password.");
  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByText(email)).toBeVisible();
});

test("delete account: wrong password, cancel, then delete returns home and keeps local boards", async ({ page }) => {
  const email = uniqueEmail();
  await page.goto("./");
  await page.getByLabel("New card title").fill("Local card");
  await page.getByRole("button", { name: "Add card" }).click();
  await register(page, email);
  await openAccount(page);
  await expect(page.getByText(/cannot be\s+undone/).first()).toBeVisible();

  await page.getByLabel("Password to confirm deletion").fill("not-the-password-1");
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  await page.getByRole("button", { name: "Yes, delete my account" }).click();
  await expect(formAlert(page)).toHaveText("Current password is incorrect.");
  await expect(page.getByText(email)).toBeVisible();

  await page.getByLabel("Password to confirm deletion").fill(PASSWORD);
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(email)).toBeVisible();

  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  await page.getByRole("button", { name: "Yes, delete my account" }).click();
  await expect.poll(() => new URL(page.url()).pathname).not.toContain("/account");
  await expect(accountNav(page).getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(page.getByRole("region", { name: /^To do/ }).getByText("Local card")).toBeVisible();

  await login(page, email, PASSWORD);
  await expect(page.locator("form").getByRole("alert")).toHaveText("Invalid email or password.");
});

test("deleting one account leaves another account working", async ({ page, browser, baseURL }) => {
  const doomed = uniqueEmail();
  const bystander = uniqueEmail();
  const other = await browser.newContext({ baseURL });
  try {
    const otherPage = await other.newPage();
    await register(otherPage, bystander);

    await register(page, doomed);
    await openAccount(page);
    await page.getByLabel("Password to confirm deletion").fill(PASSWORD);
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    await page.getByRole("button", { name: "Yes, delete my account" }).click();
    await expect(accountNav(page).getByRole("link", { name: "Log in" })).toBeVisible();

    await otherPage.reload();
    await expect(otherPage.getByText(bystander)).toBeVisible();
  } finally {
    await other.close();
  }
  await login(page, bystander, PASSWORD);
  await expect(page.getByText(bystander)).toBeVisible();
});
