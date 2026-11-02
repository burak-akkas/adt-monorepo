import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

async function addCard(page: import("@playwright/test").Page, title: string) {
  await page.getByLabel("New card title").fill(title);
  await page.getByRole("button", { name: "Add card" }).click();
}

test("switches to the table, sorts, filters, opens a card and remembers the view", async ({ page }) => {
  await addCard(page, "Banana");
  await addCard(page, "Apple");
  await page.getByRole("button", { name: "Banana", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Banana" });
  await dialog.getByLabel("Status").selectOption({ label: "Doing" });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();

  await page.getByRole("radio", { name: "Table" }).check({ force: true });
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  const titles = () => table.locator("tbody tr td:first-child").allTextContents();

  const titleHeader = page.getByRole("columnheader", { name: "Title" });
  await titleHeader.getByRole("button").click();
  await expect(titleHeader).toHaveAttribute("aria-sort", "ascending");
  expect(await titles()).toEqual(["Apple", "Banana"]);
  await titleHeader.getByRole("button").click();
  await expect(titleHeader).toHaveAttribute("aria-sort", "descending");
  expect(await titles()).toEqual(["Banana", "Apple"]);

  await page.getByLabel("Filter table by list").selectOption({ label: "Doing" });
  expect(await titles()).toEqual(["Banana"]);
  await page.getByLabel("Filter table by list").selectOption({ label: "All lists" });

  await table.getByRole("button", { name: "Apple" }).click();
  await expect(page.getByRole("dialog", { name: "Apple" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.reload();
  await expect(page.getByRole("radio", { name: "Table" })).toBeChecked();
  await expect(page.getByRole("table")).toBeVisible();

  await page.getByRole("radio", { name: "Board" }).check({ force: true });
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("region", { name: /^To do/ })).toBeVisible();
});

test("the table scrolls inside its container on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await addCard(page, "A card with a rather long title to widen things");
  await page.getByRole("radio", { name: "Table" }).check({ force: true });
  await expect(page.getByRole("table")).toBeVisible();
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
});
