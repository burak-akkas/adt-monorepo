import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
});

test("the top bar is a banner with the title and board selector", async ({ page }) => {
  const banner = page.getByRole("banner");
  await expect(banner.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
  await expect(banner.getByRole("combobox", { name: "Board" })).toBeVisible();
});

test("opens Settings via its icon and returns focus on close", async ({ page }) => {
  const button = page.getByRole("banner").getByRole("button", { name: "Settings" });
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});

test("opens the shortcuts dialog via its icon and returns focus on close", async ({ page }) => {
  const button = page.getByRole("banner").getByRole("button", { name: "Keyboard shortcuts" });
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});

test("does not overflow horizontally on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
