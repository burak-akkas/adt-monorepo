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

test("archives the done list from the Board actions menu", async ({ page }) => {
  const done = page.getByRole("region", { name: /^Done/ });
  await page.getByRole("button", { name: "Board actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Archive done cards" })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  await addCard(page, "Keep");
  await addCard(page, "Alpha", "Done");
  await addCard(page, "Beta", "Done");

  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "Archive done cards" }).click();
  const dialog = page.getByRole("dialog", { name: "Archive done cards" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(done.getByText("Alpha")).toBeVisible();

  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "Archive done cards" }).click();
  await dialog.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(done.getByText("No cards")).toBeVisible();
  await expect(page.getByRole("region", { name: /^To do/ }).getByText("Keep")).toBeVisible();

  await page.getByRole("button", { name: "Archived (2)" }).click();
  await page.getByRole("button", { name: 'Restore "Alpha"' }).click();
  await expect(done.getByText("Alpha")).toBeVisible();
});
