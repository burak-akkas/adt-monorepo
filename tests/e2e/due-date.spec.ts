import { expect, test, type Page } from "@playwright/test";
import { editCard, moveCardTo } from "../support/cardActions";

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("sets a due date in the dialog, shows it overdue, persists it and clears it", async ({ page }) => {
  await page.getByLabel("New card title").fill("Pay rent");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByLabel('Due date for "Pay rent"')).toHaveCount(0);

  await editCard(page, "Pay rent", { dueDate: "2000-01-01" });
  await expect(column(page, "To do").getByText("Jan 1")).toBeVisible();
  await expect(column(page, "To do").getByText(/Overdue/)).toBeVisible();

  await page.reload();
  await expect(column(page, "To do").getByText(/Overdue/)).toBeVisible();

  await moveCardTo(page, "Pay rent", "Doing");
  await moveCardTo(page, "Pay rent", "Done");
  await expect(column(page, "Done").getByText("Pay rent")).toBeVisible();
  await expect(column(page, "Done").getByText("Overdue")).toHaveCount(0);
  await expect(column(page, "Done").getByText("Jan 1")).toBeVisible();

  await page.getByRole("button", { name: "Pay rent", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Clear due date" }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(column(page, "Done").getByText("Jan 1")).toHaveCount(0);
});

test("shows due today and due tomorrow chips, but none for later dates or the done list", async ({ page }) => {
  await page.getByLabel("New card title").fill("Soon");
  await page.getByRole("button", { name: "Add card" }).click();

  const [today, tomorrow, later] = await page.evaluate(() => {
    const fmt = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
    };
    return [fmt(0), fmt(1), fmt(5)];
  });

  await editCard(page, "Soon", { dueDate: today });
  await expect(column(page, "To do").getByText("Due today")).toBeVisible();
  await editCard(page, "Soon", { dueDate: tomorrow });
  await expect(column(page, "To do").getByText("Due tomorrow")).toBeVisible();
  await expect(column(page, "To do").getByText("Due today")).toHaveCount(0);
  await editCard(page, "Soon", { dueDate: later });
  await expect(column(page, "To do").getByText(/^Due (today|tomorrow)$/)).toHaveCount(0);

  await editCard(page, "Soon", { dueDate: today, list: "Done" });
  await expect(column(page, "Done").getByText("Due today")).toHaveCount(0);
});

test("quick due date buttons set the due date in the dialog", async ({ page }) => {
  await page.getByLabel("New card title").fill("Quick");
  await page.getByRole("button", { name: "Add card" }).click();

  const [today, tomorrow, nextWeek] = await page.evaluate(() => {
    const fmt = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
    };
    return [fmt(0), fmt(1), fmt(7)];
  });

  await page.getByRole("button", { name: "Quick", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const due = dialog.getByLabel("Due date", { exact: true });
  await dialog.getByRole("button", { name: "Today" }).click();
  await expect(due).toHaveValue(today);
  await dialog.getByRole("button", { name: "Next week" }).click();
  await expect(due).toHaveValue(nextWeek);
  await dialog.getByRole("button", { name: "Tomorrow" }).focus();
  await expect(dialog.getByRole("button", { name: "Tomorrow" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(due).toHaveValue(tomorrow);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(column(page, "To do").getByText("Due tomorrow")).toBeVisible();
});
