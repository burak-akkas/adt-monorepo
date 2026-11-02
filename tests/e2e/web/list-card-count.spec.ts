import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("list card counts follow adding and archiving cards", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /^To do\s*0$/ })).toBeVisible();

  for (const title of ["One", "Two"]) {
    await page.getByLabel("New card title").fill(title);
    await page.getByRole("button", { name: "Add card" }).click();
  }
  await expect(page.getByRole("heading", { name: /^To do\s*2$/ })).toBeVisible();

  await page.getByRole("button", { name: "Archive all cards in To do" }).click();
  await expect(page.getByRole("heading", { name: /^To do\s*0$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Archived (2)" })).toBeVisible();
});
