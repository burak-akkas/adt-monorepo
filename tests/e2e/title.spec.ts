import { expect, test } from "@playwright/test";
import { moveCardTo } from "../support/cardActions";

async function addCard(page: import("@playwright/test").Page, title: string) {
  await page.getByLabel("New card title").fill(title);
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
}

test("the tab title shows the board name and the open card count", async ({ page }) => {
  await page.goto("./");
  await expect(page).toHaveTitle("My board · Kanban");

  await addCard(page, "First");
  await addCard(page, "Second");
  await expect(page).toHaveTitle("My board (2) · Kanban");

  await moveCardTo(page, "First", "Done");
  await expect(page).toHaveTitle("My board (1) · Kanban");

  await page.getByLabel("Search cards").fill("nothing matches");
  await expect(page).toHaveTitle("My board (1) · Kanban");

  await page.reload();
  await expect(page).toHaveTitle("My board (1) · Kanban");

  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "New board" }).click();
  await page.getByLabel("Board name").fill("Work");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveTitle("Work · Kanban");
});
