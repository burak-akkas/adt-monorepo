import { expect, test } from "@playwright/test";

test("Settings shows the app version line", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByText(/^Version \S+/)).toBeVisible();
  await expect(dialog.getByText(/undefined/)).toHaveCount(0);
});

test("Settings sets the Done list and a WIP limit, and they persist", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();

  const button = page.getByRole("button", { name: "Settings" });
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByLabel("Done list").selectOption({ label: "Doing" });
  await dialog.getByLabel("WIP limit for To do", { exact: true }).fill("5");
  await dialog.getByRole("button", { name: "Save WIP limit for To do" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();

  await expect(page.getByRole("region", { name: /^Doing/ }).getByText("Done list")).toBeVisible();
  await expect(page.getByRole("region", { name: /^To do/ }).getByText("0 / 5")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("region", { name: /^Doing/ }).getByText("Done list")).toBeVisible();
  await expect(page.getByRole("region", { name: /^To do/ }).getByText("0 / 5")).toBeVisible();
});
