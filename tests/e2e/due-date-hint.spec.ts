import { expect, test } from "@playwright/test";

test("card dialog shows a relative due date hint that follows the date field", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
  await page.getByLabel("New card title").fill("Hinted");
  await page.getByRole("button", { name: "Add card" }).click();

  const [today, later] = await page.evaluate(() => {
    const fmt = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
    };
    return [fmt(0), fmt(5)];
  });

  await page.getByRole("button", { name: "Hinted", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const due = dialog.getByLabel("Due date", { exact: true });
  await expect(dialog.getByText(/^(Due (today|tomorrow|in )|Overdue)/)).toHaveCount(0);

  await due.fill(today);
  await expect(dialog.getByText("Due today")).toBeVisible();
  await due.fill(later);
  await expect(dialog.getByText("Due in 5 days")).toBeVisible();
  await due.fill("2000-01-01");
  await expect(dialog.getByText(/^Overdue by \d+ days$/)).toBeVisible();

  await dialog.getByRole("button", { name: "Clear due date" }).click();
  await expect(dialog.getByText(/^(Due (today|tomorrow|in )|Overdue)/)).toHaveCount(0);
});
