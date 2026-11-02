import { expect, test, type Page } from "@playwright/test";
import { deleteCardViaDialog, moveCardTo } from "../support/cardActions";

// Every test gets a fresh browser context, so localStorage starts empty.
// page.goto("./") resolves against baseURL, which also works for PR previews under /<repo>/pr-N/.

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

async function addCard(page: Page, title: string) {
  await page.getByLabel("New card title").fill(title);
  await page.getByRole("button", { name: "Add card" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("shows three empty columns", async ({ page }) => {
  for (const name of ["To do", "Doing", "Done"]) {
    await expect(column(page, name).getByText("No cards")).toBeVisible();
  }
});

test("adds a card to To do", async ({ page }) => {
  await addCard(page, "Write the e2e suite");
  await expect(column(page, "To do").getByText("Write the e2e suite")).toBeVisible();
  await expect(page.getByLabel("New card title")).toHaveValue("");
});

test("moves a card across the board and back", async ({ page }) => {
  await addCard(page, "Ship it");
  await moveCardTo(page, "Ship it", "Doing");
  await moveCardTo(page, "Ship it", "Done");
  await expect(column(page, "Done").getByText("Ship it")).toBeVisible();

  await moveCardTo(page, "Ship it", "Doing");
  await expect(column(page, "Doing").getByText("Ship it")).toBeVisible();
  await expect(column(page, "Done").getByText("No cards")).toBeVisible();
});

test("deletes a card from its dialog", async ({ page }) => {
  await addCard(page, "Oops");
  await deleteCardViaDialog(page, "Oops");
  await expect(page.getByText("Oops")).toHaveCount(0);
});

test("cards are read-only on the board", async ({ page }) => {
  await addCard(page, "Plain card");
  const card = column(page, "To do").getByRole("listitem");
  await expect(card.getByRole("button", { name: "Plain card", exact: true })).toBeVisible();
  await expect(card.getByTestId("priority-badge")).toBeVisible();
  await expect(card.getByRole("combobox")).toHaveCount(0);
  await expect(card.getByRole("button")).toHaveCount(1);
});

test("renames a card in its dialog and keeps it after a reload", async ({ page }) => {
  await addCard(page, "First");
  await addCard(page, "Second");
  await addCard(page, "Third");

  await page.getByRole("button", { name: "Second", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Title").fill("  Second, edited ");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();

  const items = column(page, "To do").getByRole("listitem");
  await expect(items.nth(1)).toContainText("Second, edited");

  await page.reload();
  await expect(items.nth(0)).toContainText("First");
  await expect(items.nth(1)).toContainText("Second, edited");
  await expect(items.nth(2)).toContainText("Third");
});

test("keeps cards after a reload", async ({ page }) => {
  await addCard(page, "Remember me");
  await page.reload();
  await expect(column(page, "To do").getByText("Remember me")).toBeVisible();
});

test("filters cards with the search box", async ({ page }) => {
  await addCard(page, "Write docs");
  await addCard(page, "Fix bug");
  await moveCardTo(page, "Fix bug", "Doing");

  const search = page.getByLabel("Search cards");
  await search.fill("DOCS");
  await expect(column(page, "To do").getByText("Write docs")).toBeVisible();
  await expect(page.getByText("Fix bug")).toHaveCount(0);
  await expect(column(page, "Doing").getByText("No matching cards")).toBeVisible();

  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(search).toHaveValue("");
  await expect(column(page, "Doing").getByText("Fix bug")).toBeVisible();

  await search.fill("zzz");
  await expect(column(page, "To do").getByText("No matching cards")).toBeVisible();
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(column(page, "To do").getByText("Write docs")).toBeVisible();

  await search.fill("docs");
  await page.reload();
  await expect(page.getByLabel("Search cards")).toHaveValue("");
  await expect(column(page, "Doing").getByText("Fix bug")).toBeVisible();
});
