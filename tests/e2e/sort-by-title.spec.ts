import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

async function addCard(page: Page, title: string) {
  await page.getByLabel("New card title").fill(title);
  await page.getByRole("button", { name: "Add card" }).click();
}

const todoOrder = (page: Page) =>
  page.getByRole("region", { name: /^To do/ }).getByRole("button", { name: /^(Charlie|alpha|Bravo)$/ });

test("sorts one list by title, keeps the order after a reload and is disabled with fewer than 2 cards", async ({
  page,
}) => {
  const sort = page.getByRole("button", { name: "Sort To do by title" });

  await addCard(page, "Charlie");
  await expect(sort).toBeDisabled();
  await addCard(page, "alpha");
  await addCard(page, "Bravo");
  await expect(todoOrder(page)).toHaveText(["Charlie", "alpha", "Bravo"]);

  await expect(sort).toBeEnabled();
  await sort.click();
  await expect(todoOrder(page)).toHaveText(["alpha", "Bravo", "Charlie"]);

  await page.reload();
  await expect(todoOrder(page)).toHaveText(["alpha", "Bravo", "Charlie"]);
});
