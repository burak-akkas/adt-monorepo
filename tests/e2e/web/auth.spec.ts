import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "test-password-123";
const SEEDED_EMAIL = "a@example.test";
const INVALID_LOGIN = "Invalid email or password.";

const uniqueEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

const accountNav = (page: Page) => page.getByRole("navigation", { name: "Account" });

// Next.js adds its own role="alert" route announcer, so scope to the form's message.
const formAlert = (page: Page) => page.locator("form").getByRole("alert");

const fillAndSubmit = async (page: Page, email: string, password: string, submit: "Register" | "Log in") => {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: submit, exact: true }).click();
};

const register = async (page: Page, email: string, password = PASSWORD) => {
  await page.goto("./");
  await accountNav(page).getByRole("link", { name: "Register" }).click();
  await fillAndSubmit(page, email, password, "Register");
};

const login = async (page: Page, email: string, password = PASSWORD) => {
  await page.goto("./");
  await accountNav(page).getByRole("link", { name: "Log in" }).click();
  await fillAndSubmit(page, email, password, "Log in");
};

const logout = async (page: Page, email: string) => {
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(accountNav(page).getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(page.getByText(email)).toHaveCount(0);
};

const expectLoggedIn = async (page: Page, email: string) => {
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
};

test("register, stay logged in after reload, then log out", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, email);
  await expectLoggedIn(page, email);

  await page.reload();
  await expectLoggedIn(page, email);

  await logout(page, email);
  await page.reload();
  await expect(accountNav(page).getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(page.getByText(email)).toHaveCount(0);
});

test("logs in with a seeded account and stays logged in after reload", async ({ page }) => {
  await login(page, SEEDED_EMAIL);
  await expectLoggedIn(page, SEEDED_EMAIL);
  await page.reload();
  await expectLoggedIn(page, SEEDED_EMAIL);
});

test("register errors: duplicate email and weak password", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, email);
  await expectLoggedIn(page, email);
  await logout(page, email);

  await page.goto("register");
  await fillAndSubmit(page, email.toUpperCase(), PASSWORD, "Register");
  await expect(formAlert(page)).toContainText("already exists");
  await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);

  await page.goto("register");
  await fillAndSubmit(page, uniqueEmail(), "123456789", "Register");
  await expect(formAlert(page)).toContainText("at least 10 characters");
  await page.goto("./");
  await expect(accountNav(page).getByRole("link", { name: "Log in" })).toBeVisible();
});

test("login errors: wrong password and unknown email show the same message", async ({ page }) => {
  await login(page, SEEDED_EMAIL, "not-the-password");
  await expect(formAlert(page)).toHaveText(INVALID_LOGIN);
  const wrongPassword = (await formAlert(page).textContent()) ?? "";

  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password").fill("some-other-password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(formAlert(page)).toHaveText(INVALID_LOGIN);
  const unknownEmail = (await formAlert(page).textContent()) ?? "";
  expect(unknownEmail).toBe(wrongPassword);
  await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
});

test("session cookie is httpOnly and the old session dies on the server after logout", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const email = uniqueEmail();
  await register(page, email);
  await expectLoggedIn(page, email);

  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name.includes("session_token"));
  expect(session).toBeDefined();
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expect(session?.secure).toBe(baseURL?.startsWith("https") ?? false);
  expect(await page.evaluate(() => document.cookie)).not.toContain("session_token");

  await logout(page, email);

  const other = await browser.newContext({ baseURL });
  try {
    await other.addCookies([
      { name: session!.name, value: session!.value, domain: session!.domain, path: session!.path },
    ]);
    const response = await other.request.get("api/auth/get-session");
    expect(response.ok()).toBe(true);
    expect(await response.json()).toBeNull();
  } finally {
    await other.close();
  }
});

test("the board works the same logged out and logged in", async ({ page }) => {
  const todo = page.getByRole("region", { name: /^To do/ });
  const addCard = async (title: string) => {
    await page.getByLabel("New card title").fill(title);
    await page.getByRole("button", { name: "Add card" }).click();
    await expect(todo.getByText(title)).toBeVisible();
  };

  await page.goto("./");
  await addCard("Before login");
  await page.reload();
  await expect(todo.getByText("Before login")).toBeVisible();

  const email = uniqueEmail();
  await register(page, email);
  await expectLoggedIn(page, email);
  await expect(todo.getByText("Before login")).toBeVisible();
  await addCard("While logged in");

  await logout(page, email);
  await expect(todo.getByText("Before login")).toBeVisible();
  await expect(todo.getByText("While logged in")).toBeVisible();
});
