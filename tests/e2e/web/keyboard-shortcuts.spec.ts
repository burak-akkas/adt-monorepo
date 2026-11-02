import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("n focuses the add-card input and / focuses search", async ({ page }) => {
  await page.keyboard.press("n");
  const title = page.getByLabel("New card title");
  await expect(title).toBeFocused();
  await expect(title).toHaveValue("");

  await title.fill("Write docs");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByRole("button", { name: "Write docs", exact: true })).toBeVisible();

  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("/");
  const search = page.getByLabel("Search cards");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await search.fill("docs");
  await expect(page.getByRole("button", { name: "Write docs", exact: true })).toBeVisible();
});

test("? opens the help dialog and Escape returns focus", async ({ page }) => {
  await page.keyboard.press("Shift+?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Focus the new card title");
  await expect(dialog).toContainText("Focus the card search");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Keyboard shortcuts" })).toBeFocused();
});

test("the header button opens the dialog and Close returns focus to it", async ({ page }) => {
  const button = page.getByRole("button", { name: "Keyboard shortcuts" });
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});

test("typing ? in the search box does not open the dialog", async ({ page }) => {
  const search = page.getByLabel("Search cards");
  await search.click();
  await page.keyboard.type("what?");
  await expect(search).toHaveValue("what?");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
