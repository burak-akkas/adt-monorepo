import { expect, test } from "@playwright/test";

test("Delete completed removes ticked items, keeps the rest and persists", async ({ page }) => {
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
  const deleteCompleted = dialog.getByRole("button", { name: "Delete completed" });
  await expect(deleteCompleted).toBeDisabled();

  await dialog.getByRole("checkbox", { name: "One" }).check();
  await dialog.getByRole("checkbox", { name: "Three" }).check();
  await expect(deleteCompleted).toBeEnabled();
  await deleteCompleted.focus();
  await page.keyboard.press("Enter");

  await expect(dialog.getByRole("checkbox")).toHaveCount(1);
  await expect(dialog.getByRole("checkbox", { name: "Two" })).not.toBeChecked();
  await expect(deleteCompleted).toBeDisabled();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.reload();
  await expect(page.getByRole("img", { name: "0 of 1 checklist items done" })).toBeVisible();

  await page.getByRole("button", { name: "Weekly", exact: true }).click();
  const reopened = page.getByRole("dialog", { name: "Weekly" });
  await expect(reopened.getByRole("checkbox")).toHaveCount(1);
  await expect(reopened.getByRole("checkbox", { name: "Two" })).toBeVisible();
});
