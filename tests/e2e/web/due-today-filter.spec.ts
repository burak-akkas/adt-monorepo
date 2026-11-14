import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures";
import { editCard } from "../../support/cardActions";

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function addCard(page: Page, title: string) {
  await page.getByLabel("New card title").fill(title);
  await page.getByRole("button", { name: "Add card" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("summary bar filters the board to cards due today", async ({ page }) => {
  for (const title of ["Standup", "Ship it", "Late one", "Someday"]) {
    await addCard(page, title);
  }
  await editCard(page, "Standup", { dueDate: localToday() });
  await editCard(page, "Ship it", { dueDate: localToday() });
  await editCard(page, "Late one", { dueDate: "2000-01-01" });

  const dueToday = page.getByRole("button", { name: "Due today: 2. Show only cards due today" });
  await expect(dueToday).toHaveAttribute("aria-pressed", "false");

  await dueToday.click();
  const pressed = page.getByRole("button", { name: "Due today: 2. Show all cards" });
  await expect(pressed).toHaveAttribute("aria-pressed", "true");
  await expect(column(page, "To do").getByText("Standup")).toBeVisible();
  await expect(column(page, "To do").getByText("Ship it")).toBeVisible();
  await expect(column(page, "To do").getByText("Late one")).toHaveCount(0);
  await expect(column(page, "To do").getByText("Someday")).toHaveCount(0);

  // Turning on overdue turns due today off.
  await page.getByRole("button", { name: /^Overdue: 1/ }).click();
  await expect(page.getByRole("button", { name: "Due today: 2. Show only cards due today" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(column(page, "To do").getByText("Late one")).toBeVisible();
  await expect(column(page, "To do").getByText("Standup")).toHaveCount(0);

  // Keyboard: focus the button and press Enter, then press again to show everything.
  const again = page.getByRole("button", { name: "Due today: 2. Show only cards due today" });
  await again.focus();
  await page.keyboard.press("Enter");
  await expect(column(page, "To do").getByText("Standup")).toBeVisible();
  await expect(column(page, "To do").getByText("Late one")).toHaveCount(0);

  await page.getByRole("button", { name: "Due today: 2. Show all cards" }).click();
  await expect(column(page, "To do").getByText("Someday")).toBeVisible();
  await expect(column(page, "To do").getByText("Late one")).toBeVisible();
});
