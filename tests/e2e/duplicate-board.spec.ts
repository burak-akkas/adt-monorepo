import { expect, test, type Page } from "@playwright/test";

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });
const selected = (page: Page) => page.getByRole("combobox", { name: "Board" }).locator("option:checked");

test("duplicates the current board, keeps the copy independent and persists it", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
  await page.getByLabel("New card title").fill("Original card");
  await page.getByRole("button", { name: "Add card" }).click();

  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "Duplicate board" }).click();
  await expect(selected(page)).toHaveText("My board (copy)");
  await expect(column(page, "To do").getByText("Original card")).toBeVisible();

  await page.getByLabel("New card title").fill("Copy only");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(column(page, "To do").getByText("Copy only")).toBeVisible();

  await page.getByRole("combobox", { name: "Board" }).selectOption({ label: "My board" });
  await expect(column(page, "To do").getByText("Original card")).toBeVisible();
  await expect(column(page, "To do").getByText("Copy only")).toHaveCount(0);

  await page.getByRole("combobox", { name: "Board" }).selectOption({ label: "My board (copy)" });
  await page.reload();
  await expect(selected(page)).toHaveText("My board (copy)");
  await expect(column(page, "To do").getByText("Copy only")).toBeVisible();
});
