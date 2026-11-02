import { expect, test, type Page } from "@playwright/test";
import { moveCardTo } from "../support/cardActions";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

async function addCard(page: Page, title: string, list?: string) {
  await page.getByLabel("New card title").fill(title);
  await page.getByRole("button", { name: "Add card" }).click();
  if (list) await moveCardTo(page, title, list);
}

test("empties the archive from the Board actions menu and keeps it empty after a reload", async ({ page }) => {
  await page.getByRole("button", { name: "Board actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Empty archive" })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  await addCard(page, "Keep");
  await addCard(page, "Alpha", "Done");
  await addCard(page, "Beta", "Done");
  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "Archive done cards" }).click();
  await page.getByRole("dialog", { name: "Archive done cards" }).getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("button", { name: "Archived (2)" })).toBeVisible();

  const dialog = page.getByRole("dialog", { name: "Empty archive" });
  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "Empty archive" }).click();
  await expect(dialog).toContainText("Permanently delete 2 cards from the archive? This cannot be undone.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Archived (2)" })).toBeVisible();

  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "Empty archive" }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Archived (0)" })).toBeVisible();
  await expect(page.getByRole("region", { name: /^To do/ }).getByText("Keep")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Archived (0)" })).toBeVisible();
  await page.getByRole("button", { name: "Board actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Empty archive" })).toHaveAttribute("aria-disabled", "true");
});
