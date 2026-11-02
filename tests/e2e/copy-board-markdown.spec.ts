import { expect, test } from "@playwright/test";
import { editCard } from "../support/cardActions";

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

async function addCard(page: import("@playwright/test").Page, title: string) {
  await page.getByLabel("New card title").fill(title);
  await page.getByRole("button", { name: "Add card" }).click();
}

test("copies the board as Markdown with due dates and empty lists", async ({ page }) => {
  await addCard(page, "Pay rent");
  await addCard(page, "Call Sam");
  await editCard(page, "Pay rent", { dueDate: "2026-11-05" });

  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "Copy as Markdown" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copied as Markdown" })).toBeVisible();

  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe(
    "# My board\n\n## To do\n- Pay rent (due 2026-11-05)\n- Call Sam\n\n## Doing\n_No cards_\n\n## Done\n_No cards_\n",
  );
  await expect(page.getByRole("status")).toBeHidden({ timeout: 6000 });
});

test("shows the Markdown to copy by hand when the clipboard is unavailable", async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  await addCard(page, "Pay rent");

  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "Copy as Markdown" }).click();
  const status = page.getByRole("status");
  await expect(status).toContainText("## To do");
  await expect(status).toContainText("- Pay rent");
  await status.getByRole("button", { name: "Dismiss" }).click();
  await expect(status).toBeHidden();
});
