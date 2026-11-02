import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const html = "html";

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("the theme switch is in Settings, not in the header", async ({ page }) => {
  await expect(page.getByRole("radiogroup", { name: "Theme" })).toHaveCount(0);
  const dialog = await openSettings(page);
  await expect(dialog.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
});

test("System is selected by default", async ({ page }) => {
  const dialog = await openSettings(page);
  await expect(dialog.getByRole("radio", { name: "System" })).toBeChecked();
  await expect(page.locator(html)).toHaveAttribute("data-theme", "light");
});

test("Dark applies immediately and persists across a reload", async ({ page }) => {
  let dialog = await openSettings(page);
  await dialog.getByRole("radio", { name: "Dark" }).check({ force: true });
  await expect(page.locator(html)).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(10, 10, 10)");

  await page.reload();
  await expect(page.locator(html)).toHaveAttribute("data-theme", "dark");
  dialog = await openSettings(page);
  await expect(dialog.getByRole("radio", { name: "Dark" })).toBeChecked();
});

test("Light overrides a dark OS scheme and System follows it again", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const dialog = await openSettings(page);
  await dialog.getByRole("radio", { name: "Light" }).check({ force: true });
  await expect(page.locator(html)).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await dialog.getByRole("radio", { name: "System" }).check({ force: true });
  await expect(page.locator(html)).toHaveAttribute("data-theme", "dark");
});
