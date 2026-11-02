import { expect, test } from "@playwright/test";
import { moveCardTo } from "../support/cardActions";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

const columnTitles = (page: import("@playwright/test").Page) => page.locator('h2[id^="column-"]');

test("adds, renames and reorders lists and keeps them after a reload", async ({ page }) => {
  await page.getByRole("button", { name: "Manage lists" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage lists" });

  await dialog.getByLabel("New list name").fill("Review");
  await dialog.getByRole("button", { name: "Add list" }).click();
  await expect(columnTitles(page)).toHaveText(["To do0", "Doing0", "Done0", "Review0"]);

  await dialog.getByLabel("New list name").fill("doing");
  await dialog.getByRole("button", { name: "Add list" }).click();
  await expect(dialog.getByRole("alert")).toContainText("already exists");

  const name = dialog.getByLabel('Name of list "To do"');
  await name.fill("Backlog");
  await dialog.getByRole("button", { name: 'Rename list "To do"' }).click();

  const left = dialog.getByRole("button", { name: 'Move list "Review" left' });
  await left.focus();
  await page.keyboard.press("Enter");
  await expect(columnTitles(page)).toHaveText(["Backlog0", "Doing0", "Review0", "Done0"]);

  await page.keyboard.press("Escape");
  await page.reload();
  await expect(columnTitles(page)).toHaveText(["Backlog0", "Doing0", "Review0", "Done0"]);
});

test("moves cards out of a list before deleting it", async ({ page }) => {
  await page.getByLabel("New card title").fill("Write docs");
  await page.getByRole("button", { name: "Add card" }).click();

  await page.getByRole("button", { name: "Manage lists" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage lists" });
  await dialog.getByRole("button", { name: 'Delete list "To do"' }).click();
  await dialog.getByRole("group", { name: 'Move cards out of "To do"' }).getByRole("combobox").selectOption({ label: "Doing" });
  await dialog.getByRole("button", { name: "Move cards and delete list" }).click();
  await page.keyboard.press("Escape");

  await expect(columnTitles(page)).toHaveText(["Doing1", "Done0"]);
  await expect(page.getByRole("region", { name: /^Doing/ }).getByText("Write docs")).toBeVisible();
});

test("deleting an empty list asks for confirmation in the app", async ({ page }) => {
  await page.getByRole("button", { name: "Manage lists" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage lists" });
  const confirm = page.getByRole("dialog", { name: "Delete list" });

  await dialog.getByRole("button", { name: 'Delete list "Done"' }).click();
  await expect(confirm.getByText('Delete the empty list "Done"?')).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(dialog.getByLabel('Name of list "Done"')).toBeVisible();

  await dialog.getByRole("button", { name: 'Delete list "Done"' }).click();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(dialog.getByLabel('Name of list "Done"')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(columnTitles(page)).toHaveText(["To do0", "Doing0"]);
});

test("a custom list works with moving, archive and insights", async ({ page }) => {
  await page.getByRole("button", { name: "Manage lists" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage lists" });
  await dialog.getByLabel("New list name").fill("Review");
  await dialog.getByRole("button", { name: "Add list" }).click();
  await page.keyboard.press("Escape");

  await page.getByLabel("New card title").fill("Ship it");
  await page.getByRole("button", { name: "Add card" }).click();
  await moveCardTo(page, "Ship it", "Doing");
  await moveCardTo(page, "Ship it", "Done");
  await moveCardTo(page, "Ship it", "Review");
  await page.getByRole("button", { name: "Archive all cards in Review" }).click();
  await expect(page.getByRole("button", { name: "Archived (1)" })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByLabel("Done list").selectOption({ label: "Review" });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Board insights" }).click();
  const panel = page.getByRole("dialog", { name: "Board insights" });
  await expect(panel.getByRole("table", { name: "Cards moved to Review per week" })).toBeVisible();
});
