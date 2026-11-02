import { expect, test } from "@playwright/test";
import { editCard, moveCardTo } from "../support/cardActions";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("shows cycle time and overdue cards and opens an overdue card", async ({ page }) => {
  await page.getByLabel("New card title").fill("Pay rent");
  await page.getByRole("button", { name: "Add card" }).click();
  await editCard(page, "Pay rent", { dueDate: "2000-01-01" });

  await page.getByLabel("New card title").fill("Ship it");
  await page.getByRole("button", { name: "Add card" }).click();
  await moveCardTo(page, "Ship it", "Doing");
  await moveCardTo(page, "Ship it", "Done");

  const opener = page.getByRole("button", { name: "Board insights" });
  await opener.click();
  const panel = page.getByRole("dialog", { name: "Board insights" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Median")).toBeVisible();
  await expect(panel.getByText("Average")).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Open "Pay rent" \(due / })).toBeVisible();

  const throughput = panel.getByRole("region", { name: "Throughput" });
  await expect(throughput.getByRole("table", { name: "Cards moved to Done per week" }).getByRole("row")).toHaveCount(9);
  await expect(throughput.getByRole("row").last().getByRole("cell")).toHaveText("1");
  const wip = panel.getByRole("region", { name: "WIP over time" });
  await expect(wip.getByRole("table", { name: "Cards in Doing per day" }).getByRole("row")).toHaveCount(15);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(opener).toBeFocused();

  await opener.click();
  await panel.getByRole("button", { name: /^Open "Pay rent" \(due / }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Pay rent" })).toBeVisible();
});

test("does not scroll horizontally on a phone-width screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.getByLabel("New card title").fill("A very long card title that should wrap instead of overflowing the dialog");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("button", { name: "Board insights" }).click();
  const panel = page.getByRole("dialog", { name: "Board insights" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("region", { name: "Throughput" })).toBeAttached();
  await expect(panel.getByRole("region", { name: "WIP over time" })).toBeAttached();
  const dialogOverflow = await panel.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(dialogOverflow).toBe(false);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
