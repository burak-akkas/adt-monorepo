import { expect, test } from "@playwright/test";

test("healthz reports the web and API commits", async ({ request }) => {
  const response = await request.get("healthz");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.api.database).toBe("ok");
});
