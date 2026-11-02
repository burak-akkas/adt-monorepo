import { expect, test, type Page } from "@playwright/test";
import { editCard, moveCardTo } from "../support/cardActions";

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("changes a card's priority in the dialog and keeps it after a reload and a move", async ({ page }) => {
  await page.getByLabel("New card title").fill("Urgent thing");
  await page.getByRole("button", { name: "Add card" }).click();

  const card = column(page, "To do").getByRole("listitem");
  await expect(card.getByTestId("priority-badge")).toHaveText("Medium");
  await expect(page.getByLabel('Priority of "Urgent thing"')).toHaveCount(0);

  await editCard(page, "Urgent thing", { priority: "high" });
  await expect(card.getByTestId("priority-badge")).toHaveText("High");

  await page.reload();
  await expect(column(page, "To do").getByTestId("priority-badge")).toHaveText("High");

  await moveCardTo(page, "Urgent thing", "Doing");
  await expect(column(page, "Doing").getByTestId("priority-badge")).toHaveText("High");
});
