import type { BoardSummary } from "@adt/contracts";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures";

// Boards saved in this browser by the old, logged-out version of the app.
const LOCAL_KEY = "kanban-boards-v2";

const localBoard = (id: string, name: string, cardTitle: string) => ({
  id,
  name,
  board: {
    columns: {
      todo: [{ id: `${id}-c1`, title: cardTitle, createdAt: "2026-01-02T03:04:05.000Z", priority: "high", labels: ["urgent"] }],
      doing: [],
      done: [],
    },
    archive: [],
  },
});

const LOCAL = {
  boards: [localBoard("w", "Work", "Local task"), localBoard("h", "Home", "Local chore")],
  currentId: "w",
};

// Runs before the app on every page of the context, but only until the board list has been written once.
async function saveInBrowser(context: BrowserContext) {
  await context.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem("e2e-seeded")) {
        localStorage.setItem("e2e-seeded", "1");
        localStorage.setItem(key, value);
      }
    },
    { key: LOCAL_KEY, value: JSON.stringify(LOCAL) },
  );
}

const names = async (api: APIRequestContext) => {
  const res = await api.get("api/boards");
  expect(res.ok()).toBe(true);
  return ((await res.json()) as BoardSummary[]).map((b) => b.name).sort();
};

const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), LOCAL_KEY);

test("the first login imports the boards saved in this browser once, with their content", async ({ page, context, api }) => {
  await saveInBrowser(context);
  await page.goto("./");

  await expect(page.getByRole("status").filter({ hasText: "2 boards from this browser were added" })).toBeVisible();
  expect(await names(api)).toEqual(["Home", "Work"]);
  expect(await stored(page)).toBeNull();

  // The imported board opens with its card, labels included.
  await page.getByRole("button", { name: "Local task", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("urgent")).toBeVisible();
  await page.keyboard.press("Escape");

  // A reload, and the data put back in the browser (as a second tab would), add nothing.
  await page.reload();
  await expect(page.getByRole("button", { name: "Local task", exact: true })).toBeVisible();
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [LOCAL_KEY, JSON.stringify(LOCAL)]);
  await page.reload();
  await expect(page.getByRole("button", { name: "Local task", exact: true })).toBeVisible();
  expect(await names(api)).toEqual(["Home", "Work"]);
});

test("a failed import keeps the browser copy and offers Retry", async ({ page, context, api }) => {
  await saveInBrowser(context);
  let failImport = true;
  await page.route("**/api/boards/import", (route) => (failImport ? route.abort("failed") : route.continue()));
  await page.goto("./");

  const alert = page.getByRole("alert").filter({ hasText: "could not be added to your account" });
  await expect(alert).toBeVisible();
  expect(await stored(page)).not.toBeNull();
  expect(await names(api)).not.toContain("Work");

  failImport = false;
  await alert.getByRole("button", { name: "Retry importing Work" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "2 boards from this browser were added" })).toBeVisible();
  await expect(alert).toBeHidden();
  // The board page had already opened an empty first board while the import was failing.
  expect(await names(api)).toEqual(expect.arrayContaining(["Home", "Work"]));
  expect(await stored(page)).toBeNull();
});

test("a failed save says so and the board matches the server", async ({ page, api, seedBoard }) => {
  await seedBoard({ name: "Saved" });
  await page.goto("./");
  await expect(page.getByLabel("New card title")).toBeVisible();

  // Reads still work; every change is refused.
  await page.route("**/api/**", (route) => (route.request().method() === "GET" ? route.continue() : route.abort("failed")));
  await page.getByLabel("New card title").fill("Never saved");
  await page.getByRole("button", { name: "Add card" }).click();

  await expect(page.getByText("Could not save, the board was reset to the saved version.")).toBeVisible();
  await expect(page.getByText("Never saved")).toHaveCount(0);
  const boards = (await (await api.get("api/boards")).json()) as BoardSummary[];
  const detail = await (await api.get(`api/boards/${boards[0].id}`)).json();
  expect(JSON.stringify(detail)).not.toContain("Never saved");
});
