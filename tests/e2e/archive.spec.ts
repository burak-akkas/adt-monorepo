import { expect, test } from "@playwright/test";
import { moveCardTo } from "../support/cardActions";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

async function addDoneCard(page: import("@playwright/test").Page, title: string) {
  await page.getByLabel("New card title").fill(title);
  await page.getByRole("button", { name: "Add card" }).click();
  await moveCardTo(page, title, "Done");
}

test("archives Done cards, undoes, restores, deletes and persists", async ({ page }) => {
  const done = page.getByRole("region", { name: /^Done/ });
  await expect(page.getByRole("button", { name: "Archive done" })).toBeDisabled();

  await addDoneCard(page, "Alpha");
  await addDoneCard(page, "Beta");

  await page.getByRole("button", { name: "Archive done" }).click();
  await expect(done.getByText("No cards")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Archived 2 done cards");
  await expect(page.getByRole("button", { name: "Archived (2)" })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(done.getByText("Alpha")).toBeVisible();
  await expect(done.getByText("Beta")).toBeVisible();
  await expect(page.getByRole("button", { name: "Archived (0)" })).toBeVisible();

  await page.getByRole("button", { name: "Archive done" }).click();
  const toggle = page.getByRole("button", { name: "Archived (2)" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await page.getByRole("button", { name: 'Restore "Alpha"' }).click();
  await expect(done.getByText("Alpha")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Archived (1)" }).click();
  const panel = page.getByRole("region", { name: "Archived cards" });
  await expect(panel.getByText("Beta")).toBeVisible();

  await page.getByRole("button", { name: 'Delete "Beta" permanently' }).click();
  await expect(panel.getByText("No archived cards")).toBeVisible();
  await expect(page.getByRole("button", { name: "Archived (0)" })).toBeVisible();
});
