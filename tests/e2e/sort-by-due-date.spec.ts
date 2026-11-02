import { expect, test, type Page } from "@playwright/test";
import { editCard } from "../support/cardActions";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

async function addCard(page: Page, title: string) {
  await page.getByLabel("New card title").fill(title);
  await page.getByRole("button", { name: "Add card" }).click();
}

const todoOrder = (page: Page) =>
  page.getByRole("region", { name: /^To do/ }).getByRole("button", { name: /^(Late|Early|Plain)$/ });

test("sorts the lists by due date, keeps the order after a reload and is disabled without due dates", async ({
  page,
}) => {
  await addCard(page, "Late");
  await addCard(page, "Plain");
  await addCard(page, "Early");

  await page.getByRole("button", { name: "Board actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Sort lists by due date" })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  await editCard(page, "Late", { dueDate: "2031-01-01" });
  await editCard(page, "Early", { dueDate: "2030-01-01" });
  await expect(todoOrder(page)).toHaveText(["Late", "Plain", "Early"]);

  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "Sort lists by due date" }).click();
  await expect(todoOrder(page)).toHaveText(["Early", "Late", "Plain"]);

  await page.reload();
  await expect(todoOrder(page)).toHaveText(["Early", "Late", "Plain"]);
});
