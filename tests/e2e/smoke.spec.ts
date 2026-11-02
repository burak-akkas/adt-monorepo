import { expect, test } from "@playwright/test";

test("the home page shows that the API and the database answer", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Kanban" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("API and database are up");
});

test("healthz reports the web and API commits", async ({ request }) => {
  const response = await request.get("healthz");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.api.database).toBe("ok");
});
