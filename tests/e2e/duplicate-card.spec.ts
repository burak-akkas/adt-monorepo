import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("duplicates a card with the keyboard, keeps its details, and survives a reload", async ({ page }) => {
  await page.getByLabel("New card title").fill("Plan trip");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByLabel("New card title").fill("Other");
  await page.getByRole("button", { name: "Add card" }).click();

  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Plan trip" });
  await dialog.getByLabel("Description").fill("Some notes");
  await dialog.getByLabel("Priority").selectOption("high");
  await dialog.getByLabel("Labels").fill("travel");
  await dialog.getByRole("button", { name: "Add label" }).click();
  await dialog.getByLabel("New checklist item").fill("Book");
  await dialog.getByRole("button", { name: "Add item" }).click();
  await dialog.getByLabel("New comment").fill("A comment");
  await dialog.getByRole("button", { name: "Add comment" }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();

  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Plan trip" });
  await dialog.getByRole("button", { name: "Duplicate" }).focus();
  await page.keyboard.press("Enter");

  dialog = page.getByRole("dialog", { name: "Plan trip (copy)" });
  await expect(dialog.getByLabel("Description")).toHaveValue("Some notes");
  await expect(dialog.getByLabel("Priority")).toHaveValue("high");
  await expect(dialog.getByText("created as a copy of Plan trip")).toBeVisible();
  await expect(dialog.getByText("A comment")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  const titles = page.getByRole("region", { name: /^To do/ }).getByRole("button", { name: /^(Plan trip|Other)/ });
  await expect(titles).toHaveText([/^Plan trip$/, /^Plan trip \(copy\)$/, /^Other$/]);

  await page.reload();
  await expect(titles).toHaveText([/^Plan trip$/, /^Plan trip \(copy\)$/, /^Other$/]);
});
