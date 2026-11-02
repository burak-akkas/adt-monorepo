import { expect, test } from "@playwright/test";

test("collapsing the board summary persists across reloads", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();

  await page.getByLabel("New card title").fill("Pay rent");
  await page.getByRole("button", { name: "Add card" }).click();

  const summary = page.getByRole("region", { name: "Board summary" });
  const progress = page.getByRole("progressbar", { name: "Cards done" });
  await expect(progress).toBeVisible();

  await summary.getByRole("button", { name: "Collapse board summary" }).click();
  await expect(progress).toHaveCount(0);
  await expect(summary.getByText("0% done")).toBeVisible();
  await expect(summary.getByRole("button", { name: "Expand board summary" })).toHaveAttribute("aria-expanded", "false");

  await page.reload();
  await expect(summary.getByRole("button", { name: "Expand board summary" })).toHaveAttribute("aria-expanded", "false");
  await expect(progress).toHaveCount(0);

  await summary.getByRole("button", { name: "Expand board summary" }).click();
  await expect(progress).toBeVisible();

  await page.reload();
  await expect(summary.getByRole("button", { name: "Collapse board summary" })).toHaveAttribute("aria-expanded", "true");
  await expect(progress).toBeVisible();
});
