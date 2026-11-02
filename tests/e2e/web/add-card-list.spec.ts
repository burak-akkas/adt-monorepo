import { expect, test } from "@playwright/test";

test("adds a card to the list chosen in Target list", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();

  await page.getByLabel("New card title").fill("Ship it");
  await page.getByLabel("Target list").selectOption({ label: "Doing" });
  await page.getByRole("button", { name: "Add card" }).click();

  const doing = page.getByRole("region", { name: /^Doing/ });
  await expect(doing.getByRole("button", { name: "Ship it", exact: true })).toBeVisible();
  const todo = page.getByRole("region", { name: /^To do/ });
  await expect(todo.getByRole("button", { name: "Ship it", exact: true })).toHaveCount(0);
});
