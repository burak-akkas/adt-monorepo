import { expect, test } from "@playwright/test";
import { editCard } from "../support/cardActions";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
});

test("adds, persists and removes notes in the dialog, with only an indicator on the card", async ({ page }) => {
  await page.getByLabel("New card title").fill("Plan trip");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByText("Has notes")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /notes/i })).toHaveCount(0);

  await editCard(page, "Plan trip", { notes: "Book flights\nPack bags" });
  await expect(page.getByText("Has notes")).toBeVisible();
  await expect(page.getByText("Book flights")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /notes/i })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("Has notes")).toBeVisible();
  await page.getByRole("button", { name: "Plan trip", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Description")).toHaveValue("Book flights\nPack bags");
  await page.keyboard.press("Escape");

  await editCard(page, "Plan trip", { notes: "" });
  await expect(page.getByText("Has notes")).toHaveCount(0);
});
