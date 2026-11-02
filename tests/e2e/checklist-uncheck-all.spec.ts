import { expect, test } from "@playwright/test";

test("Uncheck all unticks every item, keeps them and persists", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
  await page.getByLabel("New card title").fill("Weekly");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("button", { name: "Weekly", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Weekly" });

  const input = dialog.getByLabel("New checklist item");
  for (const text of ["One", "Two", "Three"]) {
    await input.fill(text);
    await input.press("Enter");
  }
  const uncheckAll = dialog.getByRole("button", { name: "Uncheck all" });
  await expect(uncheckAll).toBeDisabled();

  await dialog.getByRole("checkbox", { name: "One" }).check();
  await dialog.getByRole("checkbox", { name: "Three" }).check();
  await expect(uncheckAll).toBeEnabled();
  await uncheckAll.click();

  await expect(dialog.getByRole("checkbox")).toHaveCount(3);
  for (const name of ["One", "Two", "Three"]) {
    await expect(dialog.getByRole("checkbox", { name })).not.toBeChecked();
  }
  await expect(uncheckAll).toBeDisabled();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.reload();
  await expect(page.getByRole("img", { name: "0 of 3 checklist items done" })).toBeVisible();
});
