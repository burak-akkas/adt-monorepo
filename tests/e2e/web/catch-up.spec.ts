import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures";

// Tab A is the `page`; tab B is a second browser context signed in as the same user.
const focus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));

async function addCard(page: Page, title: string) {
  await page.getByLabel("New card title").fill(title);
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByLabel("New card title")).toBeVisible();
});

test("a change made in one tab shows in the other after it regains focus", async ({ page, browser, api, baseURL }) => {
  const other = await browser.newContext({ baseURL, storageState: await api.storageState() });
  try {
    const tabB = await other.newPage();
    await tabB.goto("./");
    await expect(tabB.getByLabel("New card title")).toBeVisible();

    await addCard(page, "From tab A");
    // A reload shows the card was saved on the server before the other tab looks.
    await page.reload();
    await expect(page.getByRole("button", { name: "From tab A", exact: true })).toBeVisible();
    await expect(tabB.getByRole("button", { name: "From tab A", exact: true })).toHaveCount(0);

    await focus(tabB);
    await expect(tabB.getByRole("button", { name: "From tab A", exact: true })).toBeVisible();
  } finally {
    await other.close();
  }
});

test("an edit to a card deleted in the other tab says so and shows the server's board", async ({ page, browser, api, baseURL }) => {
  await addCard(page, "Doomed");
  await addCard(page, "Survivor");
  const other = await browser.newContext({ baseURL, storageState: await api.storageState() });
  try {
    const tabB = await other.newPage();
    await tabB.goto("./");
    await expect(tabB.getByRole("button", { name: "Doomed", exact: true })).toBeVisible();

    // Tab A deletes the card.
    await page.getByRole("button", { name: "Doomed", exact: true }).click();
    await page.getByRole("dialog", { name: "Doomed" }).getByRole("button", { name: "Delete card" }).click();
    await page.getByRole("dialog", { name: "Delete card" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name: "Doomed", exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Survivor", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Doomed", exact: true })).toHaveCount(0);

    // Tab B still shows it and edits it.
    await tabB.getByRole("button", { name: "Doomed", exact: true }).click();
    const dialog = tabB.getByRole("dialog", { name: "Doomed" });
    await dialog.getByLabel("Title").fill("Doomed, edited");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();

    await expect(tabB.getByRole("alert").filter({ hasText: "changed somewhere else" })).toBeVisible();
    await expect(tabB.getByRole("button", { name: /^Doomed/ })).toHaveCount(0);
    await expect(tabB.getByRole("button", { name: "Survivor", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Survivor", exact: true })).toBeVisible();
  } finally {
    await other.close();
  }
});

test("a stale edit does not undo the other tab's change, and the stale tab catches up", async ({ page, browser, api, baseURL }) => {
  await addCard(page, "Shared card");
  const other = await browser.newContext({ baseURL, storageState: await api.storageState() });
  try {
    const tabB = await other.newPage();
    await tabB.goto("./");
    await expect(tabB.getByRole("button", { name: "Shared card", exact: true })).toBeVisible();

    // Tab A renames the card.
    await page.getByRole("button", { name: "Shared card", exact: true }).click();
    const dialogA = page.getByRole("dialog", { name: "Shared card" });
    await dialogA.getByLabel("Title").fill("Renamed in A");
    await dialogA.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Renamed in A", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Renamed in A", exact: true })).toBeVisible();

    // Tab B, still on the old title, changes only the priority.
    await tabB.getByRole("button", { name: "Shared card", exact: true }).click();
    const dialogB = tabB.getByRole("dialog", { name: "Shared card" });
    await dialogB.getByLabel("Priority").selectOption("high");
    await dialogB.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialogB).toBeHidden();

    await focus(tabB);
    await expect(tabB.getByRole("button", { name: "Renamed in A", exact: true })).toBeVisible();
    await expect(tabB.getByRole("button", { name: "Shared card", exact: true })).toHaveCount(0);
    await expect(tabB.getByTestId("priority-badge")).toHaveText("High");

    // Nothing of tab A's was reverted on the server.
    await page.reload();
    await expect(page.getByRole("button", { name: "Renamed in A", exact: true })).toBeVisible();
    await expect(page.getByTestId("priority-badge")).toHaveText("High");
  } finally {
    await other.close();
  }
});
