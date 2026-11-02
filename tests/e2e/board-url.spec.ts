import { expect, test, type Page } from "@playwright/test";

const select = (page: Page) => page.getByRole("combobox", { name: "Board" });
const selected = (page: Page) => select(page).locator("option:checked");

test("the URL follows the board, the back button returns to the previous board, unknown ids fall back", async ({
  page,
}) => {
  await page.goto("./");
  await expect(selected(page)).toHaveText("My board");
  await expect(page).toHaveURL(/\?board=.+/);

  await page.getByRole("button", { name: "Board actions" }).click();
  await page.getByRole("menuitem", { name: "New board" }).click();
  await page.getByLabel("Board name").fill("Work");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(selected(page)).toHaveText("Work");
  const workUrl = page.url();

  await select(page).selectOption({ label: "My board" });
  await expect(selected(page)).toHaveText("My board");
  expect(page.url()).not.toBe(workUrl);

  await page.goBack();
  await expect(selected(page)).toHaveText("Work");
  await expect(page).toHaveURL(workUrl);
  await page.goForward();
  await expect(selected(page)).toHaveText("My board");

  await page.reload();
  await expect(selected(page)).toHaveText("My board");

  await page.goto("./?board=does-not-exist");
  await expect(selected(page)).toHaveText("My board");
  await expect(page).not.toHaveURL(/does-not-exist/);

  await select(page).selectOption({ label: "Work" });
  await page.goto("./");
  await expect(selected(page)).toHaveText("Work");
});
