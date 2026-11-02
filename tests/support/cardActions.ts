import { expect, type Page } from "@playwright/test";

// Card editing lives in the card dialog; these helpers open it, change fields and save.
export async function editCard(
  page: Page,
  title: string,
  fields: { list?: string; priority?: string; dueDate?: string; notes?: string },
) {
  await page.getByRole("button", { name: title, exact: true }).click();
  const dialog = page.getByRole("dialog");
  if (fields.list !== undefined) await dialog.getByLabel("Status").selectOption(fields.list);
  if (fields.priority !== undefined) await dialog.getByLabel("Priority").selectOption(fields.priority);
  if (fields.dueDate !== undefined) await dialog.getByLabel("Due date", { exact: true }).fill(fields.dueDate);
  if (fields.notes !== undefined) await dialog.getByLabel("Description").fill(fields.notes);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
}

export async function moveCardTo(page: Page, title: string, list: string) {
  await editCard(page, title, { list });
}

export async function deleteCardViaDialog(page: Page, title: string) {
  await page.getByRole("button", { name: title, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await dialog.getByRole("button", { name: "Delete card" }).click();
  await page.getByRole("dialog", { name: "Delete card" }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toBeHidden();
}
