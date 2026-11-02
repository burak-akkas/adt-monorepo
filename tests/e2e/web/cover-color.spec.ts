import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
  await page.getByLabel("New card title").fill("Plan trip");
  await page.getByRole("button", { name: "Add card" }).click();
});

test("picks a cover color, sees it on the card, keeps it after reload and clears it", async ({ page }) => {
  const card = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Plan trip", exact: true }) });
  await expect(card.getByTestId("cover-stripe")).toHaveCount(0);

  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Plan trip" });
  await expect(dialog.getByRole("radio", { name: /^Cover color: / })).toHaveCount(9);
  await dialog.getByRole("radio", { name: "Cover color: Blue" }).check({ force: true });
  await expect(dialog.getByTestId("cover-preview")).toBeVisible();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();

  await expect(card.getByTestId("cover-stripe")).toBeVisible();
  await expect(card).toHaveAccessibleDescription("Cover color: Blue");

  await page.reload();
  await expect(card.getByTestId("cover-stripe")).toBeVisible();
  await expect(card).toHaveAccessibleDescription("Cover color: Blue");

  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  const reopened = page.getByRole("dialog", { name: "Plan trip" });
  await expect(reopened.getByRole("radio", { name: "Cover color: Blue" })).toBeChecked();
  await reopened.getByRole("radio", { name: "Cover color: None" }).check({ force: true });
  await reopened.getByRole("button", { name: "Save", exact: true }).click();
  await expect(card.getByTestId("cover-stripe")).toHaveCount(0);
});

test("the stripe is visible in dark mode too", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Plan trip" });
  await dialog.getByRole("radio", { name: "Cover color: Green" }).check({ force: true });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("cover-stripe")).toBeVisible();
});
