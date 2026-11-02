import { expect, test, type Page } from "@playwright/test";
import { editCard, moveCardTo } from "../support/cardActions";

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("summary bar shows progress and filters to overdue cards", async ({ page }) => {
  const summary = page.getByRole("region", { name: "Board summary" });
  await expect(summary.getByText(/No cards yet/)).toBeVisible();

  for (const title of ["Pay rent", "Buy milk"]) {
    await page.getByLabel("New card title").fill(title);
    await page.getByRole("button", { name: "Add card" }).click();
  }
  await editCard(page, "Pay rent", { dueDate: "2000-01-01" });

  const progress = page.getByRole("progressbar", { name: "Cards done" });
  await expect(progress).toHaveAttribute("aria-valuenow", "0");
  await expect(summary.getByText("Overdue: 1")).toBeVisible();

  await summary.getByRole("button", { name: /Overdue: 1/ }).click();
  await expect(column(page, "To do").getByText("Pay rent")).toBeVisible();
  await expect(column(page, "To do").getByText("Buy milk")).toHaveCount(0);

  await summary.getByRole("button", { name: /Overdue: 1/ }).click();
  await expect(column(page, "To do").getByText("Buy milk")).toBeVisible();

  await moveCardTo(page, "Buy milk", "Done");
  await expect(progress).toHaveAttribute("aria-valuenow", "50");
  await expect(summary.getByText("50% done")).toBeVisible();
});
