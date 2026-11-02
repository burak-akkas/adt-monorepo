import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("saves a card as a template, adds from it, manages templates and keeps them after a reload", async ({ page }) => {
  await page.getByLabel("New card title").fill("Plan trip");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByLabel("From template")).toHaveCount(0);

  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Plan trip" });
  await dialog.getByLabel("Labels").fill("travel");
  await dialog.getByRole("button", { name: "Add label" }).click();
  await dialog.getByLabel("New checklist item").fill("Book");
  await dialog.getByRole("button", { name: "Add item" }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();

  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Plan trip" });
  await dialog.getByRole("button", { name: "Save as template" }).click();
  await expect(dialog.getByRole("status")).toContainText('Saved template "Plan trip"');
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Keyboard path through the add form.
  await page.getByLabel("From template").selectOption({ label: "Plan trip" });
  await page.getByLabel("Target list").selectOption({ label: "Doing" });
  await expect(page.getByLabel("New card title")).toHaveValue("Plan trip");
  await page.getByLabel("New card title").focus();
  await page.keyboard.press("Enter");
  const doing = page.getByRole("region", { name: /^Doing/ });
  await expect(doing.getByRole("button", { name: "Plan trip", exact: true })).toBeVisible();
  await expect(doing.getByText("travel")).toBeVisible();

  await page.getByRole("button", { name: "Templates" }).click();
  const panel = page.getByRole("dialog", { name: "Templates" });
  await panel.getByLabel('Name of template "Plan trip"').fill("Trip");
  await panel.getByRole("button", { name: 'Rename template "Plan trip"' }).click();
  await expect(panel.getByLabel('Name of template "Trip"')).toBeVisible();
  await page.keyboard.press("Escape");

  await page.reload();
  await page.getByRole("button", { name: "Templates" }).click();
  await expect(page.getByLabel('Name of template "Trip"')).toBeVisible();

  await page.getByRole("button", { name: 'Delete template "Trip"' }).click();
  await page.getByRole("dialog", { name: "Delete template" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(/No templates yet/)).toBeVisible();
});

test("does not scroll horizontally on a phone width with templates", async ({ page }) => {
  await page.getByLabel("New card title").fill("Plan trip");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  await page.getByRole("dialog", { name: "Plan trip" }).getByRole("button", { name: "Save as template" }).click();
  await page.getByRole("dialog", { name: "Plan trip" }).getByRole("button", { name: "Cancel" }).click();

  await page.setViewportSize({ width: 360, height: 740 });
  await expect(page.getByLabel("From template")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
