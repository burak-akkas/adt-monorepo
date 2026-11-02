import { expect, test } from "@playwright/test";

test("checklist heading shows an 'N/M done' label that updates live", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
  await page.getByLabel("New card title").fill("Progress");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Progress" });

  await expect(dialog.getByText(/\d+\/\d+ done/)).toHaveCount(0);

  const input = dialog.getByLabel("New checklist item");
  for (const text of ["One", "Two"]) {
    await input.fill(text);
    await input.press("Enter");
  }
  await expect(dialog.getByText("0/2 done")).toBeVisible();

  await dialog.getByRole("checkbox", { name: "One" }).check();
  await expect(dialog.getByText("1/2 done")).toBeVisible();

  await dialog.getByRole("button", { name: "Uncheck all" }).click();
  await expect(dialog.getByText("0/2 done")).toBeVisible();

  await dialog.getByRole("button", { name: 'Delete checklist item "One"' }).click();
  await dialog.getByRole("button", { name: 'Delete checklist item "Two"' }).click();
  await expect(dialog.getByText(/\d+\/\d+ done/)).toHaveCount(0);
});
