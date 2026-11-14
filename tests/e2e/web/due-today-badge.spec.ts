import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures";
import { editCard } from "../../support/cardActions";

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

// The local calendar day, as the app computes it.
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("list header shows how many cards are due today, apart from overdue ones", async ({ page }) => {
  for (const title of ["Pay rent", "Call bank", "Old bill"]) {
    await page.getByLabel("New card title").fill(title);
    await page.getByRole("button", { name: "Add card" }).click();
  }
  await expect(column(page, "To do").getByText(/due today/)).toHaveCount(0);

  await editCard(page, "Pay rent", { dueDate: today() });
  await editCard(page, "Call bank", { dueDate: today() });
  await editCard(page, "Old bill", { dueDate: "2000-01-01" });
  await expect(column(page, "To do").getByText("2 due today")).toBeVisible();
  await expect(column(page, "To do").getByText("1 overdue")).toBeVisible();

  // Hidden cards still count.
  await page.getByLabel("Search cards").fill("Pay");
  await expect(column(page, "To do").getByText("2 due today")).toBeVisible();
  await page.getByLabel("Search cards").fill("");

  await page.getByRole("button", { name: "Collapse To do" }).click();
  await expect(column(page, "To do").getByText("2 due today")).toBeVisible();
  await page.getByRole("button", { name: "Expand To do" }).click();

  // Finished cards are not due.
  await editCard(page, "Pay rent", { dueDate: today(), list: "Done" });
  await expect(column(page, "To do").getByText("1 due today")).toBeVisible();
  await expect(column(page, "Done").getByText(/due today/)).toHaveCount(0);
});
