import { expect, test } from "@playwright/test";

test("Move completed to bottom reorders the checklist and persists", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
  await page.getByLabel("New card title").fill("Sorting");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("button", { name: "Sorting", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Sorting" });

  const input = dialog.getByLabel("New checklist item");
  for (const text of ["One", "Two", "Three"]) {
    await input.fill(text);
    await input.press("Enter");
  }
  const move = dialog.getByRole("button", { name: "Move completed to bottom" });
  await expect(move).toBeDisabled();

  await dialog.getByRole("checkbox", { name: "One" }).check();
  await expect(move).toBeEnabled();
  await move.click();

  const order = (root: typeof dialog) => root.getByRole("list", { name: "Checklist items" }).getByRole("listitem");
  await expect(order(dialog)).toHaveText([/Two/, /Three/, /One/]);
  await expect(move).toBeDisabled();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Sorting", exact: true }).click();
  const reopened = page.getByRole("dialog", { name: "Sorting" });
  await expect(order(reopened)).toHaveText([/Two/, /Three/, /One/]);
  await expect(reopened.getByRole("checkbox", { name: "One" })).toBeChecked();
});
