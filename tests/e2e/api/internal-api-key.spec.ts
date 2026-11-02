import { expect, test } from "@playwright/test";

const HEADER = "x-internal-api-key";
const DEV_KEY = "dev-only-internal-api-key-not-for-production";
const key = process.env.INTERNAL_API_KEY || DEV_KEY;

// The API's own URL: the CI stack (start-stack.sh 3000 4000) has it on port 4000. A stack elsewhere must set E2E_API_URL.
const apiURL = process.env.E2E_API_URL ?? (process.env.E2E_BASE_URL ? undefined : "http://localhost:4000");

test.describe("directly against the API", () => {
  test.skip(!apiURL, "E2E_API_URL is not set for this stack");

  for (const path of ["health", "auth/get-session"]) {
    test(`/${path} answers 401 without the key, with an empty one and with a wrong one`, async ({ request }) => {
      const url = `${apiURL}/${path}`;
      expect((await request.get(url)).status()).toBe(401);
      expect((await request.get(url, { headers: { [HEADER]: "" } })).status()).toBe(401);
      expect((await request.get(url, { headers: { [HEADER]: "wrong-key" } })).status()).toBe(401);
    });

    test(`/${path} answers 200 with the right key`, async ({ request }) => {
      const response = await request.get(`${apiURL}/${path}`, { headers: { [HEADER]: key } });
      expect(response.status()).toBe(200);
    });
  }
});

test("a key sent by the browser is replaced by the proxy", async ({ request }) => {
  const response = await request.get("api/health", { headers: { [HEADER]: "bogus-browser-key" } });
  expect(response.status()).toBe(200);
});
