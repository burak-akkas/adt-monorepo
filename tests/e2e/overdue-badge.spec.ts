import { expect, test, type Page } from "@playwright/test";
import { editCard } from "../support/cardActions";

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("list header shows how many cards are overdue and updates with changes", async ({ page }) => {
  await page.getByLabel("New card title").fill("Pay rent");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(column(page, "To do").getByText("1 overdue")).toHaveCount(0);

  await editCard(page, "Pay rent", { dueDate: "2000-01-01" });
  await expect(column(page, "To do").getByText("1 overdue")).toBeVisible();

  await page.getByRole("button", { name: "Collapse To do" }).click();
  await expect(column(page, "To do").getByText("1 overdue")).toBeVisible();
  await page.getByRole("button", { name: "Expand To do" }).click();

  await editCard(page, "Pay rent", { dueDate: "2000-01-01", list: "Done" });
  await expect(page.getByText(/\d+ overdue/)).toHaveCount(0);
});
