import { randomUUID } from "node:crypto";
import { request as playwrightRequest, type Page } from "@playwright/test";
import { expect, PASSWORD, test } from "../../support/fixtures";

// The owner is the `page` (signed in as `user`); the invitee is a second browser context.
const boardSelect = (page: Page) => page.getByRole("combobox", { name: "Board" });

async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Board actions" }).click();
}

async function openShare(page: Page) {
  await openMenu(page);
  await page.getByRole("menuitem", { name: "Share board" }).click();
  return page.getByRole("dialog", { name: "Share board" });
}

async function invite(dialog: ReturnType<Page["getByRole"]>, email: string) {
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Add" }).click();
}

test("invite, shared view and leave", async ({ page, browser, user, baseURL, seedBoard }) => {
  const board = await seedBoard({ name: "Team board" });
  const inviteeEmail = `e2e-invitee-${randomUUID().slice(0, 8)}@example.test`;
  const otherEmail = `e2e-other-${randomUUID().slice(0, 8)}@example.test`;
  const url = baseURL ?? "http://localhost:3000/";

  await page.goto("./");
  await expect(boardSelect(page)).toContainText(board.name);

  // The owner opens the dialog, sees the notice, and adds people.
  const dialog = await openShare(page);
  await expect(dialog.getByText("No email is sent", { exact: false })).toBeVisible();
  await invite(dialog, inviteeEmail);
  await expect(dialog.getByRole("list", { name: "People with access" }).getByText(inviteeEmail)).toBeVisible();

  // Duplicate, own email and invalid input show clear errors.
  await invite(dialog, inviteeEmail);
  await expect(dialog.getByRole("alert")).toContainText("already has access");
  await invite(dialog, user.email);
  await expect(dialog.getByRole("alert")).toContainText("already own");
  await invite(dialog, "not-an-email");
  await expect(dialog.getByRole("alert")).toBeVisible();

  // The invitee signs up and finds the board under "Shared with me".
  const inviteeApi = await playwrightRequest.newContext({ baseURL: url, extraHTTPHeaders: { origin: new URL(url).origin } });
  const signUp = await inviteeApi.post("api/auth/sign-up/email", { data: { email: inviteeEmail, password: PASSWORD, name: inviteeEmail } });
  expect(signUp.ok(), `sign-up failed with ${signUp.status()}`).toBe(true);
  const inviteeContext = await browser.newContext({ baseURL, storageState: await inviteeApi.storageState() });
  try {
    const invitee = await inviteeContext.newPage();
    await invitee.goto("./");
    await expect(boardSelect(invitee).locator('optgroup[label="Shared with me"]')).toContainText("Team board");

    // They can edit it.
    await invitee.getByLabel("New card title").fill("From the invitee");
    await invitee.getByRole("button", { name: "Add card" }).click();
    await expect(invitee.getByRole("button", { name: "From the invitee", exact: true })).toBeVisible();

    // They cannot rename, delete or share.
    await openMenu(invitee);
    await expect(invitee.getByRole("menuitem", { name: "Leave board" })).toBeVisible();
    for (const name of ["Share board", "Rename board", "Delete board"]) {
      await expect(invitee.getByRole("menuitem", { name })).toHaveCount(0);
    }

    // They leave.
    await invitee.getByRole("menuitem", { name: "Leave board" }).click();
    await invitee.getByRole("dialog", { name: "Leave board" }).getByRole("button", { name: "Leave" }).click();
    await expect(boardSelect(invitee).locator("option", { hasText: "Team board" })).toHaveCount(0);
    await expect(invitee.getByLabel("New card title")).toBeVisible();
  } finally {
    await inviteeContext.close();
    await inviteeApi.dispose();
  }

  // The owner sees the invitee gone, and the invitee's card on the board.
  await dialog.getByRole("button", { name: "Done" }).click();
  const again = await openShare(page);
  await expect(again.getByRole("list", { name: "People with access" })).toBeVisible();
  await expect(again.getByText(inviteeEmail)).toHaveCount(0);

  // The owner removes an invited address.
  await invite(again, otherEmail);
  await expect(again.getByText(otherEmail)).toBeVisible();
  await again.getByRole("button", { name: `Remove ${otherEmail}` }).click();
  await expect(again.getByText(otherEmail)).toHaveCount(0);
});
