import { expect, test } from "@playwright/test";
import { moveCardTo } from "../support/cardActions";

test("shows the archived card count inside the panel and keeps it updated", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();

  for (const title of ["Alpha", "Beta"]) {
    await page.getByLabel("New card title").fill(title);
    await page.getByRole("button", { name: "Add card" }).click();
    await moveCardTo(page, title, "Done");
  }
  await page.getByRole("button", { name: "Archive done" }).click();
  await page.getByRole("button", { name: "Archived (2)" }).click();

  const panel = page.getByRole("region", { name: "Archived cards" });
  await expect(panel.getByText("2 archived cards", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: 'Restore "Alpha"' }).click();
  await expect(panel.getByText("1 archived card", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: 'Delete "Beta" permanently' }).click();
  await expect(panel.getByText("No archived cards", { exact: true })).toBeVisible();
  await expect(panel.getByText(/^\d+ archived cards?$/)).toHaveCount(0);
});
