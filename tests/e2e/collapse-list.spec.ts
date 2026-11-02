import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { moveCardTo } from "../support/cardActions";

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("collapses a list, keeps it after a reload and expands it again", async ({ page }) => {
  await page.getByLabel("New card title").fill("Task");
  await page.getByRole("button", { name: "Add card" }).click();
  await moveCardTo(page, "Task", "Done");

  const collapse = page.getByRole("button", { name: "Collapse Done" });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.focus();
  await page.keyboard.press("Enter");

  const expand = page.getByRole("button", { name: "Expand Done" });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { name: /^Done\s*1$/ })).toBeVisible();
  await expect(page.getByText("Task")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: "Expand Done" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Collapse To do" })).toBeVisible();

  await page.getByRole("button", { name: "Expand Done" }).click();
  await expect(column(page, "Done").getByText("Task")).toBeVisible();
});

test("the collapse icon button has a tooltip and keeps focus after toggling", async ({ page }) => {
  const collapse = page.getByRole("button", { name: "Collapse Doing" });
  await expect(collapse).toHaveAttribute("title", "Collapse Doing");
  await collapse.click();
  await expect(page.getByRole("button", { name: "Expand Doing" })).toHaveAttribute("title", "Expand Doing");
  await page.getByRole("button", { name: "Expand Doing" }).click();

  await expect(page.getByRole("button", { name: "Collapse Doing" })).toBeFocused();
});

test("keeps the list headers intact at phone width, collapsed or expanded", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const width = page.viewportSize()!.width;
  const check = async () => {
    for (const name of ["To do", "Doing", "Done"]) {
      const region = column(page, name);
      for (const button of await region.getByRole("button").all()) {
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
    }
  };
  await check();
  await page.getByRole("button", { name: "Collapse Doing" }).click();
  await check();
  await expect(page.getByRole("button", { name: "Expand Doing" })).toBeVisible();
});

test("remembers collapsed lists per board", async ({ page }) => {
  await page.getByRole("button", { name: "Collapse Done" }).click();
  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "New board" }).click();
  await page.getByLabel("Board name").fill("Other");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("combobox", { name: "Board" }).locator("option:checked")).toHaveText("Other");
  await expect(page.getByRole("button", { name: "Collapse Done" })).toBeVisible();

  await page.getByRole("combobox", { name: "Board" }).selectOption({ label: "My board" });
  await expect(page.getByRole("button", { name: "Expand Done" })).toBeVisible();
});

test("export then import keeps the collapsed list", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Collapse Done" }).click();

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const downloadPromise = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath("board.json");
  await download.saveAs(path);
  expect(await readFile(path, "utf8")).toContain("collapsedLists");
  await settings.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Expand Done" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await settings.getByLabel("Import board file").setInputFiles(path);
  await settings.getByRole("button", { name: "Replace" }).click();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "Expand Done" })).toBeVisible();
});
