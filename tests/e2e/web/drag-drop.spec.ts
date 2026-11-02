import { expect, test, type Page } from "@playwright/test";

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("drags a card to another column and keeps it after a reload", async ({ page }) => {
  await page.getByLabel("New card title").fill("Drag me");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(column(page, "To do").getByText("Drag me")).toBeVisible();

  await column(page, "To do").getByRole("listitem").dragTo(column(page, "Done"));
  await expect(column(page, "Done").getByText("Drag me")).toBeVisible();
  await expect(column(page, "To do").getByText("No cards")).toBeVisible();

  await page.reload();
  await expect(column(page, "Done").getByText("Drag me")).toBeVisible();

  await column(page, "Done").getByRole("listitem").dragTo(column(page, "Done"));
  await expect(column(page, "Done").getByText("Drag me")).toBeVisible();
});
