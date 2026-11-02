import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("adds a label, filters by chip click, combines with search and clears", async ({ page }) => {
  for (const title of ["Fix crash", "Write docs"]) {
    await page.getByLabel("New card title").fill(title);
    await page.getByRole("button", { name: "Add card" }).click();
  }
  const cardTitle = (title: string) => page.getByRole("button", { name: title, exact: true });

  await cardTitle("Fix crash").click();
  const dialog = page.getByRole("dialog", { name: "Fix crash" });
  await dialog.getByLabel("Labels").fill("Bug");
  await dialog.getByLabel("Labels").press("Enter");
  await dialog.getByLabel("Labels").fill("bug");
  await dialog.getByRole("button", { name: "Add label" }).click();
  await expect(dialog.getByRole("alert")).toContainText("already exists");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();

  const chip = page.getByRole("button", { name: 'Filter by label "Bug"' });
  await expect(chip).toBeVisible();

  await page.reload();
  await expect(chip).toBeVisible();

  await chip.click();
  await expect(cardTitle("Fix crash")).toBeVisible();
  await expect(cardTitle("Write docs")).toHaveCount(0);

  await page.getByLabel("Search cards").fill("docs");
  await expect(page.getByText("No matching cards").first()).toBeVisible();
  await page.getByLabel("Search cards").fill("");

  await page.getByRole("button", { name: "Clear label filter" }).click();
  await expect(cardTitle("Write docs")).toBeVisible();
  await expect(cardTitle("Fix crash")).toBeVisible();
});
