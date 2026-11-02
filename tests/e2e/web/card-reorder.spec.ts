import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("moves a card to the top and bottom of its list, with the dialog staying open", async ({ page }) => {
  for (const title of ["Alpha", "Bravo", "Charlie"]) {
    await page.getByLabel("New card title").fill(title);
    await page.getByRole("button", { name: "Add card" }).click();
  }
  const titles = page.getByRole("region", { name: /^To do/ }).getByRole("button", { name: /^(Alpha|Bravo|Charlie)$/ });
  await expect(titles).toHaveText(["Alpha", "Bravo", "Charlie"]);

  await page.getByRole("button", { name: "Charlie", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Charlie" });
  await expect(dialog.getByRole("button", { name: "Move to bottom" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Move to top" }).click();
  await expect(dialog).toBeVisible();
  await expect(titles).toHaveText(["Charlie", "Alpha", "Bravo"]);
  await expect(dialog.getByRole("button", { name: "Move to top" })).toBeDisabled();

  await dialog.getByRole("button", { name: "Move to bottom" }).click();
  await expect(titles).toHaveText(["Alpha", "Bravo", "Charlie"]);

  await page.reload();
  await expect(titles).toHaveText(["Alpha", "Bravo", "Charlie"]);
});

test("enabled states use the full list even while a search is active", async ({ page }) => {
  for (const title of ["Alpha", "Bravo", "Charlie"]) {
    await page.getByLabel("New card title").fill(title);
    await page.getByRole("button", { name: "Add card" }).click();
  }
  await page.getByLabel("Search cards").fill("Bravo");
  await expect(page.getByRole("button", { name: "Alpha", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Bravo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Bravo" });
  await expect(dialog.getByRole("button", { name: "Move to top" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Move to bottom" })).toBeEnabled();
});
