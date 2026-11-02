import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("posts a comment with Ctrl+Enter", async ({ page }) => {
  await page.getByLabel("New card title").fill("Keyboard card");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("button", { name: "Keyboard card", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Keyboard card" });
  await expect(dialog.getByText("Ctrl+Enter to post")).toBeVisible();
  const field = dialog.getByLabel("New comment");
  await field.fill("Posted by keyboard");
  await field.press("Control+Enter");
  await expect(dialog.getByRole("list", { name: "Comments" }).getByRole("listitem")).toHaveCount(1);
  await expect(dialog.getByRole("list", { name: "Comments" })).toContainText("Posted by keyboard");
  await expect(field).toHaveValue("");
  await expect(dialog).toBeVisible();
});

test("toggles newest-first comment order and keeps it after a reload", async ({ page }) => {
  await page.getByLabel("New card title").fill("Ordered card");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("button", { name: "Ordered card", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ordered card" });
  await expect(dialog.getByRole("button", { name: "Newest first" })).toHaveCount(0);

  for (const text of ["Older one", "Newer one"]) {
    await dialog.getByLabel("New comment").fill(text);
    await dialog.getByRole("button", { name: "Add comment" }).click();
  }
  const items = dialog.getByRole("list", { name: "Comments" }).getByRole("listitem");
  await expect(items.nth(0)).toContainText("Older one");

  await dialog.getByRole("button", { name: "Newest first" }).click();
  await expect(items.nth(0)).toContainText("Newer one");
  await expect(items.nth(1)).toContainText("Older one");

  await page.reload();
  await page.getByRole("button", { name: "Ordered card", exact: true }).click();
  const reopened = page.getByRole("dialog").getByRole("list", { name: "Comments" }).getByRole("listitem");
  await expect(reopened.nth(0)).toContainText("Newer one");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Newest first" })).toHaveAttribute("aria-pressed", "true");
});

test("shows the comment count in the heading and keeps it after reopening", async ({ page }) => {
  await page.getByLabel("New card title").fill("Counted card");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByRole("button", { name: "Counted card", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Counted card" });
  await expect(dialog.getByRole("heading", { name: "Comments", exact: true })).toBeVisible();

  for (const text of ["One", "Two"]) {
    await dialog.getByLabel("New comment").fill(text);
    await dialog.getByRole("button", { name: "Add comment" }).click();
  }
  await expect(dialog.getByRole("heading", { name: "Comments (2)", exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Delete comment 1" }).click();
  await dialog.getByRole("button", { name: "Confirm delete" }).click();
  await expect(dialog.getByRole("heading", { name: "Comments (1)", exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Counted card", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Comments (1)", exact: true })).toBeVisible();

  await page.getByRole("dialog").getByRole("button", { name: "Delete comment 1" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Comments", exact: true })).toBeVisible();
});

test("adds, edits and deletes comments, with a count badge that persists and survives archiving", async ({ page }) => {
  await page.getByLabel("New card title").fill("Plan trip");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByLabel(/comments?$/)).toHaveCount(0);

  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Plan trip" });
  await expect(dialog.getByRole("button", { name: "Add comment" })).toBeDisabled();

  await dialog.getByLabel("New comment").fill("Book flights");
  await dialog.getByRole("button", { name: "Add comment" }).click();
  await dialog.getByLabel("New comment").fill("Pack bags");
  await dialog.getByRole("button", { name: "Add comment" }).click();

  const items = dialog.getByRole("list", { name: "Comments" }).getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Book flights");
  await expect(items.nth(1)).toContainText("Pack bags");
  await expect(items.nth(0)).toContainText("just now");
  await expect(items.nth(0).getByRole("tooltip")).not.toBeEmpty();

  await dialog.getByRole("button", { name: "Edit comment 2" }).click();
  await dialog.getByRole("textbox", { name: "Edit comment 2" }).fill("Pack light");
  await dialog.getByRole("button", { name: "Save comment" }).click();
  await expect(items.nth(1)).toContainText("Pack light");
  await expect(items.nth(1)).toContainText("edited");

  await dialog.getByRole("button", { name: "Delete comment 1" }).click();
  await expect(dialog.getByText("Delete this comment?")).toBeVisible();
  await dialog.getByRole("button", { name: "Keep" }).click();
  await expect(items).toHaveCount(2);
  await dialog.getByRole("button", { name: "Delete comment 1" }).click();
  await dialog.getByRole("button", { name: "Confirm delete" }).click();
  await expect(items).toHaveCount(1);

  await dialog.getByLabel("New comment").fill("Second again");
  await dialog.getByRole("button", { name: "Add comment" }).click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("2 comments")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("2 comments")).toBeVisible();

  // Move to Done, archive and restore: the comments come along.
  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Status").selectOption("done");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Archive done" }).click();
  await expect(page.getByLabel("2 comments")).toHaveCount(0);
  await page.getByRole("button", { name: "Archived (1)" }).click();
  await page.getByRole("button", { name: 'Restore "Plan trip"' }).click();
  await expect(page.getByLabel("2 comments")).toBeVisible();
  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Pack light")).toBeVisible();
});
