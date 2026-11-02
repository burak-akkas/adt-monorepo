import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("archives a card from its dialog with the keyboard and restores it from the Archived panel", async ({ page }) => {
  await page.getByLabel("New card title").fill("Ship it");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByLabel("New card title").fill("Stay");
  await page.getByRole("button", { name: "Add card" }).click();

  await page.getByRole("button", { name: "Ship it", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ship it" });
  await dialog.getByRole("button", { name: "Archive" }).focus();
  await page.keyboard.press("Enter");

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ship it", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stay", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Archived (1)" })).toBeVisible();

  await page.getByRole("button", { name: "Archived (1)" }).click();
  const panel = page.getByRole("region", { name: "Archived cards" });
  await expect(panel.getByText("Ship it")).toBeVisible();

  await page.getByRole("button", { name: 'Restore "Ship it"' }).click();
  await expect(page.getByRole("button", { name: "Archived (0)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ship it", exact: true })).toBeVisible();
});
