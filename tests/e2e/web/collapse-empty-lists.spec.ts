import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("collapses only the empty lists and keeps them after a reload", async ({ page }) => {
  await page.getByLabel("New card title").fill("Task");
  await page.getByRole("button", { name: "Add card" }).click();

  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "Collapse empty lists" }).click();
  await expect(page.getByRole("button", { name: "Collapse To do" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand Doing" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand Done" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Collapse To do" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand Doing" })).toBeVisible();

  await page.getByRole("button", { name: "Board actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Collapse empty lists" })).toHaveAttribute("aria-disabled", "true");
});
