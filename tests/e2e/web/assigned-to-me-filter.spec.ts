import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures";

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

async function addCard(page: Page, title: string) {
  await page.getByLabel("New card title").fill(title);
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
}

async function openCard(page: Page, title: string) {
  await page.getByRole("button", { name: title, exact: true }).click();
  return page.getByRole("dialog", { name: title, exact: true });
}

async function closeCard(page: Page, title: string) {
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
}

test("assign people to cards, filter to mine and keep it after a reload", async ({ page, api, user, seedBoard }) => {
  const board = await seedBoard({ name: "Team board" });
  const teammate = `e2e-teammate-${randomUUID().slice(0, 8)}@example.test`;
  const invited = await api.post(`api/boards/${board.id}/members`, { data: { email: teammate } });
  expect(invited.ok(), `invite failed with ${invited.status()}`).toBe(true);

  await page.goto("./");
  await expect(page.getByRole("combobox", { name: "Board" })).toContainText("Team board");
  for (const title of ["Mine", "Both", "Theirs", "Nobody"]) {
    await addCard(page, title);
  }

  // The toggle is not offered while nothing is assigned to me.
  await expect(page.getByRole("button", { name: /^Assigned to me/ })).toHaveCount(0);

  // The dialog offers the owner and the member; any number of them can be assigned.
  let dialog = await openCard(page, "Mine");
  await dialog.getByRole("checkbox", { name: user.email }).check();
  await closeCard(page, "Mine");

  dialog = await openCard(page, "Both");
  await dialog.getByRole("checkbox", { name: user.email }).check();
  await dialog.getByRole("checkbox", { name: teammate }).check();
  await closeCard(page, "Both");

  dialog = await openCard(page, "Theirs");
  await dialog.getByRole("checkbox", { name: teammate }).check();
  await closeCard(page, "Theirs");

  // Assigning and then removing a person.
  dialog = await openCard(page, "Nobody");
  await dialog.getByRole("checkbox", { name: teammate }).check();
  await dialog.getByRole("checkbox", { name: teammate }).uncheck();
  await expect(dialog.getByRole("checkbox", { name: teammate })).not.toBeChecked();
  await closeCard(page, "Nobody");

  const toggle = page.getByRole("button", { name: "Assigned to me: 2. Show only cards assigned to me" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(page.getByRole("button", { name: "Assigned to me: 2. Show all cards" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(column(page, "To do").getByText("Mine", { exact: true })).toBeVisible();
  await expect(column(page, "To do").getByText("Both", { exact: true })).toBeVisible();
  await expect(column(page, "To do").getByText("Theirs", { exact: true })).toHaveCount(0);
  await expect(column(page, "To do").getByText("Nobody", { exact: true })).toHaveCount(0);

  // It combines with search.
  await page.getByLabel("Search cards").fill("bot");
  await expect(column(page, "To do").getByText("Both", { exact: true })).toBeVisible();
  await expect(column(page, "To do").getByText("Mine", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search" }).click();

  // The assignments survive a reload; the filter itself starts off again.
  await page.reload();
  await expect(page.getByRole("button", { name: "Assigned to me: 2. Show only cards assigned to me" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(column(page, "To do").getByText("Theirs", { exact: true })).toBeVisible();
  dialog = await openCard(page, "Both");
  await expect(dialog.getByRole("checkbox", { name: user.email })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: teammate })).toBeChecked();
  await closeCard(page, "Both");
  dialog = await openCard(page, "Nobody");
  await expect(dialog.getByRole("checkbox", { name: teammate })).not.toBeChecked();
  await closeCard(page, "Nobody");
});
