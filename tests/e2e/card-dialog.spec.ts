import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

async function addCard(page: Page, title: string) {
  await page.getByLabel("New card title").fill(title);
  await page.getByRole("button", { name: "Add card" }).click();
}

test("edits every field in the dialog, saves, and persists", async ({ page }) => {
  await addCard(page, "Plan trip");
  await page.getByRole("button", { name: "Plan trip", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Plan trip" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Plan trip" })).toBeVisible();
  await expect(dialog.getByText(/^Created \d/)).toBeVisible();

  await dialog.getByLabel("Title").fill("Plan holiday");
  await dialog.getByLabel("Description").fill("Book flights\nPack bags");
  await dialog.getByLabel("Status").selectOption("doing");
  await dialog.getByLabel("Priority").selectOption("high");
  await dialog.getByLabel("Due date").fill("2031-05-06");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();

  await expect(dialog).toBeHidden();
  const doing = page.getByRole("region", { name: /^Doing/ });
  await expect(doing.getByRole("button", { name: "Plan holiday", exact: true })).toBeVisible();
  await expect(doing.getByTestId("priority-badge")).toHaveText("High");
  await expect(doing.getByText("Has notes")).toBeVisible();
  await expect(doing.getByRole("button", { name: "Plan holiday", exact: true })).toBeFocused();

  await page.reload();
  await page.getByRole("button", { name: "Plan holiday", exact: true }).click();
  const reopened = page.getByRole("dialog", { name: "Plan holiday" });
  await expect(reopened.getByLabel("Description")).toHaveValue("Book flights\nPack bags");
  await expect(reopened.getByLabel("Status")).toHaveValue("doing");
  await expect(reopened.getByLabel("Due date")).toHaveValue("2031-05-06");

  await reopened.getByRole("button", { name: "Clear due date" }).click();
  await reopened.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Plan holiday", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Due date")).toHaveValue("");
});

test("blocks Save for an empty title", async ({ page }) => {
  await addCard(page, "Plan trip");
  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill("   ");
  await expect(dialog.getByRole("alert")).toHaveText("Title must not be empty");
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
});

test("cancel, Escape and backdrop confirm before discarding changes", async ({ page }) => {
  await addCard(page, "Plan trip");
  const open = page.getByRole("button", { name: "Plan trip", exact: true });
  const dialog = page.getByRole("dialog", { name: "Plan trip" });
  const confirm = page.getByRole("dialog", { name: "Discard changes" });

  // No changes: closes without asking.
  await open.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(confirm).toBeHidden();

  // Dirty + decline: the in-app confirmation appears and the edits stay.
  await open.click();
  await dialog.getByLabel("Title").fill("Changed");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText("Discard your unsaved changes?")).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Title")).toHaveValue("Changed");

  // Escape asks again, and Escape in the confirmation only dismisses it.
  await page.keyboard.press("Escape");
  await expect(confirm).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(dialog).toBeVisible();

  // Dirty + discard: closed and focus returns to the card.
  await page.keyboard.press("Escape");
  await confirm.getByRole("button", { name: "Discard" }).click();
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await expect(open).toHaveText("Plan trip");

  // Backdrop click (top-left corner, outside the centred dialog).
  await open.click();
  await dialog.getByLabel("Title").fill("Changed again");
  await page.mouse.click(2, 2);
  await expect(confirm).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(confirm).toBeHidden();
  await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2);
  await confirm.getByRole("button", { name: "Discard" }).click();
  await expect(dialog).toBeHidden();
  await expect(open).toHaveText("Plan trip");
});

test("deleting asks for confirmation", async ({ page }) => {
  await addCard(page, "Plan trip");
  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Plan trip" });
  const confirm = page.getByRole("dialog", { name: "Delete card" });

  await dialog.getByRole("button", { name: "Delete card" }).click();
  await expect(confirm.getByText('Delete "Plan trip"?')).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Delete card" }).click();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Plan trip", exact: true })).toHaveCount(0);
});

test("works by keyboard, traps focus and returns focus", async ({ page }) => {
  await addCard(page, "Plan trip");
  const open = page.getByRole("button", { name: "Plan trip", exact: true });
  await open.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Plan trip" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(":focus")).toHaveCount(1);

  // Focus may briefly leave the page for the browser UI, but never lands on the inert board behind.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const behindDialog = await page.evaluate(() => {
      const active = document.activeElement;
      return !!active && active !== document.body && !active.closest("dialog");
    });
    expect(behindDialog).toBe(false);
  }
  await dialog.getByLabel("Title").focus();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

test("fits a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 500 });
  await addCard(page, "Plan trip");
  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const box = await dialog.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375);
  expect(box?.height).toBeLessThanOrEqual(500);
  const save = dialog.getByRole("button", { name: "Save", exact: true });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
});

test("renders in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await addCard(page, "Plan trip");
  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("the card dialog is wide on desktop and fits a mobile viewport", async ({ page }) => {
  await addCard(page, "Plan trip");
  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Plan trip" });
  await expect(dialog).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  const wide = await dialog.boundingBox();
  expect(wide?.width).toBeGreaterThan(512);
  expect(wide?.width).toBeLessThanOrEqual(1280);

  await page.setViewportSize({ width: 375, height: 700 });
  const narrow = await dialog.boundingBox();
  expect(narrow?.width).toBeLessThanOrEqual(375);
  expect(narrow?.x).toBeGreaterThanOrEqual(0);
});
