import { expect, test, type Page } from "@playwright/test";
import { moveCardTo } from "../support/cardActions";

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

async function addCard(page: Page, title: string) {
  await page.getByLabel("New card title").fill(title);
  await page.getByRole("button", { name: "Add card" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("sets a WIP limit, warns at and over it, persists and clears", async ({ page }) => {
  const doing = column(page, "Doing");
  await addCard(page, "One");
  await addCard(page, "Two");

  await expect(doing.getByRole("button", { name: /limit/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const input = dialog.getByLabel("WIP limit for Doing", { exact: true });
  await input.fill("0");
  await dialog.getByRole("button", { name: "Save WIP limit for Doing" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a whole number");

  await input.fill("1");
  await dialog.getByRole("button", { name: "Save WIP limit for Doing" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: /^Doing\s*0 \/ 1$/ })).toBeVisible();

  await moveCardTo(page, "One", "Doing");
  await expect(doing.getByText("At limit")).toBeVisible();

  await moveCardTo(page, "Two", "Doing");
  await expect(doing.getByText("Over limit by 1")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: /^Doing\s*2 \/ 1$/ })).toBeVisible();
  await expect(column(page, "Doing").getByText("Over limit by 1")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Clear WIP limit for Doing" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: /^Doing\s*2$/ })).toBeVisible();
  await expect(page.getByText(/Over limit by/)).toHaveCount(0);
});
