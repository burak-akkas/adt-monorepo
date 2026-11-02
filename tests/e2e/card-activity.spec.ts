import { expect, test, type Page } from "@playwright/test";
import { moveCardTo } from "../support/cardActions";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

async function openCard(page: Page, title: string) {
  await page.getByRole("button", { name: title, exact: true }).click();
  return page.getByRole("dialog", { name: title });
}

test("shows a persistent activity log newest first, then archive and restore entries", async ({ page }) => {
  await page.getByLabel("New card title").fill("Track me");
  await page.getByRole("button", { name: "Add card" }).click();
  await moveCardTo(page, "Track me", "Doing");

  let dialog = await openCard(page, "Track me");
  await dialog.getByLabel("Priority").selectOption("high");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();

  dialog = await openCard(page, "Track me");
  let items = dialog.getByRole("list", { name: "Activity" }).getByRole("listitem");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("Priority changed from Medium to High");
  await expect(items.nth(1)).toContainText("Moved from To do to Doing");
  await expect(items.nth(2)).toContainText("Created");
  await expect(items.nth(0)).toContainText("just now");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.reload();
  dialog = await openCard(page, "Track me");
  await expect(dialog.getByRole("list", { name: "Activity" }).getByRole("listitem")).toHaveCount(3);
  await dialog.getByLabel("Status").selectOption("done");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();

  await page.getByRole("button", { name: "Archive done" }).click();
  await page.getByRole("button", { name: "Archived (1)" }).click();
  await page.getByRole("button", { name: 'Restore "Track me"' }).click();

  dialog = await openCard(page, "Track me");
  items = dialog.getByRole("list", { name: "Activity" }).getByRole("listitem");
  await expect(items.nth(0)).toContainText("Restored");
  await expect(items.nth(1)).toContainText("Archived");
  await expect(items.nth(2)).toContainText("Moved from Doing to Done");
});

test("fits a phone-width screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.getByLabel("New card title").fill("Small screen");
  await page.getByRole("button", { name: "Add card" }).click();
  const dialog = await openCard(page, "Small screen");
  const log = dialog.getByRole("list", { name: "Activity" });
  await log.scrollIntoViewIfNeeded();
  await expect(log).toBeVisible();
  const box = await log.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
});
