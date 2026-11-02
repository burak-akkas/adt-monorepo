import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { deleteCardViaDialog } from "../support/cardActions";

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  return settings;
}

test("the page header has no Export or Import buttons", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Export" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import" })).toHaveCount(0);
});

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("exports the board and imports it back after confirming", async ({ page }, testInfo) => {
  await page.getByLabel("New card title").fill("Backup me");
  await page.getByRole("button", { name: "Add card" }).click();

  const settings = await openSettings(page);
  const downloadPromise = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^kanban-board-\d{4}-\d{2}-\d{2}\.json$/);
  const path = testInfo.outputPath("board.json");
  await download.saveAs(path);
  expect(await readFile(path, "utf8")).toContain("Backup me");
  await settings.getByRole("button", { name: "Close" }).click();

  await deleteCardViaDialog(page, "Backup me");
  await expect(page.getByText("Backup me")).toHaveCount(0);

  const reopened = await openSettings(page);
  await reopened.getByLabel("Import board file").setInputFiles(path);
  await expect(reopened.getByRole("alertdialog")).toContainText("Replace the current board");
  await reopened.getByRole("button", { name: "Replace" }).click();
  await reopened.getByRole("button", { name: "Close" }).click();

  await expect(column(page, "To do").getByText("Backup me")).toBeVisible();
  await page.reload();
  await expect(column(page, "To do").getByText("Backup me")).toBeVisible();
});

test("rejects a foreign JSON file and keeps the board", async ({ page }) => {
  await page.getByLabel("New card title").fill("Keep me");
  await page.getByRole("button", { name: "Add card" }).click();

  const settings = await openSettings(page);
  await settings.getByLabel("Import board file").setInputFiles({
    name: "other.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"hello":"world"}'),
  });

  await expect(settings.getByRole("alert").filter({ hasText: "not a Kanban board" })).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(column(page, "To do").getByText("Keep me")).toBeVisible();
});
