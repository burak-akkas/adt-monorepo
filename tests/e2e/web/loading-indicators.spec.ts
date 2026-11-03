import { expect, test } from "@playwright/test";

test("the log in button is busy while the request is pending", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/sign-in/**", async (route) => {
    await gate;
    await route.continue();
  });

  await page.goto("login");
  await page.getByLabel("Email").fill("a@example.test");
  await page.getByLabel("Password").fill("test-password-123");
  const submit = page.getByRole("button", { name: "Log in", exact: true });
  await submit.click();

  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute("aria-busy", "true");

  release();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
});
