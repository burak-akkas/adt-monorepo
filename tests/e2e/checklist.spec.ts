import { expect, test } from "@playwright/test";
import { deleteCardViaDialog } from "../support/cardActions";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("manages a checklist, shows progress and persists it", async ({ page }) => {
  await page.getByLabel("New card title").fill("Ship it");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("button", { name: "Ship it", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ship it" });

  const input = dialog.getByLabel("New checklist item");
  for (const text of ["Write", "Test", "Deploy"]) {
    await input.fill(text);
    await input.press("Enter");
  }
  await expect(dialog.getByRole("checkbox")).toHaveCount(3);

  await dialog.getByRole("checkbox", { name: "Write" }).check();
  await dialog.getByRole("button", { name: 'Move up "Deploy"' }).click();
  await expect(dialog.getByRole("button", { name: 'Move up "Write"' })).toBeDisabled();

  await dialog.getByRole("button", { name: 'Edit checklist item "Test"' }).click();
  await dialog.getByLabel('Edit checklist item "Test"').fill("Test well");
  await dialog.getByRole("button", { name: "Save item" }).click();
  await dialog.getByRole("button", { name: 'Delete checklist item "Deploy"' }).click();
  await expect(dialog.getByRole("checkbox")).toHaveCount(2);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  const badge = page.getByRole("img", { name: "1 of 2 checklist items done" });
  await expect(badge).toBeVisible();

  await page.reload();
  await expect(badge).toBeVisible();
});

test("keeps the checklist through export and import", async ({ page }, testInfo) => {
  await page.getByLabel("New card title").fill("Packed");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("button", { name: "Packed", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Packed" });
  await dialog.getByLabel("New checklist item").fill("Boxes");
  await dialog.getByRole("button", { name: "Add item" }).click();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const downloadPromise = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Export" }).click();
  const path = testInfo.outputPath("board.json");
  await (await downloadPromise).saveAs(path);
  await settings.getByRole("button", { name: "Close" }).click();

  await deleteCardViaDialog(page, "Packed");
  await expect(page.getByRole("img", { name: /checklist items done/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
  await settings.getByLabel("Import board file").setInputFiles(path);
  await settings.getByRole("button", { name: "Replace" }).click();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("img", { name: "0 of 1 checklist items done" })).toBeVisible();
});
