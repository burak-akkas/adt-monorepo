import { expect, test } from "@playwright/test";

test("a list header shows the full list name as a tooltip", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();

  const name = "Quarterly roadmap review items";
  await page.getByRole("button", { name: "Manage lists" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage lists" });
  await dialog.getByLabel("New list name").fill(name);
  await dialog.getByRole("button", { name: "Add list" }).click();
  await page.keyboard.press("Escape");

  const heading = page.getByRole("heading", { name: new RegExp(`^${name}`) });
  await expect(heading.getByText(name)).toHaveAttribute("title", name);
});
