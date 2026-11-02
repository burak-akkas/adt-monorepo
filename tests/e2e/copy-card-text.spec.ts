import { expect, test } from "@playwright/test";
import { editCard } from "../support/cardActions";

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
  await page.getByLabel("New card title").fill("Pay rent");
  await page.getByRole("button", { name: "Add card" }).click();
  await editCard(page, "Pay rent", { dueDate: "2026-11-05", notes: "Before noon" });
});

test("copies the saved card as text from the card dialog", async ({ page }) => {
  await page.getByRole("button", { name: "Pay rent", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const button = dialog.getByRole("button", { name: "Copy as text" });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("Copied");

  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe("Pay rent\n\nDue: 2026-11-05\n\nBefore noon");
  await expect(dialog.getByRole("status")).toBeHidden({ timeout: 6000 });
});

test("shows the text to copy by hand when the clipboard is unavailable", async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  await page.getByRole("button", { name: "Pay rent", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Copy as text" }).click();
  const status = dialog.getByRole("status");
  await expect(status).toContainText("Pay rent");
  await expect(status).toContainText("Due: 2026-11-05");
  await status.getByRole("button", { name: "Dismiss" }).click();
  await expect(status).toBeHidden();
});
