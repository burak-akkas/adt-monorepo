import { expect, test, type Page } from "@playwright/test";
import { editCard } from "../support/cardActions";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Two different days of the current month: today, and a day that is never today.
const now = new Date();
const today = iso(now);
const otherDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() === 28 ? 27 : 28);
const other = iso(otherDay);
const third = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() === 14 ? 13 : 14));

const cellName = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const cell = (page: Page, d: Date) => page.getByRole("cell", { name: cellName(d) });

async function addCard(page: Page, title: string) {
  await page.getByLabel("New card title").fill(title);
  await page.getByRole("button", { name: "Add card" }).click();
}

test("shows cards on their due day, moves them by Move to date and drag and drop, and remembers the view", async ({ page }) => {
  await addCard(page, "Pay rent");
  await addCard(page, "Someday");
  await editCard(page, "Pay rent", { dueDate: today });

  await page.getByRole("radio", { name: "Calendar" }).check({ force: true });
  await expect(page.getByRole("button", { name: "Next month" })).toBeVisible();
  await expect(cell(page, now).getByRole("button", { name: /^Pay rent/ })).toBeVisible();
  const unscheduled = page.getByRole("region", { name: "Unscheduled" });
  await expect(unscheduled.getByRole("button", { name: "Someday", exact: true })).toBeVisible();

  // Keyboard path: Move to date.
  await page.getByRole("button", { name: "Move Pay rent to date" }).click();
  const move = page.getByRole("dialog", { name: "Move to date" });
  await move.getByLabel("New due date").fill(other);
  await move.getByRole("button", { name: "Move" }).click();
  await expect(cell(page, otherDay).getByRole("button", { name: /^Pay rent/ })).toBeVisible();

  // The same activity as a due-date change in the card dialog.
  await cell(page, otherDay).getByRole("button", { name: /^Pay rent/ }).click();
  const dialog = page.getByRole("dialog", { name: "Pay rent" });
  await expect(dialog.getByRole("list", { name: "Activity" }).getByRole("listitem").first()).toContainText("Due date set to");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Drag and drop an unscheduled card onto a day.
  const thirdDate = new Date(now.getFullYear(), now.getMonth(), Number(third.slice(8)));
  await unscheduled.getByRole("listitem").dragTo(cell(page, thirdDate));
  await expect(cell(page, thirdDate).getByRole("button", { name: /^Someday/ })).toBeVisible();
  await expect(unscheduled.getByText("No unscheduled cards")).toBeVisible();

  // Navigation.
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(cell(page, otherDay)).toHaveCount(0);
  await page.getByRole("button", { name: "Today" }).click();
  await expect(cell(page, otherDay)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("radio", { name: "Calendar" })).toBeChecked();
  await expect(cell(page, otherDay).getByRole("button", { name: /^Pay rent/ })).toBeVisible();
});

test("marks an overdue card with text and does not scroll the page sideways on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await addCard(page, "Late one");
  const past = new Date(now.getFullYear(), now.getMonth(), 1);
  await editCard(page, "Late one", { dueDate: iso(past) });
  await page.getByRole("radio", { name: "Calendar" }).check({ force: true });
  if (now.getDate() > 1) {
    await expect(cell(page, past).getByText("Overdue")).toBeVisible();
  }
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflows).toBe(false);
});
