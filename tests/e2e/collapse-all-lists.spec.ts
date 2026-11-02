import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("collapses all lists, keeps them after a reload and expands them all again", async ({ page }) => {
  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "Collapse all lists" }).click();
  for (const name of ["To do", "Doing", "Done"]) {
    await expect(page.getByRole("button", { name: `Expand ${name}` })).toBeVisible();
  }

  await page.reload();
  for (const name of ["To do", "Doing", "Done"]) {
    await expect(page.getByRole("button", { name: `Expand ${name}` })).toBeVisible();
  }

  await page.getByRole("button", { name: "Board actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Collapse all lists" })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("menuitem", { name: "Expand all lists" }).click();
  for (const name of ["To do", "Doing", "Done"]) {
    await expect(page.getByRole("button", { name: `Collapse ${name}` })).toBeVisible();
  }
});
