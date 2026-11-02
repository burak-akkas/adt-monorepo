import { expect, test } from "@playwright/test";

test("Settings sets a board background color, an image URL, and resets it", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
  const background = page.locator("[data-board-background]");
  await expect(background).toHaveCount(0);

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByLabel("Background color").fill("#336699");
  await page.keyboard.press("Escape");
  await expect(background).toHaveAttribute("data-board-background", "color");
  await expect(background).toHaveCSS("background-color", "rgb(51, 102, 153)");

  await page.reload();
  await expect(background).toHaveCSS("background-color", "rgb(51, 102, 153)");

  await page.getByRole("button", { name: "Settings" }).click();
  await dialog.getByLabel("Background image URL").fill("javascript:alert(1)");
  await dialog.getByRole("button", { name: "Set image" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();

  // A valid but unreachable image falls back to the default without breaking the board.
  await dialog.getByLabel("Background image URL").fill("http://127.0.0.1:1/missing.jpg");
  await dialog.getByRole("button", { name: "Set image" }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(background).toHaveCount(0);
  await expect(page.getByRole("region", { name: /^To do/ })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await dialog.getByLabel("Background color").fill("#112233");
  await dialog.getByRole("button", { name: "Reset background" }).click();
  await page.keyboard.press("Escape");
  await expect(background).toHaveCount(0);
  await page.reload();
  await expect(background).toHaveCount(0);
});
