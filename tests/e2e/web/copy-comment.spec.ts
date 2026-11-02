import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
  await page.getByLabel("New card title").fill("Pay rent");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("button", { name: "Pay rent", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("New comment").fill("Call the landlord");
  await dialog.getByRole("button", { name: "Add comment" }).click();
  await expect(dialog.getByRole("button", { name: "Copy comment 1" })).toBeVisible();
});

test("copies a comment from the card dialog", async ({ page }) => {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Copy comment 1" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Call the landlord");
  await expect(dialog.getByRole("status")).toBeHidden({ timeout: 6000 });
});

test("shows the comment to copy by hand when the clipboard is unavailable", async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Copy comment 1" }).click();
  const status = dialog.getByRole("status");
  await expect(status).toContainText("Call the landlord");
  await status.getByRole("button", { name: "Dismiss" }).click();
  await expect(status).toBeHidden();
});
