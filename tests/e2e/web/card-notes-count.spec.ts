import { expect, test } from "@playwright/test";

test("shows a character count under the card description that updates as you type", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();

  await page.getByLabel("New card title").fill("Count me");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("button", { name: "Count me", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Count me" });
  await expect(dialog.getByText("0 characters")).toBeVisible();

  const description = dialog.getByLabel("Description");
  await description.pressSequentially("a");
  await expect(dialog.getByText("1 character", { exact: true })).toBeVisible();

  await description.pressSequentially("bcd");
  await expect(dialog.getByText("4 characters")).toBeVisible();
});
