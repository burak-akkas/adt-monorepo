import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

async function copyLink(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "Copy board link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

test("copies the link of the current board and follows the selected board", async ({ page }) => {
  await expect(page).toHaveURL(/\?board=/);
  const first = await copyLink(page);
  expect(first).toBe(page.url());

  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "New board" }).click();
  await page.getByLabel("Board name").fill("Work");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("combobox", { name: "Board" })).toHaveValue(/.+/);

  const second = await copyLink(page);
  expect(second).toBe(page.url());
  expect(second).not.toBe(first);
});
