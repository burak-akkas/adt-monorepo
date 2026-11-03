import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures";

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

async function addCard(page: Page, title: string) {
  await page.getByLabel("New card title").fill(title);
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(column(page, "To do").getByText(title)).toBeVisible();
}

test("a logged-out visitor is sent to login and returns to the board after logging in", async ({ browser, baseURL, user, seedBoard }) => {
  const board = await seedBoard({ name: "Mine" });
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  await page.goto(`./?board=${board.id}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  // No logged-out mode: no board is shown, nothing to type a card into.
  await expect(page.getByLabel("New card title")).toHaveCount(0);

  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Kanban" })).toBeVisible();
  await expect(page.getByLabel("New card title")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`board=${board.id}`));
  await context.close();
});

test("the board is not shown to a visitor without a session", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("./");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Add card" })).toHaveCount(0);
  await context.close();
});

test("reload and a second browser context for the same user show the same boards", async ({ page, api, browser, baseURL, seedBoard }) => {
  await seedBoard({ name: "Shared" });
  await page.goto("./");
  await addCard(page, "Saved on the server");

  await page.reload();
  await expect(column(page, "To do").getByText("Saved on the server")).toBeVisible();

  const second = await browser.newContext({ baseURL, storageState: await api.storageState() });
  const other = await second.newPage();
  await other.goto("./");
  await expect(column(other, "To do").getByText("Saved on the server")).toBeVisible();
  await second.close();
});

test("the browser only calls its own origin under /api", async ({ page, baseURL, seedBoard }) => {
  await seedBoard();
  const origin = new URL(baseURL ?? "http://localhost:3000/").origin;
  const foreign: string[] = [];
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (url.origin !== origin) foreign.push(request.url());
    else if (url.pathname.includes("/api/")) apiCalls.push(url.pathname);
  });

  await page.goto("./");
  await addCard(page, "Through the proxy");
  await page.reload();
  await expect(column(page, "To do").getByText("Through the proxy")).toBeVisible();

  expect(foreign).toEqual([]);
  expect(apiCalls.length).toBeGreaterThan(0);
});
