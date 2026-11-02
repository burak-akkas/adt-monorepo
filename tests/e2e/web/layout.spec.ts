import { expect, test, type Page } from "@playwright/test";

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("board spans the full width on a wide screen without side scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const titles = page.locator('h2[id^="column-"]');
  await expect(titles).toHaveCount(3);

  expect(await noHorizontalOverflow(page)).toBe(true);
  const first = await titles.first().boundingBox();
  const last = await titles.last().boundingBox();
  expect(first).not.toBeNull();
  expect(last).not.toBeNull();
  expect(last!.x + last!.width - first!.x).toBeGreaterThan(1024);
});

test("columns keep their background", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const column = page
    .locator('h2[id^="column-"]')
    .first()
    .locator('xpath=ancestor::*[contains(@class,"rounded-xl")][1]');
  await expect(column).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test("extra lists wrap instead of scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Manage lists" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage lists" });
  for (const name of ["One", "Two", "Three", "Four", "Five"]) {
    await dialog.getByLabel("New list name").fill(name);
    await dialog.getByRole("button", { name: "Add list" }).click();
  }
  await page.keyboard.press("Escape");

  await expect(page.locator('h2[id^="column-"]')).toHaveCount(8);
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test("has no horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await noHorizontalOverflow(page)).toBe(true);
});
